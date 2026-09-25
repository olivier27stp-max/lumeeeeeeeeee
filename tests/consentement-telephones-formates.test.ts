/**
 * Consentement SMS commercial : le client importé de Jobber a son numéro stocké
 * « (819) 479-0116 ». La vérification cherchait « +18194790116 » à l'égalité stricte,
 * ne trouvait personne et bloquait l'envoi : « destinataire inconnu du carnet de
 * clients » (Vision Lavage, 2026-09-25, remerciement après job jamais parti).
 * La recherche compare désormais chiffres seuls, quel que soit le format stocké.
 */
import { describe, expect, it, vi } from 'vitest';

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const etat = {
  clients: [{ id: 'c1', org_id: ORG, phone: '(819) 479-0116', email: null, deleted_at: null, sms_consent_at: '2026-01-10T00:00:00Z', email_consent_at: null, email_opt_out_at: null }],
};

function requete(table: string) {
  const filtres: Array<(r: any) => boolean> = [];
  const q: any = {};
  const rows = () => (table === 'clients' ? etat.clients : []).filter((r) => filtres.every((f) => f(r)));
  for (const m of ['select', 'limit', 'range', 'is', 'not', 'order', 'gte', 'lte', 'gt', 'lt', 'neq', 'or']) q[m] = () => q;
  q.eq = (col: string, v: unknown) => { filtres.push((r) => r[col] === v); return q; };
  q.in = (col: string, vs: unknown[]) => { filtres.push((r) => vs.includes(r[col])); return q; };
  q.ilike = (col: string, motif: string) => { const m = motif.replace(/%/g, '').toLowerCase(); filtres.push((r) => String(r[col] ?? '').toLowerCase().includes(m)); return q; };
  q.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
  q.single = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
  q.insert = () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'x' }, error: null }) }), then: (res: any) => Promise.resolve({ data: null, error: null }).then(res) });
  q.upsert = () => Promise.resolve({ data: null, error: null });
  q.update = () => q;
  q.then = (res: any) => Promise.resolve({ data: rows(), error: null, count: rows().length }).then(res);
  return q;
}
const faux: any = { from: (t: string) => requete(t) };

vi.mock('../server/lib/supabase', () => ({ getServiceClient: () => faux }));
vi.mock('../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => '+15145550000' }));
vi.mock('../server/lib/config', () => ({ getTwilioStatusCallbackUrl: () => null }));

describe('SMS commercial vers un client au téléphone formaté', () => {
  it('retrouve le client « (819) 479-0116 » pour +18194790116 et envoie', async () => {
    const { executeAction } = await import('../server/lib/actions/index');
    const create = vi.fn(async () => ({ sid: 'SM1', status: 'queued' }));
    const ctx: any = {
      supabase: faux, orgId: ORG, entityType: 'job', entityId: 'j1', commercial: true,
      twilio: { client: { messages: { create } }, phoneNumber: '+15145550000' }, baseUrl: 'https://lumecrm.net',
    };
    const res = await executeAction('send_sms', { to: '{{client_phone}}', body: 'Merci pour votre confiance !' }, { client_phone: '+18194790116' }, ctx);
    expect(res.error).toBeUndefined();
    expect(res.success).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('un numéro qui n’est à personne reste refusé en commercial', async () => {
    const { executeAction } = await import('../server/lib/actions/index');
    const create = vi.fn(async () => ({ sid: 'SM1', status: 'queued' }));
    const ctx: any = {
      supabase: faux, orgId: ORG, entityType: 'job', entityId: 'j1', commercial: true,
      twilio: { client: { messages: { create } }, phoneNumber: '+15145550000' }, baseUrl: 'https://lumecrm.net',
    };
    const res = await executeAction('send_sms', { to: '{{client_phone}}', body: 'Promo' }, { client_phone: '+18195550116' }, ctx);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/inconnu du carnet/);
    expect(create).not.toHaveBeenCalled();
  });
});
