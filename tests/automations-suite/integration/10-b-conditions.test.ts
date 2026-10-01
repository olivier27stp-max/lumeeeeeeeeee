/**
 * [B] Conditions en intégration : chaque opérateur, chaque type de donnée,
 * les champs personnalisés créés comme dans Réglages → Champs personnalisés,
 * et les filtres d'étiquettes. Pour chaque cas, une règle dont la condition
 * est VRAIE (effet : sa tâche) et une dont elle est FAUSSE (aucun effet),
 * publiées par la vraie route de l'éditeur.
 *
 *  · Opérateurs et types des MÉTADONNÉES : un vrai appel entrant
 *    /api/hooks/:clé dont le JSON fournit texte, nombre, booléen, date ISO,
 *    liste et nombre en texte — un seul événement pour toutes les règles.
 *  · Champs personnalisés et étiquettes : lus EN BASE sur la fiche client,
 *    par « Note ajoutée » (POST /api/activity-notes).
 *
 * Matrice : tests/automations-suite/matrice/B.md (B-200 à B-299).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { marque, attendre } from '../harnais/moteur';
import {
  preparerBureau, apiEnMemoire, creerRegle, supprimerRegles, tachesTitrees, journaux,
  creerClient, creerChamp, ecrireChamps, ok, type Api, type Bureau,
} from './10-b-outils';

let b: Bureau & { fuseau: string };
let api: Api;
const regles: string[] = [];

beforeAll(async () => {
  b = await preparerBureau();
  const [hooks, notes, regles_, champs] = await Promise.all([
    import('../../../server/routes/webhooks-entrants'),
    import('../../../server/routes/activity-notes'),
    import('../../../server/routes/automation-rules'),
    import('../../../server/routes/custom-fields'),
  ]);
  api = await apiEnMemoire(b, [{ routeur: hooks.default, avant: true }, { routeur: notes.default }, { routeur: regles_.default }, { routeur: champs.default }]);
});
afterAll(async () => {
  await supprimerRegles(b.admin, regles);
  await api?.fermer();
});

interface Cas { id: string; libelle: string; vraie: Record<string, unknown>; fausse: Record<string, unknown> | null }

/** Crée la paire de règles de chaque cas (fausse d'abord), puis renvoie une fonction de vérification. */
async function preparerCas(m: string, declencheur: string, cas: Cas[]) {
  const ids: Record<string, { vrai: string; faux: string | null }> = {};
  for (const c of cas) {
    let faux: string | null = null;
    if (c.fausse) {
      faux = await creerRegle(api, { nom: `${m} ${c.id} faux`, declencheur, conditions: c.fausse, actions: [{ type: 'create_task', config: { title: `${m} ${c.id} faux` } }] });
      regles.push(faux);
    }
    const vrai = await creerRegle(api, { nom: `${m} ${c.id} vrai`, declencheur, conditions: c.vraie, actions: [{ type: 'create_task', config: { title: `${m} ${c.id} vrai` } }] });
    regles.push(vrai);
    ids[c.id] = { vrai, faux };
  }
  return ids;
}

async function attendreTout(m: string, cas: Cas[]) {
  // La dernière règle créée est la dernière jugée : sa tâche dit que tout est passé.
  const dernier = cas[cas.length - 1].id;
  await attendre(() => tachesTitrees(b.admin, b.orgA, `${m} ${dernier} vrai`), (t) => t.length > 0, 30_000);
}

async function verifierCas(m: string, c: Cas, ids: { vrai: string; faux: string | null }) {
  const vrai = await tachesTitrees(b.admin, b.orgA, `${m} ${c.id} vrai`);
  expect(vrai, `condition vraie sans effet : ${JSON.stringify(c.vraie)} — ${JSON.stringify(await journaux(b.admin, ids.vrai))}`).toHaveLength(1);
  if (ids.faux) {
    expect(await tachesTitrees(b.admin, b.orgA, `${m} ${c.id} faux`), `condition fausse avec effet : ${JSON.stringify(c.fausse)}`).toHaveLength(0);
    expect(await journaux(b.admin, ids.faux)).toHaveLength(0);
  }
}

