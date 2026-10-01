/**
 * M — Charge : une rafale de 1 000 événements sur le bureau A, par le vrai
 * moteur, avec une règle SANS envoi (log_activity). On mesure :
 *  · la perte : 1 000 événements → 1 000 effets, exactement ;
 *  · la latence (émission → effet en base), p50 / p95 / max ;
 *  · les requêtes PostgREST par événement (un N+1 ferait grimper ce nombre
 *    avec le nombre de règles ou d'événements) ;
 *  · le débit de la file planifiée (processScheduledTasks) : tâches traitées
 *    par passage — le plafond « 600/h » signalé par l'inventaire.
 * Pas au-delà : staging est partagé.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { demarrerMoteur, marque, attendre, traiterFile } from '../harnais/moteur';
import { cibleProd } from '../harnais/bureau-test';

let b: Awaited<ReturnType<typeof demarrerMoteur>>;
const regles: string[] = [];
const types: string[] = [];

/** Compte les requêtes vers Supabase pendant `f`. */
async function compterRequetes<T>(f: () => Promise<T>): Promise<{ r: T; n: number }> {
  const hote = new URL(process.env.VITE_SUPABASE_URL ?? '').host;
  const avant = globalThis.fetch;
  let n = 0;
  globalThis.fetch = (async (e: RequestInfo | URL, i?: RequestInit) => {
    const u = typeof e === 'string' ? e : e instanceof URL ? e.href : e.url;
    if (u.includes(hote)) n++;
    return avant(e as RequestInfo, i);
  }) as typeof fetch;
  try { return { r: await f(), n }; } finally { globalThis.fetch = avant; }
}

/** Lance `taches` avec au plus `largeur` en vol. */
async function enParallele<T>(taches: Array<() => Promise<T>>, largeur: number): Promise<T[]> {
  const out: T[] = new Array(taches.length);
  let i = 0;
  await Promise.all(Array.from({ length: largeur }, async () => {
    while (i < taches.length) { const k = i++; out[k] = await taches[k](); }
  }));
  return out;
}

const pc = (xs: number[], p: number) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];

async function regle(nom: string, eventType: string, delay = 0): Promise<string> {
  const { data, error } = await b.admin.from('automation_rules').insert({
    org_id: b.orgA, name: nom, trigger_event: 'note.added', conditions: {}, delay_seconds: delay, is_active: true, is_preset: false,
    actions: [{ type: 'log_activity', config: { event_type: eventType } }],
  }).select('id').single();
  if (error) throw new Error(error.message);
  regles.push(data.id as string);
  types.push(eventType);
  return data.id as string;
}

async function compterEffets(eventType: string): Promise<number> {
  const { count } = await b.admin.from('activity_log').select('id', { count: 'exact', head: true }).eq('org_id', b.orgA).eq('event_type', eventType);
  return count ?? 0;
}

beforeAll(async () => { b = await demarrerMoteur(); });
afterAll(async () => {
  if (regles.length) {
    await b.admin.from('automation_rules').update({ is_active: false }).in('id', regles);
    await b.admin.from('automation_scheduled_tasks').delete().in('automation_rule_id', regles).eq('org_id', b.orgA);
    await b.admin.from('automation_rules').delete().in('id', regles);
  }
  for (const t of types) await b.admin.from('activity_log').delete().eq('org_id', b.orgA).eq('event_type', t);
});

