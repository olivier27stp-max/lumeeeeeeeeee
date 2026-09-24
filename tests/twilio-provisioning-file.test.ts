/**
 * Achat automatique du numéro SMS à l'abonnement : interrupteur, file d'attente,
 * relance, classement des échecs, et surtout « jamais deux numéros payés ».
 * Twilio et Supabase sont simulés — aucun achat, aucun envoi.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Ligne = Record<string, any>;
const db: Record<string, Ligne[]> = {};
let idSeq = 0;

/** Constructeur de requête minimal, fidèle à ce que le module utilise. */
function requete(table: string) {
  const filtres: Array<(l: Ligne) => boolean> = [];
  let op: 'select' | 'insert' | 'update' = 'select';
  let valeurs: Ligne = {};
  let limite = Infinity;
  let tri: { col: string; asc: boolean } | null = null;
  const lignes = () => (db[table] ||= []);
  const executer = () => {
    if (op === 'insert') {
      const l = { id: `id-${++idSeq}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), twilio_sid: null, twilio_number: null, attempt_count: 1, metadata: {}, ...valeurs };
      lignes().push(l);
      return [l];
    }
    let res = lignes().filter((l) => filtres.every((f) => f(l)));
    if (op === 'update') {
      for (const l of res) Object.assign(l, valeurs, { updated_at: new Date().toISOString() });
    }
    if (tri) res = [...res].sort((a, b) => (a[tri!.col] < b[tri!.col] ? -1 : 1) * (tri!.asc ? 1 : -1));
    return res.slice(0, limite);
  };
  const q: any = {
    select: () => q,
    insert: (v: Ligne) => { op = 'insert'; valeurs = v; return q; },
    update: (v: Ligne) => { op = 'update'; valeurs = v; return q; },
    eq: (c: string, v: unknown) => { filtres.push((l) => l[c] === v); return q; },
    in: (c: string, v: unknown[]) => { filtres.push((l) => v.includes(l[c])); return q; },
    order: (col: string, o?: { ascending?: boolean }) => { tri = { col, asc: o?.ascending !== false }; return q; },
    limit: (n: number) => { limite = n; return q; },
    maybeSingle: async () => ({ data: executer()[0] ?? null, error: null }),
    single: async () => ({ data: executer()[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: executer(), error: null }).then(ok),
  };
  return q;
}

const rpc = vi.fn(async (_nom: string, args: Ligne) => {
  (db.communication_channels ||= []).push({ id: `ch-${++idSeq}`, org_id: args.p_org_id, channel_type: 'sms', status: 'active', phone_number: args.p_phone_number, metadata: args.p_metadata });
  return { data: `ch-${idSeq}`, error: null };
});
vi.mock('../server/lib/supabase', () => ({ getServiceClient: () => ({ from: requete, rpc }) }));

const achat = vi.fn();
const disponibles = vi.fn();
vi.mock('../server/lib/config', () => ({
  twilioProvisioningClient: {
    incomingPhoneNumbers: { create: (...a: unknown[]) => achat(...a) },
    availablePhoneNumbers: () => ({ local: { list: (...a: unknown[]) => disponibles(...a) } }),
  },
}));
const slack = vi.fn(async () => ({ ts: '1', channel: 'C' }));
vi.mock('../server/lib/slack', () => ({ isSlackConfigured: () => true, canalSupport: () => 'C1', envoyerMessageSlack: slack }));
vi.mock('../server/lib/sentry', () => ({ captureException: vi.fn() }));
vi.mock('../server/lib/twilioRelease', () => ({ cancelSmsNumberRelease: async () => false }));

const mod = await import('../server/lib/twilioProvisioning');
const ORG = '11111111-2222-3333-4444-555555555555';

function forfaitAvecSms() {
  db.subscriptions = [{ org_id: ORG, plan_id: 'p1', status: 'active' }];
  db.plans = [{ id: 'p1', includes_sms: true }];
}
const evenements = () => db.provisioning_events || [];

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  vi.clearAllMocks();
  process.env.PUBLIC_URL = 'https://lumecrm.net';
  delete process.env.TWILIO_AUTO_PROVISION;
  disponibles.mockResolvedValue([{ phoneNumber: '+15145550100' }]);
  achat.mockResolvedValue({ sid: 'PNnouveau', phoneNumber: '+15145550100', friendlyName: 'Lume-11111111' });
  forfaitAvecSms();
});

describe('interrupteur TWILIO_AUTO_PROVISION', () => {
  it('éteint : n’achète rien, met en file et prévient l’équipe', async () => {
    process.env.TWILIO_AUTO_PROVISION = 'false';
    const r = await mod.provisionSmsForNewSubscription({ orgId: ORG, subscriptionId: 's1' });
    expect(r).toMatchObject({ provisioned: false, skipped: 'auto_provision_off' });
    expect(achat).not.toHaveBeenCalled();
    expect(evenements()).toHaveLength(1);
    expect(evenements()[0]).toMatchObject({ status: 'retrying', attempt_count: 0 });
    expect(slack).toHaveBeenCalledTimes(1);
  });

  it('éteint : la relance ne fait rien', async () => {
    process.env.TWILIO_AUTO_PROVISION = 'false';
    expect(await mod.relancerProvisionnementsEnAttente()).toMatchObject({ desactive: true, essayes: 0 });
  });

  it('allumé plus tard : la demande en file est servie par la relance', async () => {
    process.env.TWILIO_AUTO_PROVISION = 'false';
    await mod.provisionSmsForNewSubscription({ orgId: ORG, subscriptionId: 's1' });
    delete process.env.TWILIO_AUTO_PROVISION;
    const bilan = await mod.relancerProvisionnementsEnAttente();
    expect(bilan).toMatchObject({ essayes: 1, reussis: 1 });
    expect(achat).toHaveBeenCalledTimes(1);
    expect(evenements()[0]).toMatchObject({ status: 'success', twilio_number: '+15145550100', attempt_count: 1 });
  });
});

describe('abonnement → numéro', () => {
  it('achète avec le webhook SMS de Lume, sans URL voix', async () => {
    const r = await mod.provisionSmsForNewSubscription({ orgId: ORG, subscriptionId: 's1' });
    expect(r).toMatchObject({ provisioned: true, phoneNumber: '+15145550100' });
    const params = achat.mock.calls[0][0];
    expect(params.smsUrl).toBe('https://lumecrm.net/api/messages/inbound');
    expect(params).not.toHaveProperty('voiceUrl');
    expect(rpc).toHaveBeenCalledWith('provision_sms_channel', expect.objectContaining({ p_org_id: ORG, p_phone_number: '+15145550100' }));
  });

  it('idempotent : un second appel (rejeu Stripe) n’achète pas', async () => {
    await mod.provisionSmsForNewSubscription({ orgId: ORG, subscriptionId: 's1' });
    const r = await mod.provisionSmsForNewSubscription({ orgId: ORG, subscriptionId: 's1' });
    expect(r.skipped).toBe('already_has_channel');
    expect(achat).toHaveBeenCalledTimes(1);
  });

  it('idempotent : une demande déjà en file bloque un second achat', async () => {
    achat.mockRejectedValueOnce(Object.assign(new Error('Customer profile is not approved'), { status: 400 }));
    await mod.provisionSmsForNewSubscription({ orgId: ORG, subscriptionId: 's1' });
    const r = await mod.provisionSmsForNewSubscription({ orgId: ORG, subscriptionId: 's1' });
    expect(r.skipped).toBe('already_queued');
    expect(achat).toHaveBeenCalledTimes(1);
  });
});

describe('échec → en attente, jamais un rollback', () => {
  it('conformité : statut retrying, nature classée, prochain essai planifié', async () => {
    achat.mockRejectedValueOnce(Object.assign(new Error('Your Primary Customer Profile must be Twilio-approved'), { status: 400, code: 21649 }));
    const r = await mod.provisionSmsForNewSubscription({ orgId: ORG, subscriptionId: 's1' });
    expect(r).toMatchObject({ provisioned: false, nature: 'conformite' });
    const e = evenements()[0];
    expect(e.status).toBe('retrying');
    expect(e.metadata.nature).toBe('conformite');
    expect(new Date(e.metadata.prochain_essai).getTime()).toBeGreaterThan(Date.now());
    expect(slack).toHaveBeenCalledTimes(1);
  });

  it('la relance respecte le délai puis réussit', async () => {
    achat.mockRejectedValueOnce(new Error('regulatory bundle required'));
    await mod.provisionSmsForNewSubscription({ orgId: ORG, subscriptionId: 's1' });
    expect(await mod.relancerProvisionnementsEnAttente()).toMatchObject({ essayes: 0, ignores: 1 });
    evenements()[0].metadata.prochain_essai = new Date(Date.now() - 1000).toISOString();
    expect(await mod.relancerProvisionnementsEnAttente()).toMatchObject({ essayes: 1, reussis: 1 });
    expect(evenements()[0]).toMatchObject({ status: 'success', attempt_count: 2 });
  });

  it('numéro acheté mais non enregistré : la relance l’enregistre SANS racheter', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'db down' } } as any);
    const r = await mod.provisionSmsForNewSubscription({ orgId: ORG, subscriptionId: 's1' });
    expect(r.nature).toBe('enregistrement');
    expect(evenements()[0]).toMatchObject({ twilio_sid: 'PNnouveau', twilio_number: '+15145550100' });
    evenements()[0].metadata.prochain_essai = null;
    await mod.relancerProvisionnementsEnAttente();
    expect(achat).toHaveBeenCalledTimes(1);
    expect(db.communication_channels?.[0]).toMatchObject({ phone_number: '+15145550100' });
    expect(evenements()[0].status).toBe('success');
  });

  it('forfait sans SMS entre-temps : abandon, aucun achat', async () => {
    achat.mockRejectedValueOnce(new Error('No SMS-capable numbers available for country=CA.'));
    await mod.provisionSmsForNewSubscription({ orgId: ORG, subscriptionId: 's1' });
    db.plans = [{ id: 'p1', includes_sms: false }];
    evenements()[0].metadata.prochain_essai = null;
    expect(await mod.relancerProvisionnementsEnAttente()).toMatchObject({ abandonnes: 1, essayes: 0 });
    expect(achat).toHaveBeenCalledTimes(1);
  });

  it('au-delà de 14 jours depuis le 1er essai : failed terminal', async () => {
    achat.mockRejectedValue(new Error('regulatory bundle required'));
    await mod.provisionSmsForNewSubscription({ orgId: ORG, subscriptionId: 's1' });
    const e = evenements()[0];
    e.metadata.premier_essai = new Date(Date.now() - 15 * 86400_000).toISOString();
    e.metadata.prochain_essai = null;
    await mod.relancerProvisionnementsEnAttente();
    expect(e.status).toBe('failed');
    expect(await mod.etatProvisionnementSms(ORG)).toMatchObject({ statut: 'echec' });
  });
});

describe('classement et délais', () => {
  it.each([
    [new Error('Twilio is not configured.'), 'configuration'],
    [Object.assign(new Error('Authenticate'), { code: 20003, status: 401 }), 'permissions'],
    [new Error('No SMS-capable numbers available for country=CA.'), 'inventaire'],
    [new Error('An Address is required'), 'conformite'],
    [new Error('boom'), 'autre'],
  ])('%s → %s', (err, nature) => {
    expect(mod.classerEchecProvisionnement(err)).toBe(nature);
  });

  it('backoff 15 min → 24 h plafonné', () => {
    expect(mod.delaiAvantRelanceMs(1)).toBe(15 * 60_000);
    expect(mod.delaiAvantRelanceMs(2)).toBe(60 * 60_000);
    expect(mod.delaiAvantRelanceMs(9)).toBe(24 * 3600_000);
  });

  it('état exposé à l’UI : en_attente pendant la file', async () => {
    process.env.TWILIO_AUTO_PROVISION = 'false';
    await mod.provisionSmsForNewSubscription({ orgId: ORG, subscriptionId: 's1' });
    expect(await mod.etatProvisionnementSms(ORG)).toMatchObject({ statut: 'en_attente', nature: 'desactive' });
  });
});
