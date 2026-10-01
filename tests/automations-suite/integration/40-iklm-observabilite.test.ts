/**
 * L — Observabilité : ce que `automation_execution_logs` retient vraiment
 * d'une exécution, et si `get_automation_health` (outil Lumi, vraie garde,
 * JWT du propriétaire A) reflète la réalité — y compris un fournisseur en
 * PANNE (bac à sable `mode = 'panne'`) et les envois SAUTÉS.
 *
 * Les préréglages du bureau A sont mis en pause pendant ce fichier : ils
 * réagiraient à lead.created et noieraient le journal que l'outil résume
 * (100 dernières lignes). Leur état est restauré à la fin.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { demarrerMoteur, marque, attendre } from '../harnais/moteur';
import { journalDefinitif } from '../harnais/moteur';
import { sessionDe, COMPTES } from '../harnais/bureau-test';

let b: Awaited<ReturnType<typeof demarrerMoteur>>;
let clientJwt: import('@supabase/supabase-js').SupabaseClient;
const actifsAvant: string[] = [];
const regles: string[] = [];
const clients: string[] = [];

async function outil(name: string, orgId: string, userId: string, c = clientJwt): Promise<Record<string, any>> {
  const { executerOutilGarde } = await import('../../../server/lib/agent/garde');
  const r = await executerOutilGarde({ name, args: {}, userId, orgId, client: c });
  if ('refus' in r) throw new Error(`refus : ${r.refus}`);
  return r.result as Record<string, any>;
}

async function mode(m: 'succes' | 'panne') {
  await b.admin.from('orgs_envois_simules').update({ mode: m }).eq('org_id', b.orgA);
  (await import('../../../server/lib/bac-a-sable')).oublierBacASable();
}

async function nouveauClient(m: string, avecTelephone = true): Promise<string> {
  const { data, error } = await b.admin.from('clients').insert({
    org_id: b.orgA, created_by: b.users.proprioA, first_name: 'Obs', last_name: m, status: 'lead',
    ...(avecTelephone ? { phone: '+15555550142' } : {}), email: 'obs@lume-qa.test',
    sms_consent_at: new Date().toISOString(), email_consent_at: new Date().toISOString(),
  }).select('id').single();
  if (error) throw new Error(error.message);
  clients.push(data.id as string);
  return data.id as string;
}

async function regle(m: string, actions: unknown[], conditions: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await b.admin.from('automation_rules').insert({
    org_id: b.orgA, name: m, trigger_event: 'lead.created', conditions, delay_seconds: 0, is_active: true, is_preset: false, actions,
  }).select('id').single();
  if (error) throw new Error(error.message);
  regles.push(data.id as string);
  return data.id as string;
}

/** Les lignes FINALES d'une règle (une action immédiate réserve d'abord sa ligne « en cours »). */
async function journal(ruleId: string, n = 1) {
  const lignes = await attendre(
    async () => (await b.admin.from('automation_execution_logs').select('*').eq('automation_rule_id', ruleId).order('created_at')).data ?? [],
    (l) => l.length >= n && l.every((x) => journalDefinitif(x.result_error)),
  );
  // Une règle ne sert qu'à son test : elle ne doit pas réagir aux prospects des suivants.
  await b.admin.from('automation_rules').update({ is_active: false }).eq('id', ruleId);
  return lignes;
}

beforeAll(async () => {
  b = await demarrerMoteur();
  const { jeton } = await sessionDe(b.admin, COMPTES.proprioA.email);
  const { buildSupabaseWithAuth } = await import('../../../server/lib/supabase');
  clientJwt = buildSupabaseWithAuth(`Bearer ${jeton}`, b.orgA);
  const { data } = await b.admin.from('automation_rules').select('id').eq('org_id', b.orgA).eq('is_active', true).eq('is_preset', true);
  for (const r of data ?? []) actifsAvant.push(r.id as string);
  if (actifsAvant.length) await b.admin.from('automation_rules').update({ is_active: false }).in('id', actifsAvant);
});

afterAll(async () => {
  await mode('succes');
  if (actifsAvant.length) await b.admin.from('automation_rules').update({ is_active: true }).in('id', actifsAvant);
  if (regles.length) await b.admin.from('automation_rules').delete().in('id', regles);
  if (clients.length) await b.admin.from('clients').delete().in('id', clients);
});

