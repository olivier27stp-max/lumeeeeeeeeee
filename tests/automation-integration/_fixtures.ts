/**
 * Fixtures STAGING partagées par les tests d'intégration du moteur
 * d'automatisations (T4, T7, …).
 *
 * - Opt-in explicite (`AUTOMATIONS_IT=1` en local, `DB_URL` en CI) : ces tests
 *   ÉCRIVENT puis effacent des organisations. Jamais sur un `npm test` ordinaire.
 * - Refus catégorique si l'URL Supabase est celle de la production.
 * - Tout est préfixé `qa-<bloc>-<stamp>` ; `nettoyer()` supprime les orgs
 *   (cascade sur org_id) puis les utilisateurs.
 * - Les `vi.mock` des fournisseurs restent dans CHAQUE fichier de test (ils
 *   sont hissés par fichier) ; ici on n'importe les modules serveur que
 *   dynamiquement, après les mocks.
 */
import { config as chargerEnv } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

chargerEnv({ path: '.env.local', override: true });

export const URL_SB = process.env.VITE_SUPABASE_URL || '';
export const CLE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const CLE_ANON = process.env.VITE_SUPABASE_ANON_KEY || '';
const REF_PROD = process.env.SUPABASE_PROJECT_REF_PROD || '';
const OPT_IN = process.env.AUTOMATIONS_IT === '1' || !!process.env.DB_URL;
export const DISPONIBLE = OPT_IN && !!URL_SB && !URL_SB.includes('ci-dummy') && !!CLE_SERVICE && !!CLE_ANON;
if (DISPONIBLE && REF_PROD && URL_SB.includes(REF_PROD)) {
  throw new Error('REFUS : ces tests créent et suppriment des organisations — la cible est la PRODUCTION.');
}

export interface OrgTest {
  id: string;
  owner: { id: string; email: string };
  client: { id: string; phone: string; email: string; nom: string };
  job: string;
  visite: string;
  regles: Map<string, string>;
}

export class Banc {
  readonly admin: SupabaseClient;
  readonly stamp = Date.now();
  readonly prefixe: string;
  readonly mdp: string;
  private utilisateurs: string[] = [];
  private orgs: string[] = [];
  private serveur: Server | null = null;
  base = '';

