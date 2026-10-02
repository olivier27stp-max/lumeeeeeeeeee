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

/*
 * Ajouté par l'agent M (corrections). Décision de la mission pour B-06 et B-07 : par défaut, une automatisation
 * qu'on active ne réagit qu'à ce qui arrive APRÈS son activation. [B10-03] et [B10-04] ci-dessus prouvent que
 * les cas déjà là sont ignorés ; ces deux-ci prouvent que le déclencheur n'est pas devenu muet pour autant.
 * La date d'activation d'une règle est `automation_rules.activee_le` (migration proposée M-01, appliquée à la
 * pile locale) : le test la recule pour que le seuil soit franchi après elle.
 */
describe('point 10 — une règle déjà active réagit bien à ce qui arrive APRÈS son activation', () => {
  /** Attend `n` envois (les écouteurs du bus ne sont pas attendus par l'émetteur), puis laisse 3 s à un envoi de trop. */
  const envoisApres = async (m: string, n: number) => {
    for (let i = 0; i < 40 && (await envoisAvec(b, m)).length < n; i++) await pause(500);
    await pause(3_000);
    return envoisAvec(b, m);
  };
  const activeeDepuis = async (id: string, jours: number) =>
    ok(b.admin.from('automation_rules').update({ activee_le: new Date(Date.now() - jours * 86_400_000).toISOString() }).eq('id', id), 'activation ancienne');

  it('[B10-03b] « Opportunité qui dort » active depuis 30 jours : une opportunité qui franchit ses 7 jours reçoit le message ; le journal dit pourquoi les anciennes ont été ignorées', async () => {
    const { detecterStagnation, traiterEvenementsPipeline, DELAI_GRACE_MS } = await import('../../../server/lib/pipelineEvenements');
    const m = marque('B10-03b');
    const p = await pipelineParDefaut(b);
    const etape = p.ouvertes[2] ?? p.ouvertes[1];
    const c = await creerClient(b, m);
    const d = await creerDeal(b, c.id, etape.id, p.id);
    const vieux = await creerDeal(b, (await creerClient(b, `${m} vieux`)).id, etape.id, p.id);
    await pause(DELAI_GRACE_MS + 1_500);
    await traiterEvenementsPipeline(b.admin, { orgId: b.orgA });
    // Sans mouvement depuis 8 jours (seuil franchi hier) ; l'autre dort depuis 60 jours (avant l'activation).
    await ok(b.admin.from('deals').update({ last_activity_at: new Date(Date.now() - 8 * 86_400_000).toISOString() }).eq('id', d.id), 'endormie 8 j');
    await ok(b.admin.from('deals').update({ last_activity_at: new Date(Date.now() - 60 * 86_400_000).toISOString() }).eq('id', vieux.id), 'endormie 60 j');
    const id = await regle(b, m, { trigger_event: 'deal.stage_idle', conditions: { idle_days: 7, stage_id: etape.id }, actions: [courriel(m, 'On ne vous oublie pas')] });
    await activeeDepuis(id, 30);
    await detecterStagnation(b.admin);
    await pause(DELAI_GRACE_MS + 1_500);
    await traiterEvenementsPipeline(b.admin, { orgId: b.orgA });
    expect(await envoisApres(m, 1)).toHaveLength(1);
    const journal = await journauxDe(b, id);
    const ignorees = journal.filter((j) => j.result_data?.saute_code === 'anterieur_activation');
    expect(ignorees.map((j) => j.entity_id)).toEqual([vieux.id]);
    expect(String(ignorees[0].result_data?.saute)).toMatch(/déjà sans mouvement avant l’activation/);
  }, 300_000);

  it('[B10-04b] « Client inactif » active depuis 2 mois : le client qui a franchi ses 6 mois APRÈS reçoit le message ; ceux déjà inactifs avant, non', async () => {
    const { balayerEntreprise } = await import('../../../server/lib/client-inactif');
    await drapeau(b, 'auto_client_inactif', true);
    try {
      const m = marque('B10-04b');
      const recent = await creerClient(b, `${m} récent`);
      const ancien = await creerClient(b, `${m} ancien`);
      const jRecent = await creerJob(b, `${m} récent`, recent.id, { status: 'completed' });
      const jAncien = await creerJob(b, `${m} ancien`, ancien.id, { status: 'completed' });
      const il = (jours: number) => new Date(Date.now() - jours * 86_400_000).toISOString();
      // 200 jours : le seuil de 6 mois a été franchi il y a deux semaines environ. 400 jours : bien avant l'activation.
      await ok(b.admin.from('jobs').update({ completed_at: il(200), updated_at: il(200) }).eq('id', jRecent.id), 'job récent');
      await ok(b.admin.from('jobs').update({ completed_at: il(400), updated_at: il(400) }).eq('id', jAncien.id), 'job ancien');
      const id = await regle(b, m, { trigger_event: 'client.inactive', conditions: { mois: 6, max_par_heure: 1000 }, actions: [courriel(m, 'Ça fait longtemps')] });
      await activeeDepuis(id, 60);
      await balayerEntreprise(b.admin, b.orgA);
      const envois = await envoisApres(m, 1);
      const fiches = await ok<Array<{ id: string; email: string }>>(b.admin.from('clients').select('id, email').in('id', [recent.id, ancien.id]), 'fiches');
      const adresse = (id: string) => fiches.find((f) => f.id === id)!.email;
      // (D'autres clients du bureau, laissés par des passes précédentes, ont pu franchir leur seuil dans la même
      //  fenêtre : on juge NOS deux fiches.)
      const destinataires = envois.map((e) => e.destinataire);
      expect(destinataires).toContain(adresse(recent.id));
      expect(destinataires).not.toContain(adresse(ancien.id));
    } finally {
      await drapeau(b, 'auto_client_inactif', false);
    }
  }, 300_000);
});
