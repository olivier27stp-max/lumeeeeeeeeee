/**
 * Point 10 — ACTIVER une automatisation ne doit pas écrire d'un coup à tous
 * les cas qui existaient déjà (mission : « par défaut, seulement les
 * événements après l'activation »).
 *
 * On reproduit ce que fait le serveur : les balayages tournent déjà (tick de
 * 5 min, cron horaire), PUIS le propriétaire publie son automatisation, puis
 * le balayage suivant passe. On compte ce qui part.
 *
 * Vrai moteur, pile locale, bureau A « (b) » en bac à sable.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { marque } from '../../automations-suite/harnais/moteur';
import {
  preparerBureau, ok, creerClient, creerJob, creerDeal, pipelineParDefaut, drapeau, type Bureau,
} from '../../automations-suite/integration/10-b-outils';
import { regle, courriel, envoisAvec, factureEnRetard, journauxDe } from './outils-b';

let b: Bureau & { fuseau: string };
const mesures: Record<string, unknown> = {};

beforeAll(async () => { b = await preparerBureau(); });
afterAll(() => {
  mkdirSync('D:/lume-final/sorties/b', { recursive: true });
  writeFileSync('D:/lume-final/sorties/b/b-10-activation.json', JSON.stringify(mesures, null, 2));
});

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Attend que le nombre d'envois marqués ne bouge plus (les écouteurs ne sont pas attendus par l'émetteur). */
async function envoisStables(m: string): Promise<number> {
  let avant = -1;
  for (let i = 0; i < 40; i++) {
    const n = (await envoisAvec(b, m)).length;
    if (n === avant) return n;
    avant = n;
    await pause(1_500);
  }
  return avant;
}

describe('point 10 — « Facture en retard » activée alors que 20 factures sont déjà en retard', () => {
  // Jours de retard des 20 factures, AUJOURD'HUI. Jalons du détecteur : 1, 3, 5, 15, 30.
  const RETARDS = [1, 1, 2, 2, 3, 4, 4, 5, 7, 10, 14, 14, 15, 20, 29, 29, 30, 31, 45, 90];
  const m = marque('B10-retard');
  let ruleId = '';
  let jour0 = -1;
  let jour1 = -1;

  beforeAll(async () => {
    const { detectOverdueInvoices } = await import('../../../server/lib/scheduler');
    for (const [i, jours] of RETARDS.entries()) {
      const c = await creerClient(b, `${m} ${i}`);
      await factureEnRetard(b, `${m} ${i}`, c.id, jours, b.fuseau);
    }
    // 1. Le tick tourne AVANT que l'automatisation existe (comme en prod, toutes les 5 min).
    await detectOverdueInvoices(b.admin, { orgId: b.orgA });
    await pause(2_000);
    // 2. Le propriétaire publie « Facture en retard → courriel au client », sans condition.
    ruleId = await regle(b, m, { trigger_event: 'invoice.overdue', actions: [courriel(m, 'Votre facture est en retard')] });
    // 3. Le tick suivant.
    await detectOverdueInvoices(b.admin, { orgId: b.orgA });
    jour0 = await envoisStables(m);
    // 4. Le LENDEMAIN (seule l'horloge du processus avance ; minuteries réelles).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() + 86_400_000));
    try {
      await detectOverdueInvoices(b.admin, { orgId: b.orgA });
    } finally {
      vi.useRealTimers();
    }
    jour1 = (await envoisStables(m)) - jour0;
    const journaux = await journauxDe(b, ruleId);
    Object.assign(mesures, { facture_en_retard: { factures_deja_en_retard: RETARDS.length, envois_le_jour_de_l_activation: jour0, envois_le_lendemain: jour1, lignes_de_journal: journaux.length } });
  }, 600_000);

  it('[B10-01] le jour de l’activation : AUCUN client déjà en retard ne reçoit le message', () => {
    expect(jour0).toBe(0);
  });

  it('[B10-02] le lendemain : seules les factures qui FRANCHISSENT un jalon (J+3, J+5, J+15, J+30) le reçoivent — mesure', () => {
    // 2→3 (×2), 4→5 (×2), 14→15 (×2), 29→30 (×2) = 8 ; les autres (dont les 4 factures à plus de 30 jours) : rien.
    expect(jour1).toBe(8);
  });
});

