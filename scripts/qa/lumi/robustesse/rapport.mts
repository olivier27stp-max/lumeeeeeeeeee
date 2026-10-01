/**
 * Robustesse des conversations de Lumi — le plan et le rapport (purs : ni base, ni réseau).
 * Le rapport est écrit pour le propriétaire du produit : pour chaque test, ce qu'il a fait, ce qu'il a observé, son
 * verdict et la preuve ; en tête, ce que chaque ligne de la phase 4 de la mission a donné.
 */
import type { Compte, CompteProprietaire, Famille, Resultat, TestRobustesse, Verdict } from './types.mts';
import { COMPTES, LIGNES_PHASE4 } from './types.mts';

export const VERDICTS: readonly Verdict[] = ['PASS', 'FAIL', 'NON COUVERT', 'A RELIRE'];
/** La prod accepte 60 envois à Lumi par heure et par personne — refus compris. */
export const LIMITE_HORAIRE = 60;
/** Coût moyen d'un tour d'agent, mesuré le 2026-10-01 (cache du prompt chaud). */
export const CENTS_PAR_TOUR = 1.6;
/** Plafond de coût de la batterie complète, en cents (vérifié par un test). */
export const BUDGET_CENTS = 200;

export interface Selection { familles?: string[]; tests?: string[]; proprietaire?: CompteProprietaire | null }
export type Choix = Array<{ famille: Famille; tests: TestRobustesse[] }>;

/** Les tests retenus par `--famille` et `--test`. */
export function selectionner(familles: Famille[], s: Selection): Choix {
  return familles
    .filter((f) => !s.familles?.length || s.familles.includes(f.nom))
    .map((f) => ({ famille: f, tests: f.tests.filter((t) => !s.tests?.length || s.tests.includes(t.id)) }))
    .filter((x) => x.tests.length > 0);
}

/** Le compte propriétaire qui joue la famille : le sien, ou celui de `--proprietaire`. */
export const compteDe = (f: Famille, s: Selection): CompteProprietaire => s.proprietaire ?? f.compte;

const zero = (): Record<Compte, number> => Object.fromEntries(COMPTES.map((c) => [c, 0])) as Record<Compte, number>;

/** Envois à /api/lumi/chat prévus, par compte. `limite` : seulement ceux des tests qui visent la limite horaire (hors budget), ou tous les autres. */
export function appelsPrevus(choix: Choix, s: Selection, quoi: 'budget' | 'limite' = 'budget'): Record<Compte, number> {
  const n = zero();
  for (const { famille, tests } of choix) {
    for (const t of tests) {
      if ((quoi === 'limite') !== (t.vise_la_limite === true)) continue;
      n[compteDe(famille, s)] += t.appels.proprietaire ?? 0;
      n.technicien += t.appels.technicien ?? 0;
    }
  }
  return n;
}

/** Coût d'inférence estimé d'un test, en cents. */
export const coutEstime = (t: TestRobustesse): number => t.cout_estime_cents ?? CENTS_PAR_TOUR * Math.max(0, (t.appels.proprietaire ?? 0) - (t.appels_sans_modele ?? 0));
export const coutDuChoix = (choix: Choix): number => choix.flatMap((c) => c.tests).reduce((s, t) => s + coutEstime(t), 0);

/** Pour chaque ligne de la phase 4 : les tests qui la couvrent, et ceux qui sont non couverts par construction. */
export function couverture(familles: Famille[]): Array<{ ligne: number; texte: string; tests: string[]; non_couverts: string[] }> {
  const tous = familles.flatMap((f) => f.tests);
  return LIGNES_PHASE4.map((texte, i) => ({
    ligne: i + 1, texte,
    tests: tous.filter((t) => t.lignes.includes(i + 1) && !t.non_couvert).map((t) => t.id),
    non_couverts: tous.filter((t) => t.lignes.includes(i + 1) && t.non_couvert).map((t) => t.id),
  }));
}

const cents = (c: number): string => `${(c / 100).toFixed(2).replace('.', ',')} $`;