// ── 1. Opérateurs et types, sur les métadonnées d'un vrai appel entrant ──

const CORPS_WEBHOOK = {
  ville: 'Laval', montant: 250, urgent: true, date_rdv: '2026-10-15', services: ['vitres', 'gouttieres'], note: '3',
};

const CAS_META: Cas[] = [
  { id: 'B-200', libelle: 'texte, égalité simple (casse comprise)', vraie: { ville: 'Laval' }, fausse: { ville: 'laval' } },
  { id: 'B-201', libelle: 'eq', vraie: { ville: { eq: 'Laval' } }, fausse: { ville: { eq: 'Montréal' } } },
  { id: 'B-202', libelle: 'neq', vraie: { ville: { neq: 'Montréal' } }, fausse: { ville: { neq: 'Laval' } } },
  { id: 'B-203', libelle: 'in', vraie: { ville: { in: ['Laval', 'Longueuil'] } }, fausse: { ville: { in: ['Québec'] } } },
  { id: 'B-204', libelle: 'not_in', vraie: { ville: { not_in: ['Québec'] } }, fausse: { ville: { not_in: ['Laval'] } } },
  { id: 'B-205', libelle: 'gt (nombre)', vraie: { montant: { gt: 200 } }, fausse: { montant: { gt: 250 } } },
  { id: 'B-206', libelle: 'gte (nombre)', vraie: { montant: { gte: 250 } }, fausse: { montant: { gte: 251 } } },
  { id: 'B-207', libelle: 'lt (nombre)', vraie: { montant: { lt: 300 } }, fausse: { montant: { lt: 250 } } },
  { id: 'B-208', libelle: 'lte (nombre)', vraie: { montant: { lte: 250 } }, fausse: { montant: { lte: 249 } } },
  { id: 'B-209', libelle: 'suffixe __gte (réglage « montant au moins »)', vraie: { montant__gte: 250 }, fausse: { montant__gte: 1000 } },
  { id: 'B-210', libelle: 'deux opérateurs (entre)', vraie: { montant: { gte: 200, lte: 300 } }, fausse: { montant: { gte: 260, lte: 300 } } },
  { id: 'B-211', libelle: 'booléen', vraie: { urgent: true }, fausse: { urgent: false } },
  { id: 'B-212', libelle: 'date ISO (gt)', vraie: { date_rdv: { gt: '2026-10-01' } }, fausse: { date_rdv: { gt: '2026-11-01' } } },
  { id: 'B-213', libelle: 'liste (la métadonnée contient)', vraie: { services: 'vitres' }, fausse: { services: 'toiture' } },
  { id: 'B-214', libelle: 'nombre en texte = nombre', vraie: { note: 3 }, fausse: { note: 4 } },
  { id: 'B-215', libelle: 'plusieurs clés = ET', vraie: { ville: 'Laval', urgent: true }, fausse: { ville: 'Laval', urgent: false } },
  { id: 'B-216', libelle: 'clé absente : comparaison impossible = fausse', vraie: { ville: 'Laval' }, fausse: { inexistant: { gt: 0 } } },
];

describe('[B] opérateurs et types de données (métadonnées de l’événement)', () => {
  const m = marque('B-2xx');
  let ids: Awaited<ReturnType<typeof preparerCas>>;
  beforeAll(async () => {
    ids = await preparerCas(m, 'webhook.received', CAS_META);
    const cree = await api.appeler('POST', '/api/automations/webhooks', { name: `Conditions ${m}` });
    expect(cree.status).toBe(201);
    const r = await api.publique('POST', `/api/hooks/${cree.json.api_key}`, JSON.stringify(CORPS_WEBHOOK), { 'Content-Type': 'application/json' });
    expect(r.status, JSON.stringify(r.json)).toBeLessThan(300);
    await attendreTout(m, CAS_META);
  }, 180_000);
  afterAll(async () => { await supprimerRegles(b.admin, regles.splice(0)); });

  for (const c of CAS_META) {
    it(`[${c.id}] ${c.libelle}`, async () => { await verifierCas(m, c, ids[c.id]); });
  }
});

