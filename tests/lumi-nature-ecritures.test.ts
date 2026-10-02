/**
 * « C'est fait » quand rien n'a été refait (constat A-03, mission finale).
 *
 * L'anti-doublon (`executerIdempotent`) rendait, pendant dix minutes, le
 * résultat MÉMORISÉ de la première exécution à toute demande identique. Pour
 * un envoi, c'est ce qu'on veut. Pour un ÉTAT, c'est un mensonge : « mets ce
 * texto », l'utilisateur le change à l'écran, redemande « remets ce texto » —
 * Lumi répondait « c'est fait » avec le vieux résultat, et rien n'était écrit.
 *
 * Chaque outil d'écriture a donc une NATURE :
 *   · `etat`    — poser une valeur : toujours refait (c'est sans danger) ;
 *   · `courte`  — créer : mémorisé le temps d'un double clic (60 s) ;
 *   · `durable` — envoyer, encaisser, supprimer : mémorisé toute la fenêtre.
 * Un outil sans nature tomberait sur « courte » sans que personne l'ait
 * décidé : ce test l'interdit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { table } = vi.hoisted(() => ({ table: [] as Array<{ id: string; org_id: string; user_id: string; outil: string; args_hash: string; resultat: any; created_at: string }> }));

// Faux client service : agent_actions avec l'index unique (org_id, outil, args_hash) — même maquette que lumi-doublon.
function requete() {
  const filtres: Array<[string, any]> = [];
  let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  let ligne: any = null;
  let maj: any = null;
  const lignes = () => table.filter((r) => filtres.every(([k, v]) => (r as any)[k] === v));
  const q: any = {
    insert: (l: any) => { op = 'insert'; ligne = l; return q; },
    update: (m: any) => { op = 'update'; maj = m; return q; },
    delete: () => { op = 'delete'; return q; },
    select: () => q,
    eq: (k: string, v: any) => { filtres.push([k, v]); return q; },
    maybeSingle: async () => executer(true),
    then: (ok: any) => Promise.resolve(executer(false)).then(ok),
  };
  function executer(un: boolean) {
    if (op === 'insert') {
      if (table.some((r) => r.org_id === ligne.org_id && r.outil === ligne.outil && r.args_hash === ligne.args_hash)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
      const r = { id: `a${table.length + 1}-${Math.random()}`, resultat: {}, created_at: new Date().toISOString(), ...ligne };
      table.push(r);
      return { data: { id: r.id }, error: null };
    }
    if (op === 'update') { for (const r of lignes()) Object.assign(r, maj); return { data: null, error: null }; }
    if (op === 'delete') { for (const r of lignes()) table.splice(table.indexOf(r), 1); return { data: null, error: null }; }
    const l = lignes();
    return { data: un ? (l[0] ?? null) : l, error: null };
  }
  return q;
}
vi.mock('../server/lib/supabase', () => ({ getServiceClient: () => ({ from: () => requete() }), companyOrgIds: async () => [], isOrgAdminOrOwner: async () => true }));
vi.mock('../server/lib/security', () => ({ logSecurityEvent: () => {} }));
vi.mock('../server/lib/lumi/version-org', () => ({ invaliderOrg: async () => {}, versionOrg: async () => 0 }));
vi.mock('../server/lib/config', () => ({ twilioClient: null, getTwilioStatusCallbackUrl: () => '' }));
vi.mock('../server/lib/helpers', () => ({ normalizeE164: (s: string) => s, findOrCreateConversation: async () => null }));
vi.mock('../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => null, SmsNumberNotProvisionedError: class extends Error {}, SmsNotInPlanError: class extends Error {} }));

import { executerIdempotent, natureEcriture, FENETRE_DOUBLE_CLIC_MS, FENETRE_DOUBLON_MS } from '../server/lib/agent/tools-etendus';
import { AGENT_TOOLS } from '../server/lib/agent/tools';

const ctx = { client: {} as any, orgId: 'org-1', userId: 'marc' };
const vieillir = (ms: number) => { table[0].created_at = new Date(Date.now() - ms).toISOString(); };

describe('chaque outil d’écriture a une nature décidée', () => {
  const ecritures = AGENT_TOOLS.filter((t) => t.kind === 'write').map((t) => t.declaration.name);

  it('aucun outil d’écriture sans nature (un nouvel outil doit être classé)', () => {
    const sans = ecritures.filter((n) => natureEcriture(n) === null);
    expect(sans, `outils d'écriture sans nature — les ajouter à NATURE_PAR_NOM (tools-etendus.ts) : ${sans.join(', ')}`).toEqual([]);
  });

  it('modifier une automatisation est un ÉTAT : jamais de résultat mémorisé', () => {
    for (const n of ['update_automation_sms_body', 'update_automation_message', 'update_automation_from_text', 'toggle_automation_rule', 'rename_automation_rule', 'set_automation_language']) {
      expect(natureEcriture(n), n).toBe('etat');
    }
  });

  it('ce qui part au client, encaisse ou ne se défait pas reste DURABLE', () => {
    for (const n of ['send_sms', 'send_email', 'send_invoice', 'send_quote', 'send_payment_reminders', 'charge_card_on_file', 'refund_payment', 'mark_invoice_paid', 'record_invoice_payment', 'merge_clients', 'create_payment_request']) {
      expect(natureEcriture(n), n).toBe('durable');
    }
  });

  it('une création est COURTE : le double clic seulement', () => {
    for (const n of ['create_client', 'create_task', 'create_automation_from_text', 'add_note', 'set_goal']) expect(natureEcriture(n), n).toBe('courte');
  });

  it('la nature dépend parfois des arguments (pointer la fin avec envoi, annuler une visite en prévenant le client)', () => {
    // Le même outil n'a pas la même portée selon ce qu'on lui demande : la nature suit l'effet le plus lourd.
    const natures = new Set(['etat', 'courte', 'durable']);
    for (const n of ['punch_out', 'end_field_session', 'cancel_visit']) expect(natures.has(String(natureEcriture(n, {}))), n).toBe(true);
  });
});

describe('executerIdempotent applique la nature', () => {
  beforeEach(() => { table.length = 0; });

  it('ÉTAT — la même réécriture redemandée tout de suite est REFAITE (A-03 : plus de « c’est fait » sans écriture)', async () => {
    const action = vi.fn(async () => ({ updated: true, texte_enregistre: 'Bonjour' }));
    const args = { rule_id: 'r1', body: 'Bonjour' };
    await executerIdempotent(ctx, 'update_automation_sms_body', args, action);
    const b = await executerIdempotent(ctx, 'update_automation_sms_body', args, action);
    expect(action).toHaveBeenCalledTimes(2);
    expect(b).not.toHaveProperty('deja_fait');
    expect(b).not.toHaveProperty('rejoue');
    expect(table).toHaveLength(1); // l'empreinte est remplacée, pas accumulée
  });

  it('ÉTAT — mais une exécution ENCORE EN COURS n’est pas doublée', async () => {
    let terminer!: (v: any) => void;
    const lente = vi.fn(() => new Promise<Record<string, any>>((r) => { terminer = r; }));
    const premiere = executerIdempotent(ctx, 'toggle_automation_rule', { rule_id: 'r1', is_active: true }, lente);
    await new Promise((r) => setTimeout(r, 0));
    const seconde = await executerIdempotent(ctx, 'toggle_automation_rule', { rule_id: 'r1', is_active: true }, lente);
    expect(String((seconde as any).error)).toMatch(/en cours/);
    terminer({ ok: true });
    await premiere;
    expect(lente).toHaveBeenCalledTimes(1);
  });

  it('COURTE — double clic : une seule création, et le résultat rendu est MARQUÉ rejoué', async () => {
    const action = vi.fn(async () => ({ created: true, task_id: 't1' }));
    await executerIdempotent(ctx, 'create_task', { title: 'Rappeler Marie' }, action);
    const b = await executerIdempotent(ctx, 'create_task', { title: 'Rappeler Marie' }, action);
    expect(action).toHaveBeenCalledTimes(1);
    expect(b).toMatchObject({ created: true, deja_fait: true, rejoue: true });
  });

  it('COURTE — passé le double clic, la même demande est une NOUVELLE demande', async () => {
    const action = vi.fn(async () => ({ created: true }));
    await executerIdempotent(ctx, 'create_task', { title: 'Rappeler Marie' }, action);
    vieillir(FENETRE_DOUBLE_CLIC_MS + 1_000);
    const b = await executerIdempotent(ctx, 'create_task', { title: 'Rappeler Marie' }, action);
    expect(action).toHaveBeenCalledTimes(2);
    expect(b).not.toHaveProperty('rejoue');
  });

  it('DURABLE — un envoi redemandé 5 minutes plus tard ne repart PAS', async () => {
    expect(FENETRE_DOUBLON_MS).toBeGreaterThan(5 * 60_000);
    const action = vi.fn(async () => ({ envoye: true }));
    await executerIdempotent(ctx, 'send_sms', { to: 'Marie', texte: 'On arrive' }, action);
    vieillir(5 * 60_000);
    const b = await executerIdempotent(ctx, 'send_sms', { to: 'Marie', texte: 'On arrive' }, action);
    expect(action).toHaveBeenCalledTimes(1);
    expect(b).toMatchObject({ envoye: true, deja_fait: true, rejoue: true });
  });

  it('`encoreValable` décide quand l’outil sait vérifier lui-même : vrai = mémorisé, faux = refait', async () => {
    const action = vi.fn(async () => ({ status: 'completed' }));
    await executerIdempotent(ctx, 'update_job_status', { job_id: 'j1', status: 'completed' }, action, { encoreValable: async () => true });
    const garde = await executerIdempotent(ctx, 'update_job_status', { job_id: 'j1', status: 'completed' }, action, { encoreValable: async () => true });
    expect(action).toHaveBeenCalledTimes(1);
    expect(garde).toMatchObject({ rejoue: true });
    const refait = await executerIdempotent(ctx, 'update_job_status', { job_id: 'j1', status: 'completed' }, action, { encoreValable: async () => false });
    expect(action).toHaveBeenCalledTimes(2);
    expect(refait).not.toHaveProperty('rejoue');
  });

  it('une vérification qui plante ne refait pas l’action (on ne double pas un geste sur un doute)', async () => {
    const action = vi.fn(async () => ({ ok: true }));
    const erreurs = vi.spyOn(console, 'error').mockImplementation(() => {});
    await executerIdempotent(ctx, 'reschedule_job', { job_id: 'j1' }, action, { encoreValable: async () => true });
    const b = await executerIdempotent(ctx, 'reschedule_job', { job_id: 'j1' }, action, { encoreValable: async () => { throw new Error('base injoignable'); } });
    expect(action).toHaveBeenCalledTimes(1);
    expect(b).toMatchObject({ rejoue: true });
    erreurs.mockRestore();
  });
});