/** Ce que `--plan` affiche : chaque test, ce qu'il ferait, ce qu'il écrirait, les appels par compte et le coût estimé — sans rien appeler. */
export function textePlan(choix: Choix, o: { maxParCompte: number; selection: Selection; comptes: Record<Compte, string>; familles: Famille[] }): string {
  const l: string[] = ['PLAN — rien n’est appelé, rien n’est écrit, aucune variable n’est lue.', ''];
  const tous = choix.flatMap((c) => c.tests);
  for (const { famille, tests } of choix) {
    const compte = compteDe(famille, o.selection);
    const n = tests.filter((t) => !t.vise_la_limite).reduce((s, t) => s + (t.appels.proprietaire ?? 0), 0);
    l.push(`${famille.titre} — ${tests.length} test(s) ; compte ${compte} (${o.comptes[compte]}) : ${n} envoi(s) à Lumi ; coût estimé ${cents(tests.reduce((s, t) => s + coutEstime(t), 0))}${famille.besoin_jeu_eval ? ' ; a besoin du jeu [EVAL]' : ''}${famille.besoin_palier_normal ? ' ; a besoin du palier normal' : ''}`);
    l.push(`  Prouve : ${famille.prouve}`);
    for (const t of tests) {
      const p = t.appels.proprietaire ?? 0;
      const k = t.appels.technicien ?? 0;
      const appels = [p ? `${compte} ${p}` : '', k ? `technicien ${k}` : ''].filter(Boolean).join(', ');
      l.push(`  - ${t.id}${t.non_couvert ? '  [NON COUVERT par construction]' : ''}  (${appels ? `envois à Lumi : ${appels}${t.vise_la_limite ? ' — vise EXPRÈS la limite horaire, hors budget' : ''}` : 'aucun envoi à Lumi'} ; ≈ ${coutEstime(t).toFixed(1).replace('.', ',')} ¢ ; phase 4, ligne(s) ${t.lignes.join(', ')})`);
      l.push(`      fait      : ${t.fait}`);
      l.push(`      si défaut : ${t.si_defaut}`);
      for (const e of t.ecrit ?? []) l.push(`      écrit     : ${e}`);
      if (t.attente_discutable) l.push(`      attente discutable : ${t.attente_discutable}`);
      if (t.non_couvert) l.push(`      non couvert : ${t.non_couvert.raison}${t.non_couvert.couvert_par.length ? ` — couvert par : ${t.non_couvert.couvert_par.join(', ')}` : ''}`);
    }
    l.push('');
  }
  const budget = appelsPrevus(choix, o.selection, 'budget');
  const limite = appelsPrevus(choix, o.selection, 'limite');
  l.push(`TOTAL : ${tous.length} test(s), dont ${tous.filter((t) => t.non_couvert).length} non couvert(s) par construction.`, '');
  l.push(`Envois à POST /api/lumi/chat par compte (le serveur en accepte ${LIMITE_HORAIRE} par heure et par personne, refus compris ; budget de la passe : ${o.maxParCompte} par compte) :`);
  for (const c of COMPTES) {
    if (!budget[c] && !limite[c]) continue;
    l.push(`  ${c.padEnd(10)} ${o.comptes[c].padEnd(30)} ${String(budget[c]).padStart(3)} envoi(s)${limite[c] ? ` + ${limite[c]} au plus pour atteindre EXPRÈS la limite horaire (messages vides, 0 ¢)` : ''}${budget[c] > o.maxParCompte ? '  ← DÉPASSE le budget : découper avec --famille' : ''}`);
  }
  const total = coutDuChoix(choix);
  l.push('', `Coût d’inférence estimé : ${cents(total)} (≈ ${CENTS_PAR_TOUR.toFixed(1).replace('.', ',')} ¢ par tour d’agent, cache chaud ; à froid, compter jusqu’à 1,5 fois plus). Plafond visé pour la batterie complète : ${cents(BUDGET_CENTS)}.`);
  if (total > BUDGET_CENTS) l.push('ATTENTION : l’estimation dépasse le plafond visé.');
  l.push('', 'Phase 4 de la mission — ce qui couvre chaque ligne :');
  for (const c of couverture(o.familles)) l.push(`  ${c.ligne}. ${c.texte}`, `       tests : ${c.tests.join(', ') || 'AUCUN'}${c.non_couverts.length ? ` ; non couverts par construction : ${c.non_couverts.join(', ')}` : ''}`);
  l.push('', 'Écritures de service de la batterie : memberships.lumi_mode des comptes propriétaires (« demander » le temps de la passe, remis à la fin) ; les tâches [ROB] listées ci-dessus (mises à la corbeille à la fin, suppression douce).');
  l.push('Aucune carte d’envoi, de paiement ou de suppression n’est confirmée : la batterie ne confirme que des tâches [ROB].');
  return l.join('\n');
}