// ── 2. Champs personnalisés (valeurs lues en base) et étiquettes ──

describe('[B] champs personnalisés créés par les réglages, et étiquettes', () => {
  const m = marque('B-2cf');
  let ids: Awaited<ReturnType<typeof preparerCas>>;
  const cas: Cas[] = [];

  beforeAll(async () => {
    const s = Date.now().toString(36);
    const champ = (label: string, field_type: string, extra: Record<string, unknown> = {}) =>
      creerChamp(api, { label: `${label} ${s}`, field_type, object_type: 'client', ...extra });
    const [caseC, texte, courriel, tel, nombre, argent, choix, multi, date, fichier] = await Promise.all([
      champ('Cq', 'checkbox'), champ('Tx', 'single_line'), champ('Em', 'email'), champ('Tel', 'phone'), champ('Nb', 'number'),
      champ('Mt', 'monetary'), champ('Ch', 'dropdown_single', { options: [{ label: 'Bronze' }, { label: 'Or' }] }),
      champ('Mu', 'dropdown_multi', { options: [{ label: 'Vitres' }, { label: 'Toit' }, { label: 'Patio' }] }),
      champ('Dt', 'date'), champ('Fi', 'file'),
    ]);
    const opt = (c: { options?: Array<{ id: string; label: string }> }, l: string) => c.options!.find((o) => o.label === l)!.id;
    const client = await creerClient(b, m);
    const tag = `VIP-${s}`;
    await ok(b.admin.from('client_tags').insert({ client_id: client.id, tag }), 'étiquette');
    const aujourdhui = new Intl.DateTimeFormat('en-CA', { timeZone: b.fuseau, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    await ecrireChamps(api, 'client', client.id, [
      { field_id: caseC.id, value: true },
      { field_id: texte.id, value: '  Grand   Terrain ' },
      { field_id: courriel.id, value: 'Proprio@Lume-QA.test' },
      { field_id: tel.id, value: '(555) 555-0171' },
      { field_id: nombre.id, value: 12 },
      { field_id: argent.id, value: 50_000 },
      { field_id: choix.id, value: opt(choix, 'Or') },
      { field_id: multi.id, value: [opt(multi, 'Vitres'), opt(multi, 'Patio')] },
      { field_id: date.id, value: aujourdhui },
    ]);
    const cp = (c: Record<string, unknown>) => ({ champs_perso: [c] });
    cas.push(
      { id: 'B-220', libelle: 'case à cocher : is oui / is non', vraie: cp({ field_id: caseC.id, op: 'is', value: true }), fausse: cp({ field_id: caseC.id, op: 'is', value: false }) },
      { id: 'B-221', libelle: 'texte : is (normalisé : casse, espaces)', vraie: cp({ field_id: texte.id, op: 'is', value: 'grand terrain' }), fausse: cp({ field_id: texte.id, op: 'is', value: 'petit terrain' }) },
      { id: 'B-222', libelle: 'texte : contains / not_contains', vraie: cp({ field_id: texte.id, op: 'contains', value: 'terrain' }), fausse: cp({ field_id: texte.id, op: 'not_contains', value: 'terrain' }) },
      { id: 'B-223', libelle: 'texte : is_not', vraie: cp({ field_id: texte.id, op: 'is_not', value: 'autre' }), fausse: cp({ field_id: texte.id, op: 'is_not', value: 'Grand Terrain' }) },
      { id: 'B-224', libelle: 'courriel : is (insensible à la casse)', vraie: cp({ field_id: courriel.id, op: 'is', value: 'proprio@lume-qa.test' }), fausse: cp({ field_id: courriel.id, op: 'is', value: 'autre@lume-qa.test' }) },
      { id: 'B-225', libelle: 'téléphone : is (normalisé E.164)', vraie: cp({ field_id: tel.id, op: 'is', value: '+1 555-555-0171' }), fausse: cp({ field_id: tel.id, op: 'is', value: '+1 555-555-0172' }) },
      { id: 'B-226', libelle: 'nombre : gt / lt', vraie: cp({ field_id: nombre.id, op: 'gt', value: 10 }), fausse: cp({ field_id: nombre.id, op: 'lt', value: 10 }) },
      { id: 'B-227', libelle: 'nombre : eq / neq', vraie: cp({ field_id: nombre.id, op: 'eq', value: 12 }), fausse: cp({ field_id: nombre.id, op: 'neq', value: 12 }) },
      { id: 'B-228', libelle: 'montant (cents) : between', vraie: cp({ field_id: argent.id, op: 'between', value: 40_000, value2: 60_000 }), fausse: cp({ field_id: argent.id, op: 'between', value: 60_001, value2: 90_000 }) },
      { id: 'B-229', libelle: 'liste simple : any_of / none_of', vraie: cp({ field_id: choix.id, op: 'any_of', value: [opt(choix, 'Or')] }), fausse: cp({ field_id: choix.id, op: 'none_of', value: [opt(choix, 'Or')] }) },
      { id: 'B-230', libelle: 'liste multiple : any_of / none_of', vraie: cp({ field_id: multi.id, op: 'any_of', value: [opt(multi, 'Toit'), opt(multi, 'Patio')] }), fausse: cp({ field_id: multi.id, op: 'any_of', value: [opt(multi, 'Toit')] }) },
      { id: 'B-231', libelle: 'date : today / yesterday', vraie: cp({ field_id: date.id, op: 'today' }), fausse: cp({ field_id: date.id, op: 'yesterday' }) },
      { id: 'B-232', libelle: 'date : after / before', vraie: cp({ field_id: date.id, op: 'after', value: '2020-01-01' }), fausse: cp({ field_id: date.id, op: 'before', value: '2020-01-01' }) },
      { id: 'B-233', libelle: 'date : in_last 7 j / more_than_ago 7 j', vraie: cp({ field_id: date.id, op: 'in_last', n: 7, unit: 'days' }), fausse: cp({ field_id: date.id, op: 'more_than_ago', n: 7, unit: 'days' }) },
      { id: 'B-234', libelle: 'fichier (vide) : is_empty / is_not_empty', vraie: cp({ field_id: fichier.id, op: 'is_empty' }), fausse: cp({ field_id: fichier.id, op: 'is_not_empty' }) },
      { id: 'B-235', libelle: 'deux conditions de champs = ET', vraie: { champs_perso: [{ field_id: caseC.id, op: 'is', value: true }, { field_id: nombre.id, op: 'gt', value: 10 }] }, fausse: { champs_perso: [{ field_id: caseC.id, op: 'is', value: true }, { field_id: nombre.id, op: 'gt', value: 12 }] } },
      { id: 'B-236', libelle: 'étiquette : client_a_etiquette / client_sans_etiquette', vraie: { client_a_etiquette: tag.toLowerCase() }, fausse: { client_sans_etiquette: tag } },
      { id: 'B-237', libelle: 'métadonnée + champ perso + étiquette combinés (ET)', vraie: { note_sur: 'client', client_a_etiquette: tag, champs_perso: [{ field_id: caseC.id, op: 'is', value: true }] }, fausse: { note_sur: 'client', client_a_etiquette: tag, champs_perso: [{ field_id: caseC.id, op: 'is', value: false }] } },
    );
    ids = await preparerCas(m, 'note.added', cas);
    const r = await api.appeler('POST', '/api/activity-notes', { entityType: 'client', entityId: client.id, body: `Note ${m}` });
    expect(r.status).toBe(200);
    await attendreTout(m, cas);
  }, 240_000);
  afterAll(async () => { await supprimerRegles(b.admin, regles.splice(0)); });

  const IDS = ['B-220', 'B-221', 'B-222', 'B-223', 'B-224', 'B-225', 'B-226', 'B-227', 'B-228', 'B-229', 'B-230', 'B-231', 'B-232', 'B-233', 'B-234', 'B-235', 'B-236', 'B-237'];
  for (const id of IDS) {
    it(`[${id}] champ personnalisé / étiquette`, async () => {
      const c = cas.find((x) => x.id === id)!;
      await verifierCas(m, c, ids[id]);
    });
  }
});
