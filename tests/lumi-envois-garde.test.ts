/**
 * Envois de Lumi (audit des outils, 2026-09-30).
 * - send_email : seulement à un client/prospect du CRM, jamais à une adresse
 *   désabonnée ou qui rebondit (une consigne glissée dans une note ne peut pas
 *   faire écrire à une adresse externe).
 * - send_payment_reminders : seulement aux clients qui doivent de l'argent,
 *   un texto par client, et « 0 envoyé » est un échec, pas « c'est fait ».
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { tables, injoignables } = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  injoignables: new Set<string>(),
}));

// Client minimal : filtres eq / ilike / in / is / gt / neq / not in, sur des tables en mémoire.
function requete(nom: string) {
  const filtres: Array<(r: any) => boolean> = [];
  let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  let ligne: any = null;
  let maj: any = null;
  const lignes = () => (tables[nom] ??= []).filter((r) => filtres.every((f) => f(r)));
  const q: any = {
    select: () => q,
    insert: (l: any) => { op = 'insert'; ligne = l; return q; },
    update: (m: any) => { op = 'update'; maj = m; return q; },
    delete: () => { op = 'delete'; return q; },
    eq: (k: string, v: any) => { filtres.push((r) => r[k] === v); return q; },
    neq: (k: string, v: any) => { filtres.push((r) => r[k] !== v); return q; },
    ilike: (k: string, v: string) => { filtres.push((r) => String(r[k] ?? '').toLowerCase() === v.toLowerCase()); return q; },
    in: (k: string, v: any[]) => { filtres.push((r) => v.includes(r[k])); return q; },
    is: (k: string, v: any) => { filtres.push((r) => (r[k] ?? null) === v); return q; },
    gt: (k: string, v: number) => { filtres.push((r) => Number(r[k]) > v); return q; },
    not: (k: string, _op: string, liste: string) => { const l = liste.replace(/[()]/g, '').split(','); filtres.push((r) => !l.includes(r[k])); return q; },
    limit: () => q,
    order: () => q,
    maybeSingle: async () => executer(true),
    single: async () => executer(true),
    then: (ok: any, ko: any) => Promise.resolve(executer(false)).then(ok, ko),
  };
  function executer(un: boolean) {
    const t = (tables[nom] ??= []);
    if (op === 'insert') { const r = { id: `r${t.length + 1}`, resultat: {}, created_at: new Date().toISOString(), ...ligne }; t.push(r); return { data: { id: r.id }, error: null }; }
    if (op === 'update') { for (const r of lignes()) Object.assign(r, maj); return { data: null, error: null }; }
    if (op === 'delete') { for (const r of lignes()) t.splice(t.indexOf(r), 1); return { data: null, error: null }; }
    const l = lignes();
    return { data: un ? (l[0] ?? null) : l, error: null };
  }
  return q;
}
const db = { from: (t: string) => requete(t) };

vi.mock('../server/lib/supabase', () => ({ getServiceClient: () => db, companyOrgIds: async () => [] }));
vi.mock('../server/lib/security', () => ({ logSecurityEvent: () => {} }));
vi.mock('../server/lib/lumi/version-org', () => ({ invaliderOrg: async () => {}, versionOrg: async () => 0 }));
vi.mock('../server/lib/config', () => ({ twilioClient: null, getTwilioStatusCallbackUrl: () => '' }));
vi.mock('../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => null, SmsNumberNotProvisionedError: class extends Error {}, SmsNotInPlanError: class extends Error {} }));
vi.mock('../server/lib/mailer', () => ({ adresseInjoignable: async (_o: string, e: string) => injoignables.has(e.toLowerCase()) }));

import { TOOLS_BY_NAME } from '../server/lib/agent/tools';

const ORG = 'org-1';
const ctx = { client: db as any, orgId: ORG, userId: 'u1' };
const envoyerCourriel = (args: Record<string, unknown>) => TOOLS_BY_NAME.send_email.handler!(args, ctx as any);
const relancer = (args: Record<string, unknown>) => TOOLS_BY_NAME.send_payment_reminders.handler!(args, ctx as any);

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  injoignables.clear();
  tables.clients = [
    { id: 'c1', org_id: ORG, first_name: 'Marie', last_name: 'Tremblay', email: 'Marie.T@exemple.ca', phone: '+15145550001', deleted_at: null },
    { id: 'c2', org_id: ORG, first_name: 'Paul', last_name: 'Roy', email: 'paul@exemple.ca', phone: null, deleted_at: null },
    { id: 'c3', org_id: 'autre-org', first_name: 'Externe', last_name: 'X', email: 'pirate@exemple.com', phone: '+15145550009', deleted_at: null },
  ];
  tables.invoices = [
    { id: 'f1', org_id: ORG, client_id: 'c2', balance_cents: 5000, status: 'sent', deleted_at: null },
    { id: 'f2', org_id: ORG, client_id: 'c1', balance_cents: 0, status: 'paid', deleted_at: null },
  ];
});

describe('send_email : destinataire du CRM seulement', () => {
  const base = { subject: 'Suivi', message: 'Bonjour' };

  it('une adresse hors du CRM (ou d’une autre entreprise) est refusée', async () => {
    const r: any = await envoyerCourriel({ ...base, to: 'pirate@exemple.com' });
    expect(r.error).toMatch(/client ou un prospect de ton CRM/);
  });

  it('« _ » n’est pas un joker : une adresse voisine ne passe pas pour le client', async () => {
    tables.clients.push({ id: 'c4', org_id: ORG, first_name: 'A', last_name: 'B', email: 'a_b@exemple.ca', phone: null, deleted_at: null });
    const r: any = await envoyerCourriel({ ...base, to: 'axb@exemple.ca' });
    expect(r.error).toMatch(/CRM/);
  });

  it('client désabonné des courriels : refusé', async () => {
    tables.email_unsubscribes = [{ org_id: ORG, email: 'marie.t@exemple.ca', category: 'all', unsubscribed_at: '2026-09-01' }];
    const r: any = await envoyerCourriel({ ...base, to: 'marie.t@exemple.ca' });
    expect(r.error).toMatch(/désabonné/);
  });

  it('adresse qui rebondit : refusée', async () => {
    injoignables.add('marie.t@exemple.ca');
    const r: any = await envoyerCourriel({ ...base, to: 'MARIE.T@exemple.ca' });
    expect(r.error).toMatch(/rebondi/);
  });
});

describe('send_payment_reminders : aux vrais retards, une fois, et pas de faux « fait »', () => {
  it('client à jour ou sans numéro : rien ne part → échec explicite, pas « c’est fait »', async () => {
    const r: any = await relancer({ reminders: [
      { client_id: 'c1', message: 'Petit rappel' },
      { client_id: 'c2', message: 'Petit rappel' },
    ] });
    expect(r.error).toMatch(/Aucun rappel n’est parti/);
    expect(r.error).toMatch(/Marie Tremblay : aucune facture impayée/);
    expect(r.error).toMatch(/Paul Roy : aucun numéro/);
  });

  it('un client d’une autre entreprise n’est jamais relancé', async () => {
    const r: any = await relancer({ reminders: [{ client_id: 'c3', message: 'Payez' }] });
    expect(r.error).toMatch(/client introuvable/);
  });

  it('le même client deux fois dans la liste : un seul rappel', async () => {
    tables.invoices.push({ id: 'f3', org_id: ORG, client_id: 'c1', balance_cents: 900, status: 'overdue', deleted_at: null });
    const r: any = await relancer({ reminders: [
      { client_id: 'c1', message: 'Rappel 1' },
      { client_id: 'c1', message: 'Rappel 2' },
    ] });
    // Twilio absent ici : le premier échoue à l'envoi, le second est écarté comme doublon.
    expect(r.error).toMatch(/déjà dans la liste/);
  });
});

describe('demandes de paiement : un canal demandé qui ne part pas est dit', () => {
  it('canauxNonPartis : absent de la fiche, refusé, ou parti', async () => {
    const { canauxNonPartis } = await import('../server/lib/agent/tools-argent');
    expect(canauxNonPartis('link_only', {})).toEqual({ demandes: 0, rates: [] });
    expect(canauxNonPartis('email', {})).toEqual({ demandes: 1, rates: ['courriel : aucune adresse courriel sur la fiche du client'] });
    expect(canauxNonPartis('both', { email: { sent: true }, sms: { sent: false, reason: 'Recipient has opted out of SMS (STOP)' } }))
      .toEqual({ demandes: 2, rates: ['texto : Recipient has opted out of SMS (STOP)'] });
  });
});