export interface Bilan { total: number; par_verdict: Record<Verdict, number>; par_famille: Record<string, Record<Verdict, number>> }

export function bilanDe(resultats: Resultat[]): Bilan {
  const vide = (): Record<Verdict, number> => ({ PASS: 0, FAIL: 0, 'NON COUVERT': 0, 'A RELIRE': 0 });
  const b: Bilan = { total: resultats.length, par_verdict: vide(), par_famille: {} };
  for (const r of resultats) {
    b.par_verdict[r.verdict] += 1;
    b.par_famille[r.famille] ??= vide();
    b.par_famille[r.famille][r.verdict] += 1;
  }
  return b;
}

/** Un lancement du lanceur (la batterie se joue famille par famille : un rapport peut en réunir plusieurs). */
export interface Lancement { date: string; familles: string[]; comptes: Partial<Record<Compte, string>>; appels: Record<Compte, number>; paliers: Record<string, string | null> }
export interface Passe {
  date: string; api: string; org: string; nom_org: string; jeu_present: boolean;
  /** Envois à Lumi, tous lancements réunis. */
  appels: Record<Compte, number>; menage: { fait: string[]; erreurs: string[] }; mode: string[];
  conversations: string[]; selection: Selection; lancements: Lancement[];
  /** Qui a répondu, sur toutes les conversations de la batterie : modèle, étage, tours, coût. */
  modeles?: Array<{ modele: string; etage: number | null; tours: number; cout_cents: number }>;
  /** Palier de crédits du bureau à la fin du dernier lancement. */
  palier?: string | null;
  /** Redémarrages du serveur vus pendant la passe (un redéploiement remet à zéro les verrous et la limite horaire en mémoire). */
  redemarrages?: string[];
  /** Constats faits pendant la passe, hors de tout test (ajoutés avec --regenerer --note). */
  notes?: string[];
}

/** Réunit les résultats d'un lancement précédent et ceux du lancement en cours : un test rejoué remplace son ancien résultat ; l'ordre est celui des familles. */
export function fusionner(familles: Famille[], anciens: Resultat[], nouveaux: Resultat[]): Resultat[] {
  const rejoues = new Set(nouveaux.map((r) => r.id));
  const tous = [...anciens.filter((r) => !rejoues.has(r.id)), ...nouveaux];
  const ordre = familles.flatMap((f) => f.tests.map((t) => t.id));
  return tous.sort((a, b) => ordre.indexOf(a.id) - ordre.indexOf(b.id));
}

const bloc = (texte: string): string => `\`\`\`\n${String(texte).replace(/```/g, "'''")}\n\`\`\``;

/** Ce qu'une ligne de la phase 4 a donné, d'après les résultats de ses tests. */
function etatDeLaLigne(tests: Resultat[]): string {
  if (!tests.length) return 'non joué';
  const n = (v: Verdict): number => tests.filter((r) => r.verdict === v).length;
  return [n('FAIL') ? `${n('FAIL')} FAIL` : '', n('PASS') ? `${n('PASS')} PASS` : '', n('A RELIRE') ? `${n('A RELIRE')} à relire` : '', n('NON COUVERT') ? `${n('NON COUVERT')} non couvert` : ''].filter(Boolean).join(', ');
}

