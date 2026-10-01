/**
 * Batterie de l'agent de support — le plan et le rapport (purs : ni base, ni réseau).
 * Le rapport est écrit pour le propriétaire du produit : pour chaque test, ce qu'il a fait,
 * ce qu'il a observé, son verdict et la preuve (question, réponse, étage, ticket, lignes lues).
 */
import { tableauCout } from './familles/cout.mts';
import { PLAFOND_MODELE_PAR_JOUR, etagePrevu, reponsesModeleAuPire, reponsesModelePrevues } from './prevision.mts';
import type { Famille, Resultat, TestSupport, Tour, Verdict } from './types.mts';

export const VERDICTS: readonly Verdict[] = ['PASS', 'FAIL', 'NON COUVERT', 'A RELIRE'];
/** Le chat de support accepte 60 messages par heure et par personne (server/routes/support.ts : limiteChat). */
export const LIMITE_HORAIRE = 60;
/** Et 5 requêtes par minute et par personne sur tout /api/support (server/index.ts). */
export const LIMITE_PAR_MINUTE = 5;
/** Délai entre deux requêtes d'un même compte : 60 s / 5, plus une marge. */
export const INTERVALLE_MS = 13_000;
/**
 * Coût estimé d'une question servie par le modèle, en cents US. Base : prompt stable ≈ 3 000 tokens
 * (lu en cache après le premier tour), dossier ≈ 500, deux appels au modèle (recherche dans la doc,
 * puis réponse), ≈ 300 tokens de sortie — au tarif de server/lib/lumi/tarifs.ts pour claude-sonnet-5.
 * Volontairement large : le coût réel est relu par la famille « cout ».
 */
export const COUT_ESTIME_PAR_REPONSE_MODELE_CENTS = 1.5;
export const BUDGET_CENTS = 150;
/**
 * Les deux lots. Le serveur ne laisse le modèle répondre que 60 fois par bureau et par 24 heures
 * (garde-fous.ts) ; la batterie entière en demande davantage. Le lot 1 porte les familles de sûreté
 * et de justesse ; le lot 2, les « comment faire ». Chacun relève son coût.
 */
export const LOT_1 = 'tarifs,inexistant,escalade,donnees,pas-d-action,injection,langue,cout';
export const LOT_2 = 'kb,cout';

export interface Selection { familles?: string[]; tests?: string[] }

/** Les tests retenus par `--famille` et `--test`. */
export function selectionner(familles: Famille[], s: Selection): Array<{ famille: Famille; tests: TestSupport[] }> {
  return familles
    .filter((f) => !s.familles?.length || s.familles.includes(f.nom))
    .map((f) => ({ famille: f, tests: f.tests.filter((t) => !s.tests?.length || s.tests.includes(t.id)) }))
    .filter((x) => x.tests.length > 0);
}

/**
 * Répartit les tests qui appellent le chat sur les comptes, à tour de rôle et dans l'ordre :
 * deux requêtes d'un même compte sont ainsi séparées par celles des autres. Le canari, joué
 * avant tout, prend le premier compte.
 */
export function repartir(tests: TestSupport[], comptes: string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (!comptes.length) return out;
  let i = 0;
  for (const t of tests) {
    if (t.appels <= 0 || out.has(t.id)) continue;
    out.set(t.id, comptes[i % comptes.length]);
    i += 1;
  }
  return out;
}

/** Appels à /support/chat prévus, par compte. */
export function appelsParCompte(tests: TestSupport[], comptes: string[]): Record<string, number> {
  const par: Record<string, number> = Object.fromEntries(comptes.map((c) => [c, 0]));
  const repartition = repartir(tests, comptes);
  for (const t of tests) { const c = repartition.get(t.id); if (c) par[c] += t.appels; }
  return par;
}

