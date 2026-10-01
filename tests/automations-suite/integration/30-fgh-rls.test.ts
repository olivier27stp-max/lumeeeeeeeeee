/**
 * F — Sécurité / multi-tenant : la RLS de TOUTES les tables d'automatisations,
 * prouvée par PostgREST avec de VRAIS jetons (sessionDe), comme le navigateur.
 *
 * Liste des tables : supabase/SCHEMA_SNAPSHOT.md (§1, automation_*, automations,
 * domain_events, pipeline_events, clients_inactifs_declenches,
 * paiements_echoues_traites) + migrations récentes (automation_evenements_base
 * 20261003100000, envois_simules / orgs_envois_simules 20261005100000) + les
 * tables de conformité que lit le moteur avant chaque envoi (email_unsubscribes,
 * sms_opt_outs, consents, org_features, review_requests, satisfaction_surveys).
 *
 * Pour chaque table « de bureau » :
 *  · témoin positif : le propriétaire de A VOIT sa ligne (sinon « 0 ligne »
 *    pour B ne prouverait rien) ;
 *  · le propriétaire de B ne la lit pas, ne peut ni en insérer une au nom de
 *    A, ni la modifier, ni la supprimer (relu ensuite par service_role).
 * Tables « serveur seulement » : aucun accès pour `authenticated`, même à A.
 * RBAC : le technicien de A ne lit ni n'écrit les automatisations ni leurs
 * journaux (actions, corps de messages, destinataires, montants).
 *
 * En CI : seulement VITE_SUPABASE_URL / ANON / SERVICE_ROLE (staging).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { assurerBureauTest, sessionDe, COMPTES, type BureauTest } from '../harnais/bureau-test';
import { marque } from '../harnais/moteur';

let b: BureauTest;
let A: SupabaseClient; // proprio A
let B: SupabaseClient; // proprio B
let T: SupabaseClient; // technicien A
const m = marque('F-rls');
const nettoyer: Array<() => PromiseLike<unknown>> = [];

/** Les lignes de A, créées par service_role, que B ne doit jamais atteindre. */
const ids: Record<string, string> = {};

async function ok<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, quoi: string): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error || data === null || data === undefined) throw new Error(`${quoi} : ${error?.message ?? 'aucune donnée'}`);
  return data as NonNullable<T>;
}

