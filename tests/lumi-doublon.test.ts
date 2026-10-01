/**
 * Anti-doublon des écritures de Lumi (executerIdempotent) — audit 2026-09-30.
 * Avant : l'empreinte (org, outil, arguments) ne vieillissait jamais et
 * ignorait l'utilisateur. La même action redemandée des jours plus tard
 * (relance des retards, texto « on arrive », pointage d'un autre employé)
 * n'était plus jamais exécutée, et Lumi répondait « déjà fait ».
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { table } = vi.hoisted(() => ({ table: [] as Array<{ id: string; org_id: string; user_id: string; outil: string; args_hash: string; resultat: any; created_at: string }> }));

// Faux client service : agent_actions avec l'index unique (org_id, outil, args_hash).
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
vi.mock('../server/lib/supabase', () => ({ getServiceClient: () => ({ from: () => requete() }), companyOrgIds: async () => [] }));
vi.mock('../server/lib/security', () => ({ logSecurityEvent: () => {} }));
vi.mock('../server/lib/lumi/version-org', () => ({ invaliderOrg: async () => {}, versionOrg: async () => 0 }));
vi.mock('../server/lib/config', () => ({ twilioClient: null, getTwilioStatusCallbackUrl: () => '' }));
vi.mock('../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => null, SmsNumberNotProvisionedError: class extends Error {}, SmsNotInPlanError: class extends Error {} }));

import { executerIdempotent, FENETRE_DOUBLON_MS } from '../server/lib/agent/tools-etendus';

const ORG = 'org-1';
const ctx = (userId: string) => ({ client: {} as any, orgId: ORG, userId });

describe('anti-doublon des écritures de Lumi', () => {
  beforeEach(() => { table.length = 0; });

  it('double clic (même personne, mêmes arguments, tout de suite) : une seule exécution', async () => {
    const action = vi.fn(async () => ({ envoye: true }));
    const a = await executerIdempotent(ctx('marc'), 'send_sms', { to: 'Marie', texte: 'On arrive' }, action);
    const b = await executerIdempotent(ctx('marc'), 'send_sms', { to: 'Marie', texte: 'On arrive' }, action);
    expect(action).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ envoye: true });
    expect(b).toMatchObject({ envoye: true, deja_fait: true });
  });

  it('un autre employé avec les mêmes arguments (pointer sans job) : exécuté, pas « déjà fait »', async () => {
    const action = vi.fn(async () => ({ pointe: true }));
    await executerIdempotent(ctx('marc'), 'punch_in', {}, action);
    const b = await executerIdempotent(ctx('julie'), 'punch_in', {}, action);
    expect(action).toHaveBeenCalledTimes(2);
    expect(b).not.toHaveProperty('deja_fait');
  });

  it('la même action redemandée après la fenêtre (relance la semaine suivante) : exécutée de nouveau', async () => {
    const action = vi.fn(async () => ({ relances: 3 }));
    await executerIdempotent(ctx('marc'), 'send_payment_reminders', {}, action);
    table[0].created_at = new Date(Date.now() - FENETRE_DOUBLON_MS - 1000).toISOString();
    const b = await executerIdempotent(ctx('marc'), 'send_payment_reminders', {}, action);
    expect(action).toHaveBeenCalledTimes(2);
    expect(b).toEqual({ relances: 3 });
    expect(table).toHaveLength(1); // l'ancienne empreinte a été remplacée, pas accumulée
  });

  it('une exécution encore en cours : la 2e demande dit « en cours », jamais « c’est fait »', async () => {
    let terminer!: (v: any) => void;
    const lente = vi.fn(() => new Promise<Record<string, any>>((r) => { terminer = r; }));
    const premiere = executerIdempotent(ctx('marc'), 'charge_card_on_file', { montant: 5000 }, lente);
    await new Promise((r) => setTimeout(r, 0));
    const seconde = await executerIdempotent(ctx('marc'), 'charge_card_on_file', { montant: 5000 }, lente);
    expect(seconde).toHaveProperty('error');
    expect(String((seconde as any).error)).toMatch(/en cours/);
    expect(lente).toHaveBeenCalledTimes(1);
    terminer({ debite: true });
    expect(await premiere).toEqual({ debite: true });
  });

  it('un échec « propre » libère l’empreinte : réessayer après correction est possible', async () => {
    const echoue = vi.fn(async () => { throw new Error('Le client n\'a pas de carte enregistrée.'); });
    const r = await executerIdempotent(ctx('marc'), 'charge_card_on_file', { montant: 5000 }, echoue);
    expect(r).toHaveProperty('error');
    expect(table).toHaveLength(0);
  });
});