/** Ce que `--plan` affiche : chaque test, ce qu'il ferait, son compte, l'étage prévu — sans rien appeler. */
export function textePlan(choix: Array<{ famille: Famille; tests: TestSupport[] }>, o: { canari: TestSupport; comptes: string[]; maxParCompte: number }): string {
  const lignes: string[] = ['PLAN — rien n’est appelé, rien n’est écrit, aucune variable d’environnement n’est lue.', ''];
  const choisis = choix.flatMap((c) => c.tests);
  const avecAppels = choisis.some((t) => t.appels > 0);
  // Le canari passe d'abord, quelle que soit la sélection, dès qu'une question doit être posée.
  const tous = avecAppels && !choisis.some((t) => t.id === o.canari.id) ? [o.canari, ...choisis] : [...choisis].sort((a, b) => Number(b.id === o.canari.id) - Number(a.id === o.canari.id));
  const repartition = repartir(tous, o.comptes);
  if (avecAppels) lignes.push(`D’ABORD, quelle que soit la sélection : ${o.canari.id} (compte ${repartition.get(o.canari.id) ?? '—'}) — ${o.canari.titre}. Sans canari concluant, la batterie s’arrête avant toute autre question.`, '');
  for (const { famille, tests } of choix) {
    const appels = tests.reduce((s, t) => s + t.appels, 0);
    lignes.push(`${famille.titre} — ${tests.length} test(s) ; ${appels} appel(s) au chat de support ; prévision : ${reponsesModelePrevues(tests)} réponse(s) du modèle${famille.besoin_jeu_eval ? ' ; a besoin du jeu [EVAL]' : ''}`);
    lignes.push(`  Prouve : ${famille.prouve}`);
    for (const t of tests) {
      const p = etagePrevu(t.question, { humain: t.humain });
      lignes.push(`  - ${t.id}${t.non_couvert ? '  [NON COUVERT en prod]' : ''}  (${t.appels ? `compte ${repartition.get(t.id) ?? '—'} ; étage prévu : ${p.etage ?? '—'} — ${p.par}` : 'aucun appel au chat'})`);
      if (t.question) lignes.push(`      question  : ${t.question}`);
      lignes.push(`      fait      : ${t.fait}`);
      lignes.push(`      si défaut : ${t.si_defaut}`);
      for (const e of t.ecrit ?? []) lignes.push(`      écrit     : ${e}`);
      if (t.attente_discutable) lignes.push(`      attente discutable : ${t.attente_discutable}`);
      if (t.non_couvert) lignes.push(`      non couvert : ${t.non_couvert.raison} — couvert par : ${t.non_couvert.couvert_par.join(', ')}`);
    }
    lignes.push('');
  }
  const par = appelsParCompte(tous, o.comptes);
  const total = Object.values(par).reduce((s, n) => s + n, 0);
  const prevues = reponsesModelePrevues(tous);
  const auPire = reponsesModeleAuPire(tous);
  const dollars = (cents: number): string => `${(cents / 100).toFixed(2)} $ US`;
  lignes.push(`TOTAL : ${tous.length} test(s), ${total} appel(s) à POST /api/support/chat.`);
  lignes.push(`Appels par compte : ${Object.entries(par).map(([c, n]) => `${c} ${n}`).join(', ')} — limites du serveur : ${LIMITE_HORAIRE} par heure et par personne ; ${LIMITE_PAR_MINUTE} requêtes par minute et par personne sur /api/support (un appel toutes les ${INTERVALLE_MS / 1000} s par compte, fermetures comprises) ; budget de la passe : ${o.maxParCompte} par compte.`);
  if (Object.values(par).some((n) => n > o.maxParCompte)) lignes.push('ATTENTION : le plan dépasse le budget d’appels d’un compte — découper avec --famille ou ajouter des comptes.');
  lignes.push(`Réponses du modèle prévues : ${prevues} (pire cas : ${auPire}, si ni la FAQ ni le centre d’aide ne servent rien) — plafond du serveur : ${PLAFOND_MODELE_PAR_JOUR} par bureau et par 24 heures, toutes sessions confondues.`);
  if (prevues > PLAFOND_MODELE_PAR_JOUR) lignes.push(`ATTENTION : la sélection prévoit plus de réponses du modèle que le plafond du jour. La jouer en deux lots, à 24 heures d’écart dans ce bureau (ou le second dans un autre bureau de test) : « --famille ${LOT_1} », puis « --famille ${LOT_2} ».`);
  else if (auPire > PLAFOND_MODELE_PAR_JOUR) lignes.push(`  Au pire cas le plafond serait atteint en cours de passe : les questions suivantes recevraient la réponse fixe du plafond et seraient NON COUVERT. Le lanceur refuse de partir si « déjà servies en 24 h + prévues » dépasse ${PLAFOND_MODELE_PAR_JOUR}.`);
  lignes.push(`Coût d’inférence estimé : ${prevues} × ${COUT_ESTIME_PAR_REPONSE_MODELE_CENTS} ¢ ≈ ${dollars(prevues * COUT_ESTIME_PAR_REPONSE_MODELE_CENTS)} (pire cas : ${dollars(auPire * COUT_ESTIME_PAR_REPONSE_MODELE_CENTS)}) — budget : ${dollars(BUDGET_CENTS)}. Le coût réel est relu dans ai_usage par la famille « cout ».`);
  lignes.push(`Durée estimée : ${Math.ceil((total * 12 + Math.ceil(total / Math.max(1, o.comptes.length)) * (INTERVALLE_MS / 1000)) / 60)} minute(s) environ (questions, lectures de preuve, puis fermeture des tickets).`);
  lignes.push('Écritures : celles du produit lui-même — un ticket de support par question (fermé à la fin par l’API du support), ses messages, une trace par tour, une ligne du grand livre par appel au modèle ; pour chaque escalade, un courriel CONSIGNÉ au bac à sable (envois_simules), jamais envoyé. Aucune suppression. Seule écriture de service possible : en repli, le statut « closed » d’un ticket de la batterie que l’API n’a pas pu fermer.');
  lignes.push('Les étages prévus viennent du code de cette branche (FAQ et centre d’aide rejoués hors réseau) : la production peut différer ; l’étage réel est relu dans lumi_traces.');
  return lignes.join('\n');
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

export interface TicketDeLaPasse { id: string; compte: string; courriel: string; ferme: boolean; fermeture?: string }
export interface Lancement { date: string; familles: string[]; comptes: Record<string, string>; appels: Record<string, number> }
export interface Passe {
  date: string; api: string; org: string; nom_org: string; forfait: string | null; jeu_present: boolean;
  selection: Selection; lancements: Lancement[];
  /** Appels au chat, tous lancements réunis, par compte. */
  appels: Record<string, number>;
  /** Tous les tours de la batterie (le tableau des coûts en sort). */
  tours: Tour[];
  tickets: TicketDeLaPasse[];
  /** Réponses du modèle déjà servies au bureau dans les 24 h précédant le dernier lancement. */
  reponses_modele_24h_avant: number;
  /** La batterie s'est arrêtée d'elle-même : pourquoi. */
  arret?: string | null;
  /** Constats de sûreté hors de tout test (redéploiement pendant la passe, migration démarrée…). */
  alertes: string[];
  notes?: string[];
}

/** Réunit les résultats d'un lancement précédent et ceux du lancement en cours : un test rejoué remplace son ancien résultat. */
export function fusionner(familles: Famille[], anciens: Resultat[], nouveaux: Resultat[]): Resultat[] {
  const rejoues = new Set(nouveaux.map((r) => r.id));
  const tous = [...anciens.filter((r) => !rejoues.has(r.id)), ...nouveaux];
  const ordre = familles.flatMap((f) => f.tests.map((t) => t.id));
  return tous.sort((a, b) => ordre.indexOf(a.id) - ordre.indexOf(b.id));
}

const bloc = (texte: string): string => `\`\`\`\n${String(texte).replace(/```/g, "'''")}\n\`\`\``;