beforeAll(async () => {
  b = await assurerBureauTest();
  A = (await sessionDe(b.admin, COMPTES.proprioA.email)).client;
  B = (await sessionDe(b.admin, COMPTES.proprioB.email)).client;
  T = (await sessionDe(b.admin, COMPTES.techA.email)).client;
  const ad = b.admin;

  const client = await ok(ad.from('clients').insert({
    org_id: b.orgA, created_by: b.users.proprioA, first_name: 'Rls', last_name: m, status: 'active',
    email: `rls-${Date.now()}@lume-qa.test`, phone: '+15555550142',
  }).select('id').single(), 'client A');
  ids.client = client.id;
  nettoyer.push(() => ad.from('clients').delete().eq('id', client.id));

  const regle = await ok(ad.from('automation_rules').insert({
    org_id: b.orgA, name: m, trigger_event: 'lead.created', conditions: {}, delay_seconds: 0, is_active: false, is_preset: false,
    actions: [{ type: 'send_email', config: { subject: `Secret ${m}`, body: '<p>Montant 1 234,56 $</p>' } }],
  }).select('id').single(), 'règle A');
  ids.automation_rules = regle.id;
  nettoyer.push(() => ad.from('automation_rules').delete().eq('id', regle.id));

  const dossier = await ok(ad.from('automation_folders').insert({ org_id: b.orgA, name: `F-rls ${Date.now().toString(36)}` }).select('id').single(), 'dossier A');
  ids.automation_folders = dossier.id;
  nettoyer.push(() => ad.from('automation_folders').delete().eq('id', dossier.id));

  // Tâche ANNULÉE et lointaine : lisible, jamais exécutée par une file.
  const tache = await ok(ad.from('automation_scheduled_tasks').insert({
    org_id: b.orgA, automation_rule_id: regle.id, entity_type: 'client', entity_id: client.id,
    action_config: { type: 'send_sms', config: { body: `Secret ${m}` } }, execute_at: new Date(Date.now() + 365 * 86400_000).toISOString(),
    status: 'cancelled', execution_key: `rls:${randomUUID()}`,
  }).select('id').single(), 'tâche A');
  ids.automation_scheduled_tasks = tache.id;

  const journal = await ok(ad.from('automation_execution_logs').insert({
    org_id: b.orgA, automation_rule_id: regle.id, trigger_event: 'lead.created', entity_type: 'client', entity_id: client.id,
    action_type: 'send_email', action_config: { body: `Secret ${m}` }, result_success: true, result_data: { to: 'secret@lume-qa.test' },
  }).select('id').single(), 'journal A');
  ids.automation_execution_logs = journal.id;
  nettoyer.push(() => ad.from('automation_execution_logs').delete().eq('id', journal.id));

  const hook = await ok(ad.from('automation_webhooks').insert({ org_id: b.orgA, name: `F-rls ${m}`.slice(0, 80), enabled: false }).select('id').single(), 'webhook A');
  ids.automation_webhooks = hook.id;
  nettoyer.push(() => ad.from('automation_webhooks').delete().eq('id', hook.id));

  const recu = await ok(ad.from('automation_webhook_receipts').insert({ webhook_id: hook.id, org_id: b.orgA, statut: 'refuse', motif: m }).select('id').single(), 'reçu A');
  ids.automation_webhook_receipts = recu.id;

  // Table héritée, encore lue par le scheduler : INACTIVE, pour qu'elle n'envoie rien.
  const vieille = await ok(ad.from('automations').insert({ org_id: b.orgA, name: m, trigger: 'custom', active: false, message_template: 'Secret' }).select('id').single(), 'automations A');
  ids.automations = vieille.id;
  nettoyer.push(() => ad.from('automations').delete().eq('id', vieille.id));

  const desabo = await ok(ad.from('email_unsubscribes').insert({ org_id: b.orgA, email: `desabo-${Date.now()}@lume-qa.test`, category: 'all', reason: m }).select('id').single(), 'désabonnement A');
  ids.email_unsubscribes = desabo.id;
  nettoyer.push(() => ad.from('email_unsubscribes').delete().eq('id', desabo.id));

  const stop = await ok(ad.from('sms_opt_outs').insert({ org_id: b.orgA, phone: `+1555555019${Math.floor(Math.random() * 10)}`, reason: m }).select('id').single(), 'STOP A');
  ids.sms_opt_outs = stop.id;
  nettoyer.push(() => ad.from('sms_opt_outs').delete().eq('id', stop.id));

  const consent = await ok(ad.from('consents').insert({ org_id: b.orgA, subject_type: 'client', subject_id: client.id, purpose: 'marketing_email', granted: true, method: m }).select('id').single(), 'consentement A');
  ids.consents = consent.id;
  nettoyer.push(() => ad.from('consents').delete().eq('id', consent.id));

  const drapeau = await ok(ad.from('org_features').upsert({ org_id: b.orgA, feature: 'qa_rls_temoin', enabled: false }, { onConflict: 'org_id,feature' }).select('id').single(), 'drapeau A');
  ids.org_features = drapeau.id;
  nettoyer.push(() => ad.from('org_features').delete().eq('id', drapeau.id));

  const sondage = await ok(ad.from('satisfaction_surveys').insert({ org_id: b.orgA, client_id: client.id, token: randomUUID().replace(/-/g, '') }).select('id').single(), 'sondage A');
  ids.satisfaction_surveys = sondage.id;
  const avis = await ok(ad.from('review_requests').insert({ org_id: b.orgA, client_id: client.id, survey_id: sondage.id, subject_sent: m, status: 'failed' }).select('id').single(), 'demande d’avis A');
  ids.review_requests = avis.id;
  nettoyer.push(() => ad.from('review_requests').delete().eq('id', avis.id));
  nettoyer.push(() => ad.from('satisfaction_surveys').delete().eq('id', sondage.id));
}, 120_000);