describe('L — ce que le journal d’exécution retient', () => {
  it('[L-001] une action réussie : événement, entité, action, config, succès, durée, clé d’exécution, règle', async () => {
    const m = marque('L-001');
    const id = await regle(m, [{ type: 'create_notification', config: { title: `Obs ${m}`, body: 'x' } }]);
    const client = await nouveauClient(m);
    await b.eventBus.emit('lead.created', { orgId: b.orgA, entityType: 'client', entityId: client, metadata: { source: 'manuel' } });
    const [l] = await journal(id);
    expect(l).toMatchObject({
      org_id: b.orgA, automation_rule_id: id, trigger_event: 'lead.created', entity_type: 'client', entity_id: client,
      action_type: 'create_notification', result_success: true, result_error: null,
    });
    expect((l.action_config as Record<string, unknown>).title).toBe(`Obs ${m}`);
    expect(typeof l.duration_ms).toBe('number');
    expect(String(l.execution_key ?? '')).toContain(id);
  });

  it('[L-002] fournisseur en PANNE : une ligne en échec avec l’erreur du fournisseur', async () => {
    const m = marque('L-002');
    const id = await regle(m, [{ type: 'send_sms', config: { body: `Bonjour ${m}`, type_envoi: 'transactionnel' } }]);
    const client = await nouveauClient(m);
    await mode('panne');
    try {
      await b.eventBus.emit('lead.created', { orgId: b.orgA, entityType: 'client', entityId: client, metadata: { source: 'manuel' } });
      const lignes = await journal(id);
      const finale = lignes[lignes.length - 1];
      expect(finale.result_success).toBe(false);
      expect(String(finale.result_error)).toMatch(/panne/i);
    } finally {
      await mode('succes');
    }
  });

  it('[L-003] un envoi SAUTÉ (client sans téléphone) : succès technique, motif dans result_data.saute', async () => {
    const m = marque('L-003');
    const id = await regle(m, [{ type: 'send_sms', config: { body: `Bonjour ${m}`, type_envoi: 'transactionnel' } }]);
    const client = await nouveauClient(m, false);
    await b.eventBus.emit('lead.created', { orgId: b.orgA, entityType: 'client', entityId: client, metadata: { source: 'manuel' } });
    const [l] = await journal(id);
    expect(l.result_success).toBe(true);
    expect((l.result_data as Record<string, unknown>).saute_code).toBe('sans_telephone');
  });

  it.fails('[L-004] ROUGE ATTENDU — décision requise : une règle écartée par ses CONDITIONS ne laisse aucune trace (on ne peut pas répondre « pourquoi ça n’est pas parti ? »)', async () => {
    const m = marque('L-004');
    const id = await regle(m, [{ type: 'create_notification', config: { title: m } }], { source: { eq: 'site_web' } });
    const client = await nouveauClient(m);
    await b.eventBus.emit('lead.created', { orgId: b.orgA, entityType: 'client', entityId: client, metadata: { source: 'manuel' } });
    const lignes = await journal(id, 1);
    expect(lignes.length).toBeGreaterThan(0);
  });
});

describe('L — get_automation_health reflète la réalité', () => {
  it('[L-005] les échecs de la panne y apparaissent, avec leur cause', async () => {
    const r = await outil('get_automation_health', b.orgA, b.users.proprioA);
    expect(r.echoues, JSON.stringify(r)).toBeGreaterThanOrEqual(1);
    const panne = (r.raisons_des_echecs as Array<{ cause: string; nombre: number }>).find((c) => /panne/i.test(c.cause));
    expect(panne, JSON.stringify(r)).toBeDefined();
  });

  it('[L-006] un envoi SAUTÉ n’est pas compté comme « parti » : il est dit, avec son motif', async () => {
    const r = await outil('get_automation_health', b.orgA, b.users.proprioA);
    const { data } = await b.admin.from('automation_execution_logs').select('result_success, result_data')
      .eq('org_id', b.orgA).order('created_at', { ascending: false }).limit(100);
    const sautes = (data ?? []).filter((l) => l.result_success && (l.result_data as Record<string, unknown> | null)?.saute).length;
    const reussis = (data ?? []).filter((l) => l.result_success).length - sautes;
    expect(sautes).toBeGreaterThanOrEqual(1);
    expect(r.partis, JSON.stringify(r)).toBe(reussis);
    expect(r.sautes, JSON.stringify(r)).toBe(sautes);
    expect(JSON.stringify(r.raisons_des_sauts ?? [])).toMatch(/téléphone/);
  });

  it('[L-007] isolation : le bureau B ne voit rien des échecs du bureau A', async () => {
    const { jeton } = await sessionDe(b.admin, COMPTES.proprioB.email);
    const { buildSupabaseWithAuth } = await import('../../../server/lib/supabase');
    const cB = buildSupabaseWithAuth(`Bearer ${jeton}`, b.orgB);
    const r = await outil('get_automation_health', b.orgB, b.users.proprioB, cB);
    expect(JSON.stringify(r)).not.toMatch(/panne/i);
    // Et l'identité de B ne lit pas le journal de A, même en le demandant.
    const { data } = await cB.from('automation_execution_logs').select('id').eq('org_id', b.orgA).limit(1);
    expect(data ?? []).toEqual([]);
  });
});