describe('point 10 — « Opportunité sans mouvement » activée alors que 20 opportunités dorment déjà', () => {
  const m = marque('B10-idle');
  let partis = -1;

  beforeAll(async () => {
    const { detecterStagnation, traiterEvenementsPipeline, DELAI_GRACE_MS } = await import('../../../server/lib/pipelineEvenements');
    const p = await pipelineParDefaut(b);
    const ilYa30Jours = new Date(Date.now() - 30 * 86_400_000).toISOString();
    for (let i = 0; i < 20; i++) {
      const c = await creerClient(b, `${m} ${i}`);
      const d = await creerDeal(b, c.id, p.ouvertes[0].id, p.id);
      await ok(b.admin.from('deals').update({ last_activity_at: ilYa30Jours }).eq('id', d.id), 'ancienneté');
    }
    // Le tick tourne avant : aucune règle, donc aucune alerte.
    await detecterStagnation(b.admin);
    // Les événements d'entrée dans l'étape (créés par le trigger) sont consommés avant l'activation.
    await pause(DELAI_GRACE_MS + 1_500);
    await traiterEvenementsPipeline(b.admin, { orgId: b.orgA });
    await pause(2_000);
    // Le propriétaire publie « sans mouvement depuis 7 jours → courriel ».
    await regle(b, m, {
      trigger_event: 'deal.stage_idle', conditions: { idle_days: 7, stage_id: p.ouvertes[0].id },
      actions: [courriel(m, 'On ne vous oublie pas')],
    });
    // Le tick suivant.
    await detecterStagnation(b.admin);
    await pause(DELAI_GRACE_MS + 1_500);
    await traiterEvenementsPipeline(b.admin, { orgId: b.orgA });
    partis = await envoisStables(m);
    Object.assign(mesures, { sans_mouvement: { opportunites_deja_dormantes: 20, envois_au_tick_suivant_l_activation: partis } });
  }, 600_000);

  it('[B10-03] au tick qui suit l’activation : AUCUNE des 20 opportunités déjà dormantes ne reçoit le message', () => {
    expect(partis, `${partis} courriels partis d’un coup à l’activation`).toBe(0);
  });
});

describe('point 10 — « Client inactif » activé alors que 20 clients sont déjà inactifs depuis un an', () => {
  const m = marque('B10-inactif');
  let partis = -1;

  beforeAll(async () => {
    const { balayerEntreprise } = await import('../../../server/lib/client-inactif');
    await drapeau(b, 'auto_client_inactif', true);
    const ilYaUnAn = new Date(Date.now() - 365 * 86_400_000).toISOString();
    for (let i = 0; i < 20; i++) {
      const c = await creerClient(b, `${m} ${i}`);
      const j = await creerJob(b, `${m} ${i}`, c.id, { status: 'completed' });
      await ok(b.admin.from('jobs').update({ completed_at: ilYaUnAn, updated_at: ilYaUnAn }).eq('id', j.id), 'job ancien');
    }
    await balayerEntreprise(b.admin, b.orgA); // avant : aucune règle
    await regle(b, m, { trigger_event: 'client.inactive', conditions: { mois: 6 }, actions: [courriel(m, 'Ça fait longtemps')] });
    await balayerEntreprise(b.admin, b.orgA); // le passage horaire suivant
    partis = await envoisStables(m);
    Object.assign(mesures, { client_inactif: { clients_deja_inactifs: 20, envois_au_passage_suivant_l_activation: partis } });
    await drapeau(b, 'auto_client_inactif', false);
  }, 600_000);

  it('[B10-04] ROUGE ATTENDU — décision requise : au passage qui suit l’activation, aucun des 20 clients déjà inactifs n’est relancé sans confirmation', () => {
    expect(partis, `${partis} courriels partis au premier passage (plafond : 25 par heure)`).toBe(0);
  });
});

describe('point 10 — « Date atteinte » : seules les dates du jour visé partent (pas de rétroactif, pas de rattrapage)', () => {
  it('[B10-05] une date passée d’hier ne déclenche rien à l’activation ; [B2-rattrapage] un balayage manqué hier n’est PAS rattrapé aujourd’hui', async () => {
    const { balayerRappelsDates } = await import('../../../server/lib/rappels-dates');
    const m = marque('B10-date');
    const champ = await ok<{ id: string }>(b.admin.from('custom_fields').insert({
      org_id: b.orgA, object_type: 'client', field_type: 'date', label: `Fin de contrat ${m}`, key: `fin_${Date.now().toString(36)}`,
    }).select('id').single(), 'champ date');
    const hier = new Intl.DateTimeFormat('en-CA', { timeZone: b.fuseau }).format(new Date(Date.now() - 86_400_000));
    const aujourdhui = new Intl.DateTimeFormat('en-CA', { timeZone: b.fuseau }).format(new Date());
    const cHier = await creerClient(b, `${m} hier`);
    const cJour = await creerClient(b, `${m} jour`);
    await ok(b.admin.from('custom_field_values').insert([
      { org_id: b.orgA, field_id: champ.id, object_type: 'client', client_id: cHier.id, value_date: hier },
      { org_id: b.orgA, field_id: champ.id, object_type: 'client', client_id: cJour.id, value_date: aujourdhui },
    ]), 'valeurs');
    await regle(b, m, { trigger_event: 'date.reached', conditions: { champ_id: champ.id, jours_avant: 0 }, actions: [courriel(m, 'Votre contrat se termine')] });
    const resume = await balayerRappelsDates(b.admin, new Date(), { orgId: b.orgA });
    const n = await envoisStables(m);
    Object.assign(mesures, { date_atteinte: { resume, envois: n } });
    // Mesure : la date du jour part, celle d'hier jamais (ni rétroactif, ni rattrapage).
    expect(n).toBe(1);
  });
});