afterAll(async () => { for (const f of nettoyer.reverse()) await f(); });

/** Une table de bureau : colonne à modifier (patch) et ligne à insérer au nom de A. */
const TABLES_BUREAU: Array<{ id: string; table: string; patch: Record<string, unknown>; insertion: () => Record<string, unknown> }> = [
  { id: 'F-001', table: 'automation_rules', patch: { name: 'PIRATE B' }, insertion: () => ({ org_id: b.orgA, name: 'PIRATE B', trigger_event: 'lead.created', conditions: {}, delay_seconds: 0, is_active: true, actions: [{ type: 'send_sms', config: { body: 'pirate' } }] }) },
  { id: 'F-002', table: 'automation_folders', patch: { name: 'PIRATE B' }, insertion: () => ({ org_id: b.orgA, name: 'PIRATE B' }) },
  { id: 'F-003', table: 'automation_scheduled_tasks', patch: { status: 'pending', execute_at: new Date().toISOString() }, insertion: () => ({ org_id: b.orgA, automation_rule_id: ids.automation_rules, entity_type: 'client', entity_id: ids.client, action_config: {}, execute_at: new Date().toISOString(), status: 'pending', execution_key: `pirate:${randomUUID()}` }) },
  { id: 'F-004', table: 'automation_execution_logs', patch: { result_success: false }, insertion: () => ({ org_id: b.orgA, trigger_event: 'x', entity_type: 'client', entity_id: ids.client, action_type: 'send_sms' }) },
  { id: 'F-005', table: 'automation_webhooks', patch: { enabled: true }, insertion: () => ({ org_id: b.orgA, name: 'PIRATE B' }) },
  { id: 'F-006', table: 'automation_webhook_receipts', patch: { motif: 'PIRATE B' }, insertion: () => ({ webhook_id: ids.automation_webhooks, org_id: b.orgA, statut: 'accepte' }) },
  { id: 'F-007', table: 'automations', patch: { active: true }, insertion: () => ({ org_id: b.orgA, name: 'PIRATE B', trigger: 'custom', active: true }) },
  { id: 'F-008', table: 'email_unsubscribes', patch: { category: 'pending' }, insertion: () => ({ org_id: b.orgA, email: 'pirate@lume-qa.test', category: 'all' }) },
  { id: 'F-009', table: 'sms_opt_outs', patch: { reason: 'PIRATE B' }, insertion: () => ({ org_id: b.orgA, phone: '+15555550199' }) },
  { id: 'F-010', table: 'consents', patch: { granted: false }, insertion: () => ({ org_id: b.orgA, subject_type: 'client', subject_id: ids.client, purpose: 'marketing_email', granted: true }) },
  { id: 'F-011', table: 'org_features', patch: { enabled: true }, insertion: () => ({ org_id: b.orgA, feature: 'auto_desabonnement_canal', enabled: false }) },
  { id: 'F-012', table: 'review_requests', patch: { status: 'sent' }, insertion: () => ({ org_id: b.orgA, client_id: ids.client, status: 'sent' }) },
  { id: 'F-013', table: 'satisfaction_surveys', patch: { rating: 1 }, insertion: () => ({ org_id: b.orgA, client_id: ids.client, token: randomUUID().replace(/-/g, '') }) },
];

