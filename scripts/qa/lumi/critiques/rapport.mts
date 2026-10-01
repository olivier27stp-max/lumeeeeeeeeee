/**
 * Tests critiques de Lumi — le plan et le rapport (purs : ni base, ni réseau).
 * Le rapport est écrit pour le propriétaire du produit : pour chaque test, ce
 * qu'il a fait, ce qu'il a observé, son verdict et la preuve.
 */
import type { Compte, Famille, Resultat, TestCritique, Verdict } from './types.mts';

export const VERDICTS: readonly Verdict[] = ['PASS', 'FAIL', 'NON COUVERT', 'A RELIRE'];
/** La prod accepte 60 tours de Lumi par heure et par personne. */
export const LIMITE_HORAIRE = 60;

export interface Selection { familles?: string[]; tests?: string[]; sansBalayage?: boolean }

/** Les tests retenus par `--famille`, `--test` et `--sans-balayage`. */
export function selectionner(familles: Famille[], s: Selection): Array<{ famille: Famille; tests: TestCritique[] }> {
  return familles
    .filter((f) => !s.familles?.length || s.familles.includes(f.nom))
    .map((f) => ({ famille: f, tests: f.tests.filter((t) => (!s.tests?.length || s.tests.includes(t.id)) && !(s.sansBalayage && t.id.includes('.balayage.'))) }))
    .filter((x) => x.tests.length > 0);
}

/** Appels à /api/lumi/chat prévus, par compte. */
export function appelsPrevus(tests: TestCritique[]): Record<Compte, number> {
  return { proprietaire: tests.reduce((s, t) => s + (t.appels.proprietaire ?? 0), 0), technicien: tests.reduce((s, t) => s + (t.appels.technicien ?? 0), 0) };
}

