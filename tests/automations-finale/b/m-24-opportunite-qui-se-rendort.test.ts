/**
 * B-24 — « Opportunité qui dort » ne prévient qu'une fois par étape, POUR
 * TOUJOURS : une opportunité relancée, sortie de l'étape puis revenue, qui se
 * rendort dans la même étape ne déclenche plus rien.
 *
 * La détection est une fonction SQL (`pipeline_detecter_stagnation`) : la
 * preuve se lit dans la file `pipeline_events`, là où l'alerte naît — sans
 * passer par le moteur, dont l'anti-doublon de 2 minutes masquerait une
 * seconde alerte posée dans la même minute de test.
 *
 * Le correctif est SQL, donc proposé :
 * notes/M-migrations-proposees/M-05_opportunite_qui_se_rendort.sql (appliqué
 * à la pile locale).
 *
 * Vraie base, pile locale, bureau A « (b) ».
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { marque } from '../../automations-suite/harnais/moteur';
import { preparerBureau, ok, creerClient, creerDeal, pipelineParDefaut, activeesDepuis, type Bureau } from '../../automations-suite/integration/10-b-outils';
import { regle, courriel } from './outils-b';

let b: Bureau;
let p: Awaited<ReturnType<typeof pipelineParDefaut>>;
const JOURS = 7;
const regles: string[] = [];
const ilYa = (jours: number) => new Date(Date.now() - jours * 86_400_000).toISOString();

interface Alerte { id: number; cle_unicite: string; created_at: string }
/** Les alertes de NOTRE règle pour ce deal (le bureau porte d'autres règles « qui dort », chacune a les siennes). */
const alertes = (dealId: string, regleId: string) => ok<Alerte[]>(b.admin.from('pipeline_events')
  .select('id, cle_unicite, created_at').eq('org_id', b.orgA).eq('deal_id', dealId).eq('type', 'deal.stage_idle')
  .eq('payload->>rule_id', regleId).order('id'), 'alertes');

/** Le tick : la détection des opportunités qui dorment. */
async function detecter() {
  const { detecterStagnation } = await import('../../../server/lib/pipelineEvenements');
  await detecterStagnation(b.admin);
}

/** Une opportunité dans l'étape A, et la règle « sans mouvement depuis 7 jours » de cette étape, publiée depuis 60 jours. */
async function miseEnPlace(m: string) {
  const etapeA = p.ouvertes[0].id;
  const c = await creerClient(b, m);
  const deal = await creerDeal(b, c.id, etapeA, p.id);
  const id = await regle(b, m, {
    trigger_event: 'deal.stage_idle', conditions: { idle_days: JOURS, stage_id: etapeA },
    actions: [courriel(m, 'On ne vous oublie pas')],
  });
  await activeesDepuis(b, [id], 60);
  regles.push(id);
  return { deal, regleId: id, etapeA, etapeB: p.ouvertes[1].id };
}

/** Le temps passe : la dernière activité de l'opportunité remonte à `jours` jours. */
const vieillir = (dealId: string, jours: number) => ok(b.admin.from('deals').update({ last_activity_at: ilYa(jours) }).eq('id', dealId), 'ancienneté');

beforeAll(async () => {
  b = await preparerBureau();
  p = await pipelineParDefaut(b);
  expect(p.ouvertes.length, 'il faut deux étapes ouvertes').toBeGreaterThanOrEqual(2);
}, 120_000);

afterAll(async () => {
  // Les règles du test ne restent pas publiées : la détection est globale, elles signaleraient
  // les opportunités dormantes des tests suivants du bureau. Leurs alertes sont closes.
  if (!regles.length) return;
  await b.admin.from('automation_rules').update({ is_active: false }).in('id', regles);
  for (const id of regles) {
    await b.admin.from('pipeline_events').update({ processed_at: new Date().toISOString() })
      .eq('org_id', b.orgA).eq('type', 'deal.stage_idle').is('processed_at', null).eq('payload->>rule_id', id);
  }
});

describe('B-24 — une opportunité qui se rendort dans la même étape', () => {
  it('[M24-01] elle est signalée de nouveau à sa 2e période de sommeil, et une seule fois par période', async () => {
    const { deal, regleId, etapeA, etapeB } = await miseEnPlace(marque('M24-rendort'));

    // 1re période : sans mouvement depuis 10 jours.
    await vieillir(deal.id, 10);
    await detecter();
    await detecter(); // le tick suivant ne re-signale pas
    expect(await alertes(deal.id, regleId), '1re période : une alerte').toHaveLength(1);

    // L'entreprise la relance : elle avance d'une étape, puis revient (le trigger note l'activité).
    await ok(b.admin.from('deals').update({ stage_id: etapeB }).eq('id', deal.id), 'avance');
    await ok(b.admin.from('deals').update({ stage_id: etapeA }).eq('id', deal.id), 'revient');
    await detecter();
    expect(await alertes(deal.id, regleId), 'elle vient de bouger : pas d’alerte').toHaveLength(1);

    // 2e période : elle se rendort, dans la MÊME étape.
    await vieillir(deal.id, 9);
    await detecter();
    const apres = await alertes(deal.id, regleId);
    expect(apres, '2e période de sommeil dans la même étape : jamais signalée').toHaveLength(2);
    expect(new Set(apres.map((a) => a.cle_unicite)).size).toBe(2);

    // Toujours une seule alerte par période.
    await detecter();
    expect(await alertes(deal.id, regleId)).toHaveLength(2);
  }, 300_000);

  it('[M24-02] une opportunité qui dort SANS bouger n’est signalée qu’une fois, tick après tick', async () => {
    const { deal, regleId } = await miseEnPlace(marque('M24-immobile'));
    await vieillir(deal.id, 30);
    for (let i = 0; i < 4; i++) await detecter();
    expect(await alertes(deal.id, regleId)).toHaveLength(1);
  }, 300_000);

  it('[M24-03] déploiement : une opportunité déjà signalée avec l’ANCIENNE clé, et qui dort toujours, n’est pas re-signalée', async () => {
    const { deal, regleId, etapeA } = await miseEnPlace(marque('M24-ancienne-cle'));
    await vieillir(deal.id, 20);
    // L'alerte telle que la fonction d'avant le correctif l'a écrite (clé sans la période).
    await ok(b.admin.from('pipeline_events').insert({
      org_id: b.orgA, deal_id: deal.id, type: 'deal.stage_idle', payload: { deal_id: deal.id, rule_id: regleId, idle_days: JOURS, stage_id: etapeA },
      cle_unicite: `idle:${deal.id}:${regleId}:${JOURS}:${etapeA}`, processed_at: new Date().toISOString(),
    }), 'alerte à l’ancienne clé');
    await detecter();
    await detecter();
    expect(await alertes(deal.id, regleId), 'aucune 2e alerte pour la période déjà signalée').toHaveLength(1);
  }, 300_000);
});