describe('F — RLS : le propriétaire de B n’atteint AUCUNE ligne de A', () => {
  for (const cas of TABLES_BUREAU) {
    it(`[${cas.id}] ${cas.table} : A voit sa ligne ; B ne lit, n’insère, ne modifie ni ne supprime rien de A`, async () => {
      const id = ids[cas.table];
      expect(id, `graine absente pour ${cas.table}`).toBeTruthy();

      // Témoin positif — sauf les tables que même A ne lit pas par PostgREST
      // (file planifiée, journal : lisibles par le propriétaire, vérifié plus bas).
      const { data: vuParA, error: eA } = await A.from(cas.table).select('id').eq('id', id);
      expect(eA, `${cas.table} illisible pour A`).toBeNull();
      expect(vuParA, `le propriétaire de A ne voit pas sa propre ligne ${cas.table} : le test ne prouverait rien`).toHaveLength(1);

      const { data: lu } = await B.from(cas.table).select('*').eq('org_id', b.orgA);
      expect(lu ?? [], `B lit des lignes ${cas.table} de A`).toHaveLength(0);

      const { data: ecrit, error: eIns } = await B.from(cas.table).insert(cas.insertion()).select('id');
      if (!eIns && ecrit?.length) {
        await b.admin.from(cas.table).delete().in('id', ecrit.map((r: { id: string }) => r.id));
      }
      expect(eIns, `B a pu INSÉRER dans ${cas.table} au nom de A`).not.toBeNull();

      const avant = await ok(b.admin.from(cas.table).select('*').eq('id', id).single(), `relecture ${cas.table}`);
      const { data: modifie } = await B.from(cas.table).update(cas.patch).eq('id', id).select('id');
      expect(modifie ?? [], `B a MODIFIÉ ${cas.table} de A`).toHaveLength(0);
      const { data: supprime } = await B.from(cas.table).delete().eq('id', id).select('id');
      expect(supprime ?? [], `B a SUPPRIMÉ ${cas.table} de A`).toHaveLength(0);
      const apres = await ok(b.admin.from(cas.table).select('*').eq('id', id).single(), `relecture ${cas.table}`);
      expect(apres).toEqual(avant);
    });
  }

  it('[F-014] pipeline_events et domain_events : B ne lit aucun événement de A', async () => {
    const { data: pe } = await B.from('pipeline_events').select('id').eq('org_id', b.orgA);
    expect(pe ?? []).toHaveLength(0);
    // domain_events : RLS sans policy (serveur seulement) — refus ou vide, jamais une ligne.
    const { data: de } = await B.from('domain_events').select('id').eq('org_id', b.orgA).limit(5);
    expect(de ?? []).toHaveLength(0);
    const { data: deA } = await A.from('domain_events').select('id').eq('org_id', b.orgA).limit(5);
    expect(deA ?? [], 'domain_events lisible par authenticated').toHaveLength(0);
  });
});

/** Tables réservées au serveur : `authenticated` n'y a AUCUN accès, même sur son propre bureau. */
const TABLES_SERVEUR: Array<{ id: string; table: string; insertion: () => Record<string, unknown> }> = [
  { id: 'F-015', table: 'automation_evenements_base', insertion: () => ({ org_id: b.orgA, type: 'lead.created', entity_type: 'client', entity_id: ids.client, cle: 'pirate' }) },
  { id: 'F-016', table: 'clients_inactifs_declenches', insertion: () => ({ org_id: b.orgA, client_id: ids.client, mois: 6, periode: 'pirate' }) },
  { id: 'F-017', table: 'paiements_echoues_traites', insertion: () => ({ stripe_event_id: `evt_pirate_${Date.now()}`, org_id: b.orgA, invoice_id: ids.client }) },
  { id: 'F-018', table: 'envois_simules', insertion: () => ({ org_id: b.orgA, canal: 'sms', destinataire: '+15555550100' }) },
  { id: 'F-019', table: 'orgs_envois_simules', insertion: () => ({ org_id: b.orgB, raison: 'pirate' }) },
];

describe('F — tables « serveur seulement » : aucun accès par PostgREST', () => {
  for (const cas of TABLES_SERVEUR) {
    it(`[${cas.id}] ${cas.table} : ni A ni B ne lisent, n’écrivent ni ne suppriment`, async () => {
      for (const [qui, c] of [['A', A], ['B', B]] as const) {
        const { data: lu, error: eLu } = await c.from(cas.table).select('*').limit(5);
        expect(lu ?? [], `${qui} lit ${cas.table}`).toHaveLength(0);
        expect(eLu, `${qui} : ${cas.table} devrait refuser la lecture (droits retirés)`).not.toBeNull();
        const { error: eIns } = await c.from(cas.table).insert(cas.insertion());
        expect(eIns, `${qui} a pu écrire dans ${cas.table}`).not.toBeNull();
      }
    });
  }

  it('[F-020] B ne peut pas sortir A du bac à sable (orgs_envois_simules intact)', async () => {
    const { data: supprime } = await B.from('orgs_envois_simules').delete().eq('org_id', b.orgA).select('org_id');
    expect(supprime ?? []).toHaveLength(0);
    const { data } = await b.admin.from('orgs_envois_simules').select('org_id').eq('org_id', b.orgA);
    expect(data).toHaveLength(1);
  });
});