/** Le rapport lisible : l'arrêt s'il y en a un, le bilan, ce qui échoue, ce qui reste à relire, ce qui n'est pas couvert, le coût, puis chaque test avec sa preuve. */
export function rapportMarkdown(p: Passe, familles: Famille[], resultats: Resultat[]): string {
  const b = bilanDe(resultats);
  const titreDe = (nom: string): string => familles.find((f) => f.nom === nom)?.titre ?? nom;
  const l: string[] = [];
  l.push('# Batterie de l’agent de support', '');
  if (p.arret) l.push(`> **ARRÊT DE LA BATTERIE.** ${p.arret}`, '');
  for (const a of p.alertes) l.push(`> **ALERTE.** ${a}`, '');
  l.push(`Passe du ${p.date}, contre ${p.api}, bureau de test « ${p.nom_org} » \`${p.org}\` (forfait ${p.forfait ?? 'aucun'}).`);
  l.push(`Jeu [EVAL] ${p.jeu_present ? 'présent' : 'ABSENT (les tests qui en dépendent sont NON COUVERT)'}. Appels au chat de support, tous lancements réunis : ${Object.entries(p.appels).map(([c, n]) => `${c} ${n}`).join(', ') || 'aucun'}. Réponses du modèle déjà servies au bureau dans les 24 h avant le dernier lancement : ${p.reponses_modele_24h_avant} (plafond : ${PLAFOND_MODELE_PAR_JOUR}).`, '');
  if (p.lancements.length > 1) {
    l.push('La batterie a été jouée en plusieurs lancements :', '');
    for (const x of p.lancements) l.push(`- ${x.date} — ${x.familles.join(', ')} — ${Object.entries(x.appels).map(([c, n]) => `${c} : ${n} appel(s)`).join(', ') || 'aucun appel'}`);
    l.push('');
  }
  l.push('Tout est jugé par du code (présence ou absence d’un mot, d’un montant, d’une ligne) ; aucun modèle ne juge. « A RELIRE » = le code n’a trouvé aucun défaut mais le critère demande un humain. « NON COUVERT » = le test n’a pas pu trancher (flux coupé, plafond, limite) ; aucun test n’est rejoué jusqu’à ce qu’il passe.', '');
  l.push('## Bilan', '', '| Famille | PASS | FAIL | NON COUVERT | A RELIRE |', '|---|---:|---:|---:|---:|');
  for (const [nom, v] of Object.entries(b.par_famille)) l.push(`| ${titreDe(nom)} | ${v.PASS} | ${v.FAIL} | ${v['NON COUVERT']} | ${v['A RELIRE']} |`);
  l.push(`| **Total (${b.total})** | **${b.par_verdict.PASS}** | **${b.par_verdict.FAIL}** | **${b.par_verdict['NON COUVERT']}** | **${b.par_verdict['A RELIRE']}** |`, '');

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

  l.push('## Coût', '');
  if (p.tours.length) l.push(...tableauCout(p.tours), '');
  else l.push('Aucun tour relevé.', '');

  l.push('## Détail de chaque test', '');
  for (const f of familles) {
    const rs = resultats.filter((r) => r.famille === f.nom);
    if (!rs.length) continue;
    l.push(`### ${f.titre}`, '', `_${f.prouve}_`, '');
    for (const r of rs) {
      l.push(`#### ${r.verdict} — ${r.id}`, '', `**${r.titre}**`, '');
      l.push(`- Ce que le test a fait : ${r.fait}`);
      l.push(`- Compte : ${r.compte ?? '—'}`);
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
  const fermes = p.tickets.filter((t) => t.ferme).length;
  l.push(`${p.tickets.length} ticket(s) de support ouverts par la batterie, ${fermes} fermé(s)${p.tickets.length - fermes ? ` — ${p.tickets.length - fermes} ENCORE OUVERT(S), à fermer avec \`run.mts --fermer\`` : ''}. Aucune suppression : les tickets fermés, leurs messages, leurs traces, les lignes du grand livre et les courriels consignés au bac à sable restent en base.`);
  for (const t of p.tickets.filter((x) => !x.ferme)) l.push(`- encore ouvert : ${t.id} (compte ${t.compte})${t.fermeture ? ` — ${t.fermeture}` : ''}`);
  l.push('');
  return l.join('\n');
}

/** Une ligne par test, pour la console. */
export function ligneConsole(r: Resultat): string {
  const v = r.verdict === 'NON COUVERT' ? 'NON COUV.' : r.verdict;
  return `${v.padEnd(9)} ${r.id.padEnd(36)} ${(r.constats[0] ?? '').slice(0, 120)}`;
}