/** Le rapport lisible : le bilan, la phase 4 ligne par ligne, ce qui échoue, ce qui reste à relire, ce qui n'est pas couvert, puis chaque test avec sa preuve. */
export function rapportMarkdown(p: Passe, familles: Famille[], resultats: Resultat[]): string {
  const b = bilanDe(resultats);
  const titreDe = (nom: string): string => familles.find((f) => f.nom === nom)?.titre ?? nom;
  const l: string[] = [];
  l.push('# Robustesse des conversations de Lumi', '');
  l.push(`Passe du ${p.date}, contre ${p.api}, bureau de test « ${p.nom_org} » \`${p.org}\`.`);
  l.push(`Jeu [EVAL] ${p.jeu_present ? 'présent' : 'ABSENT (les tests qui en dépendent sont NON COUVERT)'}. Envois à Lumi, tous lancements réunis : ${COMPTES.filter((c) => p.appels[c]).map((c) => `${c} ${p.appels[c]}`).join(', ') || 'aucun'}.`, '');
  if (p.lancements.length) {
    l.push('Lancements (la batterie se joue famille par famille : 60 envois par heure et par personne) :', '');
    for (const x of p.lancements) {
      l.push(`- ${x.date} — ${x.familles.join(', ')} — ${COMPTES.filter((c) => x.appels[c]).map((c) => `${c} (${x.comptes[c] ?? '?'}) : ${x.appels[c]} envoi(s)`).join(' ; ') || 'aucun envoi'}${Object.keys(x.paliers).length ? ` — palier : ${Object.entries(x.paliers).map(([f, v]) => `${f} « ${v ?? 'inconnu'} »`).join(', ')}` : ''}`);
    }
    l.push('');
  }
  if (p.modeles?.length) {
    const agent = p.modeles.filter((m) => m.etage === 6);
    const sansModele = p.modeles.filter((m) => m.etage !== null && m.etage < 5).reduce((n, m) => n + m.tours, 0);
    const cout = p.modeles.reduce((n, m) => n + m.cout_cents, 0);
    l.push(`**Qui a répondu.** Tours d’agent : ${agent.map((m) => `${m.tours} par ${m.modele}`).join(', ') || 'aucun'} ; ${sansModele} tour(s) servis sans modèle (étages 0 à 4). Coût d’inférence relu dans les traces : ${cents(cout)}. Palier de crédits du bureau en fin de passe : « ${p.palier ?? 'inconnu'} ».`);
    if (agent.length && agent.some((m) => /haiku/i.test(m.modele))) l.push('**Limite de cette passe.** Une partie des tours d’agent a été servie par le modèle de repli (palier dégradé : fenêtre d’historique de 6 messages, deux étapes au plus). Les tests qui éprouvent le SERVEUR (coupures, deux appareils, entrées, limite horaire, historique enregistré) valent tels quels ; ceux qui éprouvent le MODÈLE (références, revirements, dictée, conversation longue) sont à rejouer en palier normal.');
    l.push('');
  }
  if (p.redemarrages?.length) l.push(`**Redémarrages du serveur pendant la passe** (un redéploiement remet à zéro le verrou de conversation et la limite horaire, tenus en mémoire) : ${p.redemarrages.join(' ; ')}.`, '');
  l.push('Tout est jugé par du code (présence ou absence d’un fait, d’un événement, d’une ligne) ; aucun modèle ne juge. « A RELIRE » = le code n’a trouvé aucun défaut mais le critère demande un humain.', '');

  l.push('## Bilan', '', '| Famille | PASS | FAIL | NON COUVERT | A RELIRE |', '|---|---:|---:|---:|---:|');
  for (const [nom, v] of Object.entries(b.par_famille)) l.push(`| ${titreDe(nom)} | ${v.PASS} | ${v.FAIL} | ${v['NON COUVERT']} | ${v['A RELIRE']} |`);
  l.push(`| **Total (${b.total})** | **${b.par_verdict.PASS}** | **${b.par_verdict.FAIL}** | **${b.par_verdict['NON COUVERT']}** | **${b.par_verdict['A RELIRE']}** |`, '');

  l.push('## La phase 4, ligne par ligne', '');
  for (const c of couverture(familles)) {
    const joues = resultats.filter((r) => r.lignes.includes(c.ligne));
    l.push(`${c.ligne}. ${c.texte}`, `   - **${etatDeLaLigne(joues)}** — ${joues.map((r) => `${r.id} (${r.verdict})`).join(', ') || `prévus : ${[...c.tests, ...c.non_couverts].join(', ')}`}`);
  }
  l.push('');

  const section = (titre: string, verdict: Verdict, vide: string): void => {
    const rs = resultats.filter((r) => r.verdict === verdict);
    l.push(`## ${titre} (${rs.length})`, '');
    if (!rs.length) { l.push(vide, ''); return; }
    for (const r of rs) {
      l.push(`- **${r.id}** — ${r.titre}`);
      for (const c of r.constats.slice(0, 4)) l.push(`  - ${c}`);
      if (r.a_relire && verdict === 'A RELIRE') l.push(`  - À trancher : ${r.a_relire}`);
      if (r.couvert_par?.length) l.push(`  - Couvert sans réseau par : ${r.couvert_par.join(', ')}`);
      if (r.attente_discutable) l.push(`  - Attente discutable : ${r.attente_discutable}`);
    }
    l.push('');
  };
  section('Ce qui échoue', 'FAIL', 'Aucun test en échec.');
  section('À relire par un humain', 'A RELIRE', 'Rien à relire.');
  section('Non couvert', 'NON COUVERT', 'Tout est couvert.');

  if (p.notes?.length) {
    l.push('## Constats de la passe (hors de tout test)', '');
    for (const n of p.notes) l.push(`- ${n}`);
    l.push('');
  }
  const obs = resultats.filter((r) => r.observations?.length);
  if (obs.length) {
    l.push('## Constats annexes (hors du critère des tests)', '');
    for (const r of obs) for (const o of r.observations ?? []) l.push(`- **${r.id}** — ${o}`);
    l.push('');
  }

  l.push('## Détail de chaque test', '');
  for (const f of familles) {
    const rs = resultats.filter((r) => r.famille === f.nom);
    if (!rs.length) continue;
    l.push(`### ${f.titre}`, '', `_${f.prouve}_`, '');
    for (const r of rs) {
      l.push(`#### ${r.verdict} — ${r.id}`, '', `**${r.titre}**`, '');
      l.push(`- Ce que le test a fait : ${r.fait}`);
      l.push(`- Ce qu’il observerait si le défaut existait : ${r.si_defaut}`);
      l.push('- Ce qu’il a observé :');
      for (const c of r.constats) l.push(`  - ${c}`);
      if (r.a_relire) l.push(`- À relire : ${r.a_relire}`);
      if (r.attente_discutable) l.push(`- Attente discutable : ${r.attente_discutable}`);
      if (r.couvert_par?.length) l.push(`- Couvert sans réseau par : ${r.couvert_par.join(', ')}`);
      for (const o of r.observations ?? []) l.push(`- Constat annexe : ${o}`);
      if (r.preuves.length) {
        l.push('', '<details><summary>Preuves</summary>', '');
        for (const pr of r.preuves) l.push(`${pr.libelle} :`, '', bloc(pr.contenu), '');
        l.push('</details>');
      }
      l.push('');
    }
  }

  l.push('## Ce que la batterie a laissé dans le bureau', '');
  l.push('Mode Lumi des comptes :', ...(p.mode.length ? p.mode.map((m) => `- ${m}`) : ['- inchangé']), '');
  l.push('Ménage (suppression douce) :', ...(p.menage.fait.length ? p.menage.fait.map((m) => `- ${m}`) : ['- rien à retirer']));
  if (p.menage.erreurs.length) l.push('', 'ÉCHECS du ménage — à reprendre avec `run.mts --nettoyer` :', ...p.menage.erreurs.map((m) => `- ${m}`));
  l.push('', `Restent en base, sans corbeille possible : les conversations de test (${p.conversations.length} ; les supprimer serait une suppression dure), leurs traces et leurs lignes du grand livre, et les empreintes d’écriture des tâches [ROB] (agent_actions, purgées par le produit après 24 h).`, '');
  return l.join('\n');
}

/** Une ligne par test, pour la console. */
export function ligneConsole(r: Resultat): string {
  const v = r.verdict === 'NON COUVERT' ? 'NON COUV.' : r.verdict;
  return `${v.padEnd(9)} ${r.id.padEnd(36)} ${(r.constats[0] ?? '').slice(0, 110)}`;
}