/** Ce que `--plan` affiche : chaque test, ce qu'il ferait, ce qu'il écrirait — sans rien appeler. */
export function textePlan(choix: Array<{ famille: Famille; tests: TestCritique[] }>, o: { maxParCompte: number }): string {
  const lignes: string[] = ['PLAN — rien n’est appelé, rien n’est écrit.', ''];
  const tous = choix.flatMap((c) => c.tests);
  for (const { famille, tests } of choix) {
    const a = appelsPrevus(tests);
    lignes.push(`${famille.titre} — ${tests.length} test(s) ; appels à Lumi : propriétaire ${a.proprietaire}, technicien ${a.technicien}${famille.besoin_jeu_eval ? ' ; a besoin du jeu [EVAL]' : ''}${famille.besoin_bureau_b ? ' ; lit le bureau B (SELECT seulement)' : ''}`);
    lignes.push(`  Prouve : ${famille.prouve}`);
    for (const t of tests) {
      const n = (t.appels.proprietaire ?? 0) + (t.appels.technicien ?? 0);
      lignes.push(`  - ${t.id}${t.non_couvert ? '  [NON COUVERT en prod]' : ''}  (${n ? `${n} appel(s) à Lumi : ${[t.appels.proprietaire ? `propriétaire ${t.appels.proprietaire}` : '', t.appels.technicien ? `technicien ${t.appels.technicien}` : ''].filter(Boolean).join(', ')}` : 'aucun appel à Lumi'})`);
      lignes.push(`      fait      : ${t.fait}`);
      lignes.push(`      si défaut : ${t.si_defaut}`);
      for (const e of t.ecrit ?? []) lignes.push(`      écrit     : ${e}`);
      if (t.attente_discutable) lignes.push(`      attente discutable : ${t.attente_discutable}`);
      if (t.non_couvert) lignes.push(`      non couvert : ${t.non_couvert.raison} — couvert par : ${t.non_couvert.couvert_par.join(', ')}`);
    }
    lignes.push('');
  }
  const total = appelsPrevus(tous);
  lignes.push(`TOTAL : ${tous.length} test(s), dont ${tous.filter((t) => t.non_couvert).length} non couvert(s) en prod par construction.`);
  lignes.push(`Appels à Lumi (POST /api/lumi/chat) : propriétaire ${total.proprietaire}, technicien ${total.technicien} — limite de la prod : ${LIMITE_HORAIRE} par heure et par personne ; budget de la passe : ${o.maxParCompte} par compte.`);
  if (total.proprietaire > o.maxParCompte || total.technicien > o.maxParCompte) lignes.push('ATTENTION : le plan dépasse le budget de la passe — découper avec --famille.');
  lignes.push('Écritures de service de la batterie : memberships.lumi_mode des deux comptes (remis à la fin) ; les fiches [CRIT] listées ci-dessus (retirées à la fin, suppression douce).');
  lignes.push('Le bureau B n’est jamais écrit ; aucun de ses comptes n’est utilisé.');
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

/** Un lancement du lanceur (la batterie se joue famille par famille : un rapport peut en réunir plusieurs). */
export interface Lancement { date: string; familles: string[]; comptes: Record<Compte, string>; appels: Record<Compte, number> }
export interface Passe {
  date: string; api: string; org_a: string; org_b: string; jeu_present: boolean;
  /** Appels à Lumi, tous lancements réunis. */
  appels: Record<Compte, number>; menage: { fait: string[]; erreurs: string[] }; mode: string[];
  conversations: string[]; selection: Selection; lancements: Lancement[];
  /** Qui a répondu, sur toutes les conversations de la batterie : modèle, étage, nombre de tours. */
  modeles?: Array<{ modele: string; etage: number | null; tours: number }>;
  /** Palier de crédits du bureau à la fin du dernier lancement (normal, econome, restreint, epuise). */
  palier?: string | null;
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

/** Le rapport lisible : le bilan, ce qui échoue, ce qui reste à relire, ce qui n'est pas couvert, puis chaque test avec sa preuve. */
export function rapportMarkdown(p: Passe, familles: Famille[], resultats: Resultat[]): string {
  const b = bilanDe(resultats);
  const titreDe = (nom: string): string => familles.find((f) => f.nom === nom)?.titre ?? nom;
  const l: string[] = [];
  l.push('# Tests critiques de Lumi — sécurité et exactitude', '');
  l.push(`Passe du ${p.date}, contre ${p.api}, bureau de test A \`${p.org_a}\` ; bureau B \`${p.org_b}\` en lecture seule.`);
  l.push(`Jeu [EVAL] ${p.jeu_present ? 'présent' : 'ABSENT (les tests qui en dépendent sont NON COUVERT)'}. Appels à Lumi, tous lancements réunis : propriétaire ${p.appels.proprietaire}, technicien ${p.appels.technicien}.`, '');
  if (p.lancements.length) {
    l.push('La batterie a été jouée famille par famille (limite de 60 tours par heure et par personne) :', '');
    for (const x of p.lancements) l.push(`- ${x.date} — ${x.familles.join(', ')} — propriétaire : ${x.comptes.proprietaire} (${x.appels.proprietaire} appel(s)), technicien : ${x.comptes.technicien} (${x.appels.technicien} appel(s))`);
    l.push('');
  }
  if (p.modeles?.length) {
    const agent = p.modeles.filter((m) => m.etage === 6);
    const sansModele = p.modeles.filter((m) => m.etage !== null && m.etage < 5).reduce((n, m) => n + m.tours, 0);
    l.push(`**Qui a répondu.** Tours d’agent : ${agent.map((m) => `${m.tours} par ${m.modele}`).join(', ') || 'aucun'} ; ${sansModele} tour(s) servis sans modèle (étages 0 à 4). Palier de crédits du bureau en fin de passe : « ${p.palier ?? 'inconnu'} ».`);
    if (agent.length && agent.every((m) => /haiku/i.test(m.modele))) l.push('**Limite de cette passe.** Le bureau de test était en palier dégradé (garde-fou journalier : plus de 15 % des crédits du mois consommés dans la journée par les batteries) : c’est le modèle de repli (Haiku 4.5) qui a répondu, pas le modèle habituel (Sonnet 5). Les tests qui éprouvent le SERVEUR (isolation, rôles par l’API et la base, carte avant exécution, une seule exécution, crédits, journaux) valent tels quels ; ceux qui éprouvent le MODÈLE (refus, injection, extraction, exactitude des réponses) valent pour le modèle de repli et sont à rejouer en palier normal.');
    l.push('');
  }
  l.push('Tout est jugé par du code (présence ou absence d’un fait, d’un événement, d’une ligne) ; aucun modèle ne juge. « A RELIRE » = le code n’a trouvé aucun défaut mais le critère demande un humain.', '');
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
  const tons = resultats.filter((r) => r.verdict === 'PASS' && r.a_relire);
  if (tons.length) {
    l.push(`## Réussis par le code, avec un critère de ton à relire (${tons.length})`, '');
    for (const r of tons) l.push(`- **${r.id}** — ${r.a_relire}`);
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
      l.push(`- Ce qu’il a observé :`);
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

  l.push('## Ce que la batterie a laissé dans le bureau A', '');
  l.push('Mode Lumi des comptes :', ...p.mode.map((m) => `- ${m}`), '');
  l.push('Ménage (suppression douce) :', ...(p.menage.fait.length ? p.menage.fait.map((m) => `- ${m}`) : ['- rien à retirer']));
  if (p.menage.erreurs.length) l.push('', 'ÉCHECS du ménage — à reprendre avec `run.mts --nettoyer` :', ...p.menage.erreurs.map((m) => `- ${m}`));
  l.push('', `Restent en base, sans corbeille possible : les conversations de test des deux comptes (${p.conversations.length} ; les supprimer serait une suppression dure), leurs traces et leurs lignes du grand livre, les lignes du journal du bac à sable et du journal des envois créées par « actions.bac-a-sable », et les notes piégées neutralisées (texte remplacé).`, '');
  return l.join('\n');
}

/** Une ligne par test, pour la console. */
export function ligneConsole(r: Resultat): string {
  const v = r.verdict === 'NON COUVERT' ? 'NON COUV.' : r.verdict;
  return `${v.padEnd(9)} ${r.id.padEnd(40)} ${(r.constats[0] ?? '').slice(0, 110)}`;
}
