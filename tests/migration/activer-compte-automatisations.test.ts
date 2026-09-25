/**
 * « Activer le compte » active-t-il VRAIMENT les automatisations ?
 *
 * Preuve dynamique, pas seulement statique : un faux Supabase à état (org_features +
 * clients), le vrai module de gel et la vraie action d'automatisation `send_sms`.
 *  1. import final → gelerCommunications : l'action refuse d'envoyer, Twilio n'est jamais appelé ;
 *  2. « Activer le compte » → activerCommunications : la même action envoie, Twilio est appelé ;
 *  3. le cache de 20 s du gel est invalidé à l'activation (sinon l'automatisation restait
 *     bloquée jusqu'à 20 s après le clic) ;
 *  4. un bureau jamais gelé n'est pas touché par l'activation d'un autre.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { cacheDelete } from '../../server/lib/cache';

// ── Faux Supabase à état ─────────────────────────────────────────────────────
type Feature = { org_id: string; feature: string; enabled: boolean; metadata: Record<string, unknown> };
const etat = { features: [] as Feature[], clients: [] as Array<{ org_id: string; email: string | null; phone: string | null; deleted_at: null }> };

function requete(table: string) {
  const filtres: Array<(r: any) => boolean> = [];
  const q: any = {};
  const rows = () => {
    const src = table === 'org_features' ? etat.features : table === 'clients' ? etat.clients : [];
    return src.filter((r) => filtres.every((f) => f(r)));
  };
  q.select = () => q;
  q.limit = () => q;
  q.range = () => q;
  q.not = () => q;
  q.is = () => q;
  q.eq = (col: string, v: unknown) => { filtres.push((r) => r[col] === v); return q; };
  q.in = (col: string, vs: unknown[]) => { filtres.push((r) => vs.includes(r[col])); return q; };
  q.ilike = (col: string, motif: string) => { const m = motif.replace(/%/g, '').toLowerCase(); filtres.push((r) => String(r[col] ?? '').toLowerCase().includes(m)); return q; };
  q.or = (expr: string) => {
    const parts = expr.split(',').map((p) => p.split('.'));
    filtres.push((r) => parts.some(([col, , val]) => String(r[col] ?? '').toLowerCase().includes(String(val).replace(/%/g, '').toLowerCase())));
    return q;
  };
  q.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
  q.single = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
  q.upsert = (row: Feature) => {
    const i = etat.features.findIndex((f) => f.org_id === row.org_id && f.feature === row.feature);
    if (i >= 0) etat.features[i] = { ...etat.features[i], ...row }; else etat.features.push(row);
    return Promise.resolve({ data: null, error: null });
  };
  q.insert = () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'conv-1' }, error: null }) }), then: (res: any) => Promise.resolve({ data: null, error: null }).then(res) });
  q.update = () => q;
  q.order = () => q;
  q.then = (res: any) => Promise.resolve({ data: rows(), error: null }).then(res);
  return q;
}
const fauxAdmin: any = { from: (table: string) => requete(table) };

vi.mock('../../server/lib/supabase', () => ({ getServiceClient: () => fauxAdmin }));
vi.mock('../../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => '+15145550000' }));
vi.mock('../../server/lib/config', () => ({ getTwilioStatusCallbackUrl: () => null }));

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MIG = 'mmmmmmmm-mmmm-4mmm-8mmm-mmmmmmmmmmmm';

beforeEach(() => {
  etat.features = [];
  etat.clients = [
    { org_id: ORG_A, email: 'client@exemple.ca', phone: '(514) 555-1234', deleted_at: null },
    { org_id: ORG_B, email: 'autre@exemple.ca', phone: '(438) 555-9999', deleted_at: null },
  ];
  cacheDelete('gel-communications:orgs');
  cacheDelete('gel-communications:contacts');
});

async function envoyerSmsAutomatisation(orgId: string, to: string) {
  const { executeAction } = await import('../../server/lib/actions/index');
  // `vi.fn(async () => …)` donne un tuple d'arguments VIDE : TypeScript
  // refuse alors `create.mock.calls[0][0]` (TS2493). On déclare des
  // arguments variadiques pour pouvoir inspecter l'appel.
  const create = vi.fn(async (..._a: any[]) => ({ sid: 'SM1', status: 'queued' }));
  const ctx: any = {
    supabase: fauxAdmin, orgId, entityType: 'job', entityId: 'j1',
    twilio: { client: { messages: { create } }, phoneNumber: '+15145550000' }, baseUrl: 'https://lumecrm.net',
  };
  const res = await executeAction('send_sms', { to, body: 'Rappel : votre visite est demain.' }, { client_phone: to }, ctx);
  return { res, create };
}

describe('Activer le compte → automatisations', () => {
  it('pendant le gel, l’automatisation SMS vers un client importé ne part pas (Twilio jamais appelé)', async () => {
    const { gelerCommunications, MESSAGE_GEL } = await import('../../server/lib/migration/gel-communications');
    await gelerCommunications(fauxAdmin, ORG_A, MIG);
    const { res, create } = await envoyerSmsAutomatisation(ORG_A, '+15145551234');
    expect(res.success).toBe(false);
    expect(res.error).toBe(MESSAGE_GEL);
    expect(create).not.toHaveBeenCalled();
  });

  it('après « Activer le compte », la même automatisation envoie (Twilio appelé une fois)', async () => {
    const { gelerCommunications, activerCommunications, etatGel } = await import('../../server/lib/migration/gel-communications');
    await gelerCommunications(fauxAdmin, ORG_A, MIG);
    // Le gel est lu (et mis en cache 20 s) une première fois…
    expect((await envoyerSmsAutomatisation(ORG_A, '+15145551234')).res.success).toBe(false);
    // … puis l'activation doit prendre effet IMMÉDIATEMENT, sans attendre l'expiration du cache.
    await activerCommunications(fauxAdmin, ORG_A, 'admin-1');
    const apres = await etatGel(fauxAdmin, ORG_A);
    expect(apres.gele).toBe(false);
    expect(apres.active_par).toBe('admin-1');
    expect(apres.migration_id).toBe(MIG);
    const { res, create } = await envoyerSmsAutomatisation(ORG_A, '+15145551234');
    expect(res.success).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ to: '+15145551234', from: '+15145550000' });
  });

  it('le gel d’un bureau ne bloque jamais un autre bureau, et son activation ne le touche pas non plus', async () => {
    const { gelerCommunications, activerCommunications, destinataireGele } = await import('../../server/lib/migration/gel-communications');
    await gelerCommunications(fauxAdmin, ORG_A, MIG);
    expect((await envoyerSmsAutomatisation(ORG_B, '+14385559999')).res.success).toBe(true);
    await activerCommunications(fauxAdmin, ORG_A, 'admin-1');
    expect(await destinataireGele(fauxAdmin, { phone: '+14385559999' }, ORG_B)).toBeNull();
    expect(await destinataireGele(fauxAdmin, { email: 'client@exemple.ca' }, ORG_A)).toBeNull();
  });

  it('activer un bureau jamais gelé n’échoue pas et le laisse actif', async () => {
    const { activerCommunications, etatGel } = await import('../../server/lib/migration/gel-communications');
    await expect(activerCommunications(fauxAdmin, ORG_B, 'admin-1')).resolves.toBeUndefined();
    expect((await etatGel(fauxAdmin, ORG_B)).gele).toBe(false);
  });
});