  constructor(bloc: string) {
    this.prefixe = `qa-${bloc}-${this.stamp}`;
    this.mdp = `Xx-${bloc}-${this.stamp}!aZ`;
    this.admin = createClient(URL_SB, CLE_SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async creerUtilisateur(nom: string) {
    const email = `${this.prefixe}-${nom}@example.test`;
    const { data, error } = await this.admin.auth.admin.createUser({ email, password: this.mdp, email_confirm: true });
    if (error) throw new Error(`createUser ${nom} : ${error.message}`);
    this.utilisateurs.push(data.user.id);
    return { id: data.user.id, email };
  }

  async jetonDe(email: string): Promise<string> {
    const anon = createClient(URL_SB, CLE_ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await anon.auth.signInWithPassword({ email, password: this.mdp });
    if (error || !data.session) throw new Error(`signIn ${email} : ${error?.message}`);
    return data.session.access_token;
  }

  /** Client PostgREST « comme le navigateur » d'un utilisateur (RLS appliquée). */
  clientDe(jeton: string) {
    return createClient(URL_SB, CLE_ANON, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${jeton}` } } });
  }

  /** Org complète : owner, réglages, 1 client (téléphone + courriel), 1 job planifié, 1 visite dans 3 jours, 35 presets actifs. */
  async creerOrg(nom: string, telephoneClient = '+15145550101'): Promise<OrgTest> {
    const a = this.admin;
    const owner = await this.creerUtilisateur(`${nom}-owner`);
    const { data: org, error: eo } = await a.from('orgs').insert({ name: `${this.prefixe} ${nom}`, created_by: owner.id }).select('id').single();
    if (eo) throw new Error(`org ${nom} : ${eo.message}`);
    this.orgs.push(org.id);
    const { error: em } = await a.from('memberships').insert({ user_id: owner.id, org_id: org.id, role: 'owner', status: 'active' });
    if (em) throw new Error(`membership ${nom} : ${em.message}`);
    await a.from('company_settings').upsert({ org_id: org.id, company_name: `Entreprise ${nom}`, default_language: 'fr' }, { onConflict: 'org_id' });

    const { data: client, error: ec } = await a.from('clients').insert({
      org_id: org.id, created_by: owner.id, first_name: `Client${nom}`, last_name: 'Test', status: 'active',
      phone: telephoneClient, email: `${this.prefixe}-client-${nom.toLowerCase()}@example.test`,
      address: `${nom === 'A' ? 10 : 20} rue de l'Org ${nom}`, city: 'Longueuil',
    }).select('id, phone, email').single();
    if (ec) throw new Error(`client ${nom} : ${ec.message}`);

    const { data: job, error: ej } = await a.from('jobs').insert({
      org_id: org.id, created_by: owner.id, client_id: client.id, title: `Job ${nom}`, status: 'scheduled', job_number: `QA-${nom}-${this.stamp}`,
      property_address: `${nom === 'A' ? 10 : 20} rue de l'Org ${nom}, Longueuil`, client_name: `Client${nom} Test`,
    }).select('id').single();
    if (ej) throw new Error(`job ${nom} : ${ej.message}`);

    const dans3jours = new Date(Date.now() + 3 * 86400_000); dans3jours.setUTCHours(13, 0, 0, 0);
    const { data: visite, error: ev } = await a.from('schedule_events').insert({
      org_id: org.id, created_by: owner.id, job_id: job.id, title: `Visite ${nom}`,
      start_at: dans3jours.toISOString(), end_at: new Date(dans3jours.getTime() + 3600_000).toISOString(),
    }).select('id').single();
    if (ev) throw new Error(`visite ${nom} : ${ev.message}`);

    const { ensureAutomationPresets } = await import('../../server/lib/automationPresetSeeder');
    await ensureAutomationPresets(a, org.id, { activateAll: true });
    const { data: regles } = await a.from('automation_rules').select('id, preset_key').eq('org_id', org.id);
    const map = new Map<string, string>();
    for (const r of regles || []) if (r.preset_key) map.set(r.preset_key, r.id);

    return { id: org.id, owner, client: { id: client.id, phone: client.phone, email: client.email, nom: `Client${nom}` }, job: job.id, visite: visite.id, regles: map };
  }

  /** Le vrai routeur d'événements sur un vrai serveur HTTP + le vrai moteur branché au bus. */
  async demarrerServeur(twilio: { client: any; phoneNumber: string } | null) {
    const { default: routeur } = await import('../../server/routes/automation-events');
    const { initAutomationEngine } = await import('../../server/lib/automationEngine');
    initAutomationEngine({ supabase: this.admin, twilio, baseUrl: 'http://qa.test' });
    const app = express();
    app.use(express.json());
    app.use('/api', routeur);
    await new Promise<void>((r) => { this.serveur = app.listen(0, '127.0.0.1', () => r()); });
    this.base = `http://127.0.0.1:${(this.serveur!.address() as AddressInfo).port}`;
  }

  async poster(jeton: string, orgId: string, chemin: string, corps: Record<string, unknown>) {
    const res = await fetch(`${this.base}/api/automations/events/${chemin}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}`, 'x-org-id': orgId },
      body: JSON.stringify(corps),
    });
    return { statut: res.status, corps: await res.json().catch(() => ({})) };
  }

  /** Tâches et logs qui référencent une entité. */
  async tracesDe(entityId: string) {
    const [{ data: taches }, { data: logs }] = await Promise.all([
      this.admin.from('automation_scheduled_tasks').select('id, org_id, automation_rule_id, status, execution_key, execute_at, attempts, last_error').eq('entity_id', entityId).order('execution_key'),
      this.admin.from('automation_execution_logs').select('id, org_id, automation_rule_id, scheduled_task_id, action_type, result_success, result_error, created_at').eq('entity_id', entityId).order('created_at'),
    ]);
    return { taches: taches || [], logs: logs || [] };
  }

  async nettoyer() {
    await new Promise<void>((r) => (this.serveur ? this.serveur.close(() => r()) : r()));
    for (const id of this.orgs) {
      // `invoices.org_id` n'est pas en cascade : les factures de test partent d'abord.
      const { error: ef } = await this.admin.from('invoices').delete().eq('org_id', id);
      if (ef) console.error(`[fixtures] nettoyage factures de ${id} : ${ef.message}`);
      const { error } = await this.admin.from('orgs').delete().eq('id', id);
      if (error) console.error(`[fixtures] nettoyage org ${id} : ${error.message}`);
    }
    for (const id of this.utilisateurs) {
      const { error } = await this.admin.auth.admin.deleteUser(id);
      if (error) console.error(`[fixtures] nettoyage user ${id} : ${error.message}`);
    }
  }
}

/**
 * Le moteur travaille en tâche de fond après la réponse HTTP : on attend qu'il
 * ait fini. Boucle bornée par un compteur (pas par Date.now(), que certains
 * tests figent).
 */
export async function attendre(condition: () => Promise<boolean>, tours = 20, pasMs = 300) {
  for (let i = 0; i < tours; i++) { if (await condition()) return true; await new Promise((r) => setTimeout(r, pasMs)); }
  return condition();
}