describe('M — rafale de 1 000 événements', () => {
  it('[M-001][M-002][M-003] 1 000 événements → 1 000 effets, latence mesurée, requêtes par événement bornées', async () => {
    const m = marque('M');
    const type = `qa_charge_${m.slice(-13, -1)}`;
    const id = await regle(m, type);
    // En PROD : 200 événements. La rafale de 1 000 a rendu l'API de staging
    // indisponible par moments (521) ; on ne fait pas ça à de vrais clients.
    const N = cibleProd() ? 200 : 1000;
    const entites = Array.from({ length: N }, () => randomUUID());
    const emis = new Map<string, number>();
    const debut = Date.now();
    const { n: requetes } = await compterRequetes(async () => {
      await enParallele(entites.map((e) => async () => {
        emis.set(e, Date.now());
        await b.eventBus.emit('note.added', { orgId: b.orgA, entityType: 'client', entityId: e, metadata: {} });
        // 20 en vol (pas 50) : le 2026-09-30, une 2e passe à 50 en vol, pendant
        // que d'autres suites tournaient, a coïncidé avec une panne de l'API
        // staging (521/525 Cloudflare) — staging est partagé.
      }), 20);
      await attendre(() => compterEffets(type), (c) => c >= N, 300_000, 2000);
    });
    const duree = Date.now() - debut;
    const { data: lignes } = await b.admin.from('automation_execution_logs').select('entity_id, created_at, result_success')
      .eq('automation_rule_id', id).range(0, 1999);
    const effets = await compterEffets(type);
    const latences = (lignes ?? []).map((l) => new Date(l.created_at as string).getTime() - (emis.get(l.entity_id as string) ?? 0)).filter((x) => x > -5000);
    const parEvenement = requetes / N;
    console.info(`[M] ${N} événements en ${(duree / 1000).toFixed(1)} s · effets ${effets} · journal ${lignes?.length} (échecs ${(lignes ?? []).filter((l) => !l.result_success).length}) · latence p50 ${pc(latences, 0.5)} ms, p95 ${pc(latences, 0.95)} ms, max ${Math.max(...latences)} ms · ${requetes} requêtes PostgREST (${parEvenement.toFixed(1)}/événement)`);
    expect(effets, 'événements perdus ou dupliqués').toBe(N);
    expect(new Set((lignes ?? []).map((l) => l.entity_id)).size).toBe(N);
    expect((lignes ?? []).every((l) => l.result_success)).toBe(true);
    // Mesuré le 2026-09-30 : ≈ 19 requêtes par événement, CONSTANT (1 000 événements
    // comme 3) — pas de N+1 sur les événements. Détail d'un événement, une règle,
    // action log_activity : journal activity_log ×2, outbox (insert + 2 coches),
    // règles, pause, fuseau, réservation + mise à jour du journal d'exécution,
    // et ≈ 10 lectures de VARIABLES (client ×2, deal, champs personnalisés ×5,
    // réglages, langue) — résolues même pour une action qui n'en utilise aucune :
    // piste d'optimisation, pas un défaut de justesse. Ce coût est PAR RÈGLE
    // déclenchée. Au-delà de 25, une lecture par événement s'est ajoutée.
    expect(parEvenement).toBeLessThan(25);
  }, 600_000);

  it('[M-004] débit de la file planifiée : combien de tâches dues un passage traite (plafond « 600/h »)', async () => {
    const m = marque('M4');
    const type = `qa_file_${m.slice(-13, -1)}`;
    const id = await regle(m, type, 3600);
    const N = 120;
    // Entité « job » : une tâche différée dont le CLIENT n'existe pas est
    // annulée (correctif C-024) — ici on mesure le débit, pas ce garde.
    await enParallele(Array.from({ length: N }, () => async () => {
      await b.eventBus.emit('note.added', { orgId: b.orgA, entityType: 'job', entityId: randomUUID(), metadata: {} });
    }), 30);
    const taches = await attendre(
      async () => (await b.admin.from('automation_scheduled_tasks').select('id', { count: 'exact', head: true }).eq('automation_rule_id', id).eq('status', 'pending')).count ?? 0,
      (c) => c >= N, 120_000, 1000,
    );
    expect(taches).toBe(N);
    await b.admin.from('automation_scheduled_tasks').update({ execute_at: new Date(Date.now() - 1000).toISOString() }).eq('automation_rule_id', id).eq('status', 'pending');
    const t0 = Date.now();
    await traiterFile(b.admin, b.orgA);
    const dureePassage = Date.now() - t0;
    const faites = await compterEffets(type);
    console.info(`[M-004] un passage de la file : ${faites} tâches sur ${N} dues, en ${dureePassage} ms — au rythme d'un passage / 5 min : ${faites * 12}/h pour TOUTES les entreprises.`);
    // UN appel = UN lot de 50. Le plafond de 600/h venait d'un seul lot par
    // tick ; le tick enchaîne maintenant les lots (viderFile, voir M-005).
    expect(faites).toBe(50);
  }, 300_000);
});
