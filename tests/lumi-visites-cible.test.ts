/**
 * Quelle visite « déplace / annule la visite du job » touche (audit 2026-09-30).
 * Avant : la prochaine, SINON LA DERNIÈRE PASSÉE, même terminée.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const service = () => {
  const q: any = {};
  for (const m of ['select', 'eq', 'update', 'delete', 'insert']) q[m] = () => q;
  q.maybeSingle = async () => ({ data: { id: 'a1' }, error: null });
  q.single = q.maybeSingle;
  q.then = (ok: any) => Promise.resolve({ data: null, error: null }).then(ok);
  return q;
};
vi.mock('../server/lib/supabase', () => ({ getServiceClient: () => ({ from: service }), companyOrgIds: async () => [] }));
vi.mock('../server/lib/security', () => ({ logSecurityEvent: () => {} }));
vi.mock('../server/lib/lumi/version-org', () => ({ invaliderOrg: async () => {}, versionOrg: async () => 0 }));
vi.mock('../server/lib/config', () => ({ twilioClient: null, getTwilioStatusCallbackUrl: () => '' }));
vi.mock('../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => null, SmsNumberNotProvisionedError: class extends Error {}, SmsNotInPlanError: class extends Error {} }));

import { TOOLS_BY_NAME } from '../server/lib/agent/tools';

const jour = (d: number) => new Date(Date.now() + d * 86400000).toISOString();
let visites: any[] = [];
const rpc: Array<[string, any]> = [];
const client: any = {
  rpc: async (fn: string, p: any) => { rpc.push([fn, p]); return { data: { overlaps: 0 }, error: null }; },
  from: () => {
    const q: any = {};
    for (const m of ['select', 'eq', 'is', 'order']) q[m] = () => q;
    q.then = (ok: any) => Promise.resolve({ data: visites, error: null }).then(ok);
    return q;
  },
};
const ctx = { client, orgId: 'org', userId: 'u', accessToken: 'jeton' };

beforeEach(() => { rpc.length = 0; });

describe('ciblage de la visite', () => {
  it('annuler sans visit_id sur un job dont toutes les visites sont passées : refus, rien n’est supprimé', async () => {
    visites = [{ id: 'v1', start_at: jour(-10), end_at: jour(-10), status: 'completed' }];
    const r: any = await TOOLS_BY_NAME.cancel_visit.handler({ job_id: 'J1' }, ctx as any);
    expect(r.error).toMatch(/aucune visite à venir/);
    expect(rpc).toEqual([]);
  });

  it('sans visit_id : la prochaine visite à venir non terminée', async () => {
    visites = [
      { id: 'passee', start_at: jour(-3), end_at: jour(-3), status: 'completed' },
      { id: 'prochaine', start_at: jour(2), end_at: jour(2), status: 'scheduled' },
      { id: 'suivante', start_at: jour(9), end_at: jour(9), status: 'scheduled' },
    ];
    const r: any = await TOOLS_BY_NAME.reschedule_job.handler({ job_id: 'J2', start_at: jour(4) }, ctx as any);
    expect(rpc.find(([fn]) => fn === 'rpc_reschedule_event')![1].p_event_id).toBe('prochaine');
    expect(r).toMatchObject({ rescheduled: true, autres_visites_a_venir: 1 });
  });

  it('avec visit_id : exactement celle-là, même passée ; une visite d’un autre job est refusée', async () => {
    const r: any = await TOOLS_BY_NAME.cancel_visit.handler({ job_id: 'J3', visit_id: 'passee' }, ctx as any);
    expect(r.cancelled).toBe(true);
    expect(rpc.find(([fn]) => fn === 'rpc_unschedule_job')![1].p_event_id).toBe('passee');
    const e: any = await TOOLS_BY_NAME.cancel_visit.handler({ job_id: 'J4', visit_id: 'autre-job' }, ctx as any);
    expect(e.error).toMatch(/n’appartient pas à ce job/);
  });
});