describe('F — RBAC par la RLS : le technicien de A', () => {
  it('[F-021] ne lit ni les automatisations, ni les dossiers, ni les adresses d’appel de A', async () => {
    for (const table of ['automation_rules', 'automation_folders', 'automation_webhooks', 'automation_webhook_receipts']) {
      const { data } = await T.from(table).select('id').eq('org_id', b.orgA);
      expect(data ?? [], `le technicien lit ${table}`).toHaveLength(0);
    }
  });

  it('[F-022] ne crée, ne modifie, ne publie ni ne supprime une automatisation (RLS)', async () => {
    const { data: cree, error } = await T.from('automation_rules').insert({
      org_id: b.orgA, name: `${m} tech`, trigger_event: 'invoice.paid', conditions: {}, delay_seconds: 0, is_active: true,
      actions: [{ type: 'update_status', config: { table: 'invoices', status: 'paid' } }],
    }).select('id');
    if (cree?.length) await b.admin.from('automation_rules').delete().in('id', cree.map((r) => r.id));
    expect(error, 'le technicien a pu créer une automatisation').not.toBeNull();

    const { data: publie } = await T.from('automation_rules').update({ is_active: true }).eq('id', ids.automation_rules).select('id');
    expect(publie ?? [], 'le technicien a pu publier').toHaveLength(0);
    const { data: detourne } = await T.from('automation_rules')
      .update({ actions: [{ type: 'send_sms', config: { body: 'détourné', to: '+15555550198' } }] }).eq('id', ids.automation_rules).select('id');
    expect(detourne ?? [], 'le technicien a pu réécrire les actions').toHaveLength(0);
    const { data: supprime } = await T.from('automation_rules').delete().eq('id', ids.automation_rules).select('id');
    expect(supprime ?? [], 'le technicien a pu supprimer').toHaveLength(0);
    const { data: regle } = await b.admin.from('automation_rules').select('is_active, actions').eq('id', ids.automation_rules).single();
    expect(regle!.is_active).toBe(false);
    expect(JSON.stringify(regle!.actions)).toContain('Secret');
  });

  /*
   * DÉCISION (inv-3 §6, §8-18) : oui, c'était une fuite. `action_config` porte
   * le texte des messages (montants, noms), `result_data` le destinataire.
   * Un technicien n'a pas `automations.read`. La migration 20261003100100
   * restreint journal → automations.read OU leads.read, file → automations.read.
   */
  it('[F-023] ne lit ni la file planifiée ni le journal d’exécution (contenus, destinataires)', async () => {
    const { data: file } = await T.from('automation_scheduled_tasks').select('id, action_config').eq('org_id', b.orgA);
    expect(file ?? [], 'le technicien lit la file (textes des messages)').toHaveLength(0);
    const { data: journal } = await T.from('automation_execution_logs').select('id, action_config, result_data').eq('org_id', b.orgA);
    expect(journal ?? [], 'le technicien lit le journal (destinataires, contenus)').toHaveLength(0);
    // Témoin : le propriétaire, lui, les lit.
    const { data: fileA } = await A.from('automation_scheduled_tasks').select('id').eq('id', ids.automation_scheduled_tasks);
    const { data: journalA } = await A.from('automation_execution_logs').select('id').eq('id', ids.automation_execution_logs);
    expect(fileA).toHaveLength(1);
    expect(journalA).toHaveLength(1);
  });

  it('[F-024] ne lit pas la clé secrète d’une adresse d’appel, même le propriétaire (privilège de colonne)', async () => {
    const { data, error } = await A.from('automation_webhooks').select('api_key').eq('id', ids.automation_webhooks);
    expect(data ?? [], 'api_key lisible par authenticated').toHaveLength(0);
    expect(error).not.toBeNull();
  });
});
