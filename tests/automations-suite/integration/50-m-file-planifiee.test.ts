/**
 * M — débit de la file planifiée (correctifs de la mesure de charge).
 *
 * M-005 : la file se vide par LOTS tant qu'un lot revient plein. Avant : un
 *         seul lot de 50 par tick de 5 min = 600 tâches/heure pour toutes les
 *         entreprises de la plateforme (mesuré M-004).
 * M-006 : une entreprise en pause (« Tout arrêter ») avec 50 tâches dues ou
 *         plus bloquait TOUTES les autres : le lot relisait toujours ses 50
 *         tâches, sautées une à une, et rien d'autre n'avançait.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { demarrerMoteur, marque } from '../harnais/moteur';

let b: Awaited<ReturnType<typeof demarrerMoteur>>;
const nettoyer: Array<() => PromiseLike<unknown>> = [];

beforeAll(async () => { b = await demarrerMoteur(); });
afterAll(async () => { for (const f of nettoyer.reverse()) await f(); });

async function regleEtClient(org: string, proprio: string, m: string) {
  const { data: client, error: e1 } = await b.admin.from('clients')
    .insert({ org_id: org, created_by: proprio, first_name: 'File', last_name: m, status: 'active' })
    .select('id').single();
  if (e1) throw new Error(e1.message);
  const { data: regle, error: e2 } = await b.admin.from('automation_rules').insert({
    org_id: org, name: m, trigger_event: 'note.added', conditions: {}, delay_seconds: 0,
    is_active: true, is_preset: false, actions: [{ type: 'log_activity', config: { event_type: 'qa_file' } }],
  }).select('id').single();
  if (e2) throw new Error(e2.message);
  nettoyer.push(() => b.admin.from('automation_scheduled_tasks').delete().eq('automation_rule_id', regle!.id));
  nettoyer.push(() => b.admin.from('automation_rules').delete().eq('id', regle!.id));
  return { clientId: client!.id as string, regleId: regle!.id as string };
}

async function taches(org: string, regleId: string, clientId: string, n: number) {
  const passe = new Date(Date.now() - 60_000).toISOString();
  const lignes = Array.from({ length: n }, (_, i) => ({
    org_id: org, automation_rule_id: regleId, entity_type: 'client', entity_id: clientId,
    action_config: { type: 'log_activity', config: { event_type: 'qa_file' }, trigger_event: 'note.added' },
    execute_at: passe, status: 'pending', execution_key: `${regleId}:${clientId}:${i}:qa-file`,
  }));
  const { error } = await b.admin.from('automation_scheduled_tasks').insert(lignes);
  if (error) throw new Error(error.message);
}

const compter = async (regleId: string, statut: string) => {
  const { count } = await b.admin.from('automation_scheduled_tasks')
    .select('id', { count: 'exact', head: true }).eq('automation_rule_id', regleId).eq('status', statut);
  return count ?? 0;
};

describe('M — débit de la file planifiée', () => {
  it('[M-005] 120 tâches dues : un seul passage les traite toutes, par lots de 50', async () => {
    const m = marque('file-lots');
    const { clientId, regleId } = await regleEtClient(b.orgA, b.users.proprioA, m);
    await taches(b.orgA, regleId, clientId, 120);

    const { viderFile } = await import('../../../server/lib/scheduler');
    const lots = await viderFile(b.admin, { orgId: b.orgA });

    expect(await compter(regleId, 'pending')).toBe(0);
    expect(await compter(regleId, 'completed')).toBe(120);
    expect(lots).toBe(3);
  });

  it('[M-006] une entreprise en pause avec 55 tâches dues ne bloque plus les autres', async () => {
    const mA = marque('file-active');
    const mB = marque('file-pause');
    const a = await regleEtClient(b.orgA, b.users.proprioA, mA);
    const p = await regleEtClient(b.orgB, b.users.proprioB, mB);
    // B en pause, avec PLUS d'un lot de tâches dues, plus anciennes que celle de A.
    await b.admin.from('company_settings').update({ automations_paused: true }).eq('org_id', b.orgB);
    nettoyer.push(() => b.admin.from('company_settings').update({ automations_paused: false }).eq('org_id', b.orgB));
    await taches(b.orgB, p.regleId, p.clientId, 55);
    await new Promise((r) => setTimeout(r, 50));
    await taches(b.orgA, a.regleId, a.clientId, 1);

    const { processScheduledTasks } = await import('../../../server/lib/automationEngine');
    await processScheduledTasks(b.admin, { orgIds: [b.orgA, b.orgB] });

    expect(await compter(a.regleId, 'completed'), 'la tâche de l’entreprise active doit passer').toBe(1);
    // La file de l'entreprise en pause est CONSERVÉE, intacte.
    expect(await compter(p.regleId, 'pending')).toBe(55);
  });
});
