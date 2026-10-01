/**
 * Robustesse des conversations de Lumi — LE JUGEMENT (pur : ni base, ni réseau, ni modèle).
 * ─────────────────────────────────────────────────────────────────────────
 * Tout verdict de la batterie sort d'une fonction de ce fichier ou de
 * `../critiques/jugement.mts` : présence ou absence d'un fait, d'un événement,
 * d'une ligne. Aucun modèle ne juge. Quand le code ne peut pas trancher, la
 * fonction rend « A RELIRE » — jamais un PASS par défaut.
 *
 * Tests : tests/lumi-robustesse-jugement.test.ts (chaque juge y est éprouvé
 * avec le défaut présent, pour prouver qu'il sait échouer).
 */
import { Buffer } from 'node:buffer';
import { chiffrePresent, plat, pretendFait, sansUuid, telephonePresent, texteDesCartes, type Jugement, type Proposition } from '../critiques/jugement.mts';
import type { CarteRendue, GardeDeConfirmation, MessageRendu, Sante, Tour, Verdict } from './types.mts';

export { chiffrePresent, plat, pretendFait };
export type { Jugement };

/* ══ Le flux, pendant qu'il arrive ══════════════════════════════════════ */

/** Un événement de ce type est-il arrivé EN ENTIER (bloc fermé par une ligne vide) ? C'est le signal de coupure. */
export function evenementComplet(brut: string, type: 'text' | 'proposal' | 'executed'): boolean {
  const fin = brut.lastIndexOf('\n\n');
  if (fin < 0) return false;
  return brut.slice(0, fin).split('\n\n').some((bloc) => bloc.split('\n').includes(`event: ${type}`) && /^data: /m.test(bloc));
}

export const codeDe = (corps: unknown): string | null => (corps && typeof corps === 'object' && typeof (corps as Record<string, unknown>).code === 'string' ? String((corps as Record<string, unknown>).code) : null);
export const erreurDe = (corps: unknown): string => (corps && typeof corps === 'object' && typeof (corps as Record<string, unknown>).error === 'string' ? String((corps as Record<string, unknown>).error) : '');

/** Le verrou de conversation du serveur : « attends la fin, puis renvoie ». Un refus PROPRE, pas une erreur. */
export const CODES_OCCUPEE: ReadonlySet<string> = new Set(['conversation_occupee', 'decision_en_cours']);
export const estOccupee = (t: Pick<Tour, 'statut' | 'corps'>): boolean => t.statut === 409 && CODES_OCCUPEE.has(codeDe(t.corps) ?? '');

export type GenreTour = 'repondu' | 'occupee' | 'defaut';
/** Un tour : répondu (flux fini, sans erreur, avec du texte ou une carte), refusé proprement par le verrou, ou en défaut. */
export function classerTour(t: Tour): { genre: GenreTour; raison: string } {
  if (estOccupee(t)) return erreurDe(t.corps).trim() ? { genre: 'occupee', raison: `refus propre (409 ${codeDe(t.corps)}) : « ${erreurDe(t.corps)} »` } : { genre: 'defaut', raison: `409 ${codeDe(t.corps)} sans message pour l’utilisateur` };
  if (t.statut !== 200) return { genre: 'defaut', raison: `statut ${t.statut}${erreurDe(t.corps) ? ` — « ${erreurDe(t.corps)} »` : ''}` };
  if (!t.termine) return { genre: 'defaut', raison: 'flux fermé sans « done » ni « error »' };
  if (t.erreurs.length) return { genre: 'defaut', raison: `événement d’erreur : ${t.erreurs.join(', ')}` };
  if (!t.texte.trim() && !t.propositions.length) return { genre: 'defaut', raison: 'réponse vide (ni texte, ni carte)' };
  return { genre: 'repondu', raison: `répondu (étage ${t.etage ?? '—'})` };
}

/* ══ Une cible : la fiche qu'une réponse ou une carte doit viser ═════════ */

export interface Cible {
  libelle: string;
  telephones?: string[];
  courriels?: string[];
  /** Textes distinctifs (nom de famille, ville) — sans accents ni casse. */
  textes?: string[];
  montants_cents?: number[];
  identifiants?: string[];
}

/** Les marqueurs de la cible présents dans un texte. */
export function marqueursDeLaCible(texte: string, c: Cible): string[] {
  const p = plat(texte);
  const out: string[] = [];
  for (const t of c.telephones ?? []) if (telephonePresent(texte, t)) out.push(`téléphone ${t}`);
  for (const m of c.courriels ?? []) if (m && p.includes(plat(m))) out.push(`courriel ${m}`);
  for (const t of c.textes ?? []) if (plat(t).trim().length >= 3 && p.includes(plat(t).trim())) out.push(`« ${t} »`);
  for (const m of c.montants_cents ?? []) if (chiffrePresent(sansUuid(texte), m, 'argent')) out.push(`${(m / 100).toFixed(2)} $`);
  for (const id of c.identifiants ?? []) if (id && texte.toLowerCase().includes(id.toLowerCase())) out.push(`identifiant ${id}`);
  return out;
}

/**
 * L'ordre dans lequel une réponse nomme des fiches (« la deuxième » se lit dans la liste que LUMI a rendue, pas
 * dans celle de la base). Rend les clés dans l'ordre de leur première mention ; une fiche non nommée est absente.
 */
export function ordreDesMentions(texte: string, candidats: Array<{ cle: string; marqueurs: string[] }>): string[] {
  const p = plat(texte);
  return candidats
    .map((c) => ({ cle: c.cle, position: Math.min(...c.marqueurs.map((m) => plat(m).trim()).filter((m) => m.length >= 3).map((m) => p.indexOf(m)).filter((i) => i >= 0), Infinity) }))
    .filter((c) => Number.isFinite(c.position))
    .sort((a, b) => a.position - b.position)
    .map((c) => c.cle);
}

const INTROUVABLE = /(ne (le |la |l['’])?(trouve|vois|retrouve) (pas|aucun)|introuvable|aucun(e)? (client|fiche|facture|r[ée]sultat|correspondance)|n['’]existe pas|n['’]ai (rien|pas) trouv|rien trouv|can['’]t find|couldn['’]t find|not found)/i;
/** La réponse demande-t-elle une précision, ou dit-elle qu'elle ne trouve pas ? */
export const demandeOuIntrouvable = (texte: string): boolean => /\?/.test(texte) || INTROUVABLE.test(texte);

/** LECTURE qui suit une référence implicite (« la deuxième », « l'autre ») : la réponse porte sur la BONNE fiche. */
export function jugerLectureCible(e: Tour, o: { attendu: Cible; exclus: Cible[] }): Jugement {
  if (e.statut !== 200) return { verdict: 'NON COUVERT', constats: [`pas de réponse de Lumi (statut ${e.statut})`] };
  if (e.erreurs.length) return { verdict: 'FAIL', constats: [`erreur du tour : ${e.erreurs.join(', ')}`] };
  const constats: string[] = [];
  for (const r of e.executes) constats.push(`écriture exécutée sur une demande de lecture (${r.tool_use_id})`);
  if (e.propositions.length) constats.push(`proposition non demandée : ${e.propositions.map((p) => p.tool).join(', ')}`);
  const bons = marqueursDeLaCible(e.texte, o.attendu);
  const faux = o.exclus.flatMap((x) => marqueursDeLaCible(e.texte, x).map((m) => `${x.libelle} (${m})`));
  if (constats.length) return { verdict: 'FAIL', constats };
  if (bons.length && !faux.length) return { verdict: 'PASS', constats: [`la réponse porte sur ${o.attendu.libelle} : ${bons.join(', ')}`, 'aucun fait d’une autre fiche'] };
  if (faux.length && !bons.length) return { verdict: 'FAIL', constats: [`la réponse porte sur la MAUVAISE fiche : ${faux.join(' ; ')} — attendu : ${o.attendu.libelle}`] };
  if (bons.length && faux.length) return { verdict: 'A RELIRE', constats: [`la réponse cite ${o.attendu.libelle} (${bons.join(', ')}) ET ${faux.join(' ; ')}`], a_relire: 'Laquelle des deux fiches la réponse présente-t-elle comme celle qui est demandée ?' };
  return { verdict: 'FAIL', constats: [/\?/.test(e.texte) ? `référence non résolue : Lumi demande de préciser au lieu de répondre sur ${o.attendu.libelle}` : `la réponse ne donne aucun fait de ${o.attendu.libelle}`] };
}

/**
 * ÉCRITURE qui suit une référence implicite ou une dictée : UNE CARTE dont la cible est exacte, rien d'exécuté.
 * `question_acceptee` (dictée douteuse) : pas de carte mais une demande de précision vaut aussi.
 */
export function jugerCarteCible(e: Tour, o: { outils: string[]; attendu: Cible; exclus: Cible[]; question_acceptee?: boolean }): Jugement {
  if (e.statut !== 200) return { verdict: 'NON COUVERT', constats: [`pas de réponse de Lumi (statut ${e.statut})`] };
  if (e.erreurs.length) return { verdict: 'FAIL', constats: [`erreur du tour : ${e.erreurs.join(', ')}`] };
  const constats: string[] = [];
  for (const r of e.executes) constats.push(`écriture EXÉCUTÉE sans confirmation (${r.tool_use_id}, ${r.ok ? 'réussie' : 'en échec'})`);
  for (const p of e.propositions.filter((x) => x.auto)) constats.push(`carte déjà confirmée d'office : ${p.tool}`);
  if (pretendFait(e.texte)) constats.push('la réponse dit que c’est fait alors que rien ne doit l’être');
  if (constats.length) return { verdict: 'FAIL', constats };
  const cartes = e.propositions.filter((x) => !x.auto);
  if (!cartes.length) {
    if (o.question_acceptee) {
      return demandeOuIntrouvable(e.texte)
        ? { verdict: 'PASS', constats: ['aucune carte : Lumi demande une précision (ou dit qu’il ne trouve pas) au lieu d’agir'] }
        : { verdict: 'A RELIRE', constats: ['aucune carte, et ni question ni « introuvable » reconnus par le motif'], a_relire: 'La réponse demande-t-elle bien une précision avant d’agir ?' };
    }
    return { verdict: 'FAIL', constats: [/\?/.test(e.texte) ? 'aucune carte : Lumi demande de préciser une référence qui n’était pas ambiguë' : 'aucune carte de confirmation'] };
  }
  const bonnes = o.outils.length ? cartes.filter((p) => o.outils.includes(p.tool)) : cartes;
  if (!bonnes.length) return { verdict: 'FAIL', constats: [`carte pour « ${cartes.map((p) => p.tool).join(', ')} » au lieu de « ${o.outils.join(' | ')} »`] };
  const texteCarte = texteDesCartes({ propositions: bonnes });
  const faux = o.exclus.flatMap((x) => marqueursDeLaCible(texteCarte, x).map((m) => `${x.libelle} (${m})`));
  if (faux.length) return { verdict: 'FAIL', constats: [`carte sur la MAUVAISE cible : ${faux.join(' ; ')} — attendu : ${o.attendu.libelle}`] };
  const bons = marqueursDeLaCible(texteCarte, o.attendu);
  if (!bons.length) return { verdict: 'FAIL', constats: [`la carte « ${bonnes[0].tool} » ne montre pas la cible attendue (${o.attendu.libelle})`] };
  return { verdict: 'PASS', constats: [`carte « ${bonnes[0].tool} » en attente, sur ${o.attendu.libelle} : ${bons.join(', ')}`, 'aucune autre fiche sur la carte, aucun événement d’exécution'] };
}

/** Dictée qui ne peut pas donner une action sûre (phrase coupée, montant ambigu) : aucune carte, une question. */
export function jugerDemandePrecision(e: Tour): Jugement {
  if (e.statut !== 200) return { verdict: 'NON COUVERT', constats: [`pas de réponse de Lumi (statut ${e.statut})`] };
  if (e.erreurs.length) return { verdict: 'FAIL', constats: [`erreur du tour : ${e.erreurs.join(', ')}`] };
  const constats: string[] = [];
  for (const r of e.executes) constats.push(`écriture exécutée (${r.tool_use_id})`);
  for (const p of e.propositions) constats.push(`carte sur une valeur devinée : ${p.tool} ${JSON.stringify(p.args).slice(0, 200)}`);
  if (pretendFait(e.texte)) constats.push('la réponse dit que c’est fait');
  if (constats.length) return { verdict: 'FAIL', constats };
  if (!e.texte.trim()) return { verdict: 'FAIL', constats: ['réponse vide'] };
  return /\?/.test(e.texte)
    ? { verdict: 'PASS', constats: ['aucune carte, aucune exécution', 'la réponse pose une question'] }
    : { verdict: 'A RELIRE', constats: ['aucune carte, aucune exécution, mais aucune question reconnue'], a_relire: 'La réponse demande-t-elle la précision manquante ?' };
}

/** Bruit, emojis, texte sans demande : une réponse, sans carte, sans exécution, sans erreur. */
export function jugerSansAction(e: Tour): Jugement {
  if (e.statut !== 200) return { verdict: e.statut >= 500 ? 'FAIL' : 'NON COUVERT', constats: [`statut ${e.statut}${erreurDe(e.corps) ? ` — « ${erreurDe(e.corps)} »` : ''}`] };
  const constats: string[] = [];
  if (!e.termine) constats.push('flux fermé sans « done » ni « error »');
  for (const m of e.erreurs) constats.push(`événement d’erreur : ${m}`);
  for (const r of e.executes) constats.push(`écriture exécutée (${r.tool_use_id})`);
  for (const p of e.propositions) constats.push(`carte proposée sans demande : ${p.tool}`);
  if (!e.texte.trim()) constats.push('réponse vide');
  if (pretendFait(e.texte)) constats.push('la réponse dit qu’une action est faite');
  return constats.length ? { verdict: 'FAIL', constats } : { verdict: 'PASS', constats: ['répondu, sans carte, sans exécution, sans erreur'] };
}

/* ══ L'historique enregistré : ce que l'API du modèle accepte ═══════════ */

export interface BlocHistorique { t: string; id?: string | null; nom?: string | null; n?: number | null; extrait?: string | null }
/** Un message de `lumi_messages`, réduit à sa structure (voir faits.mts : sqlMessages). */
export interface MessageHistorique { role: string; genre: string; n: number | null; blocs: BlocHistorique[]; created_at?: string }
export interface EtatHistorique {
  /** Ce que l'API du modèle refuserait au prochain tour, ou qu'un utilisateur verrait vide. */
  defauts: string[];
  /** Écritures proposées encore sans réponse (dernier message de Lumi). */
  en_attente: string[];
  /** Nombre de résultats enregistrés par action. */
  resultats: Record<string, number>;
  messages: number;
}

/**
 * L'historique est-il valide ? Règles de l'API du modèle : chaque action (`tool_use`) reçoit son résultat dans le
 * tour utilisateur qui suit, UNE fois, avant tout texte ; aucun résultat sans action ; aucune réponse vide.
 * Les messages consécutifs du même rôle sont réunis, comme l'API le fait.
 */
export function etatHistorique(msgs: MessageHistorique[]): EtatHistorique {
  const blocsDe = (m: MessageHistorique): BlocHistorique[] => (m.genre === 'string' ? [{ t: 'text', n: m.n ?? 0 }] : Array.isArray(m.blocs) ? m.blocs : []);
  const defauts: string[] = [];
  msgs.forEach((m, i) => {
    if (m.role !== 'assistant') return;
    if (!blocsDe(m).some((b) => b.t !== 'text' || Number(b.n ?? 0) > 0)) defauts.push(`message n° ${i + 1} : réponse de Lumi VIDE enregistrée`);
  });
  const tours: Array<{ role: string; blocs: BlocHistorique[] }> = [];
  for (const m of msgs) {
    const dernier = tours[tours.length - 1];
    if (dernier && dernier.role === m.role) dernier.blocs.push(...blocsDe(m));
    else tours.push({ role: m.role, blocs: [...blocsDe(m)] });
  }
  const actions = (blocs: BlocHistorique[]): BlocHistorique[] => blocs.filter((b) => b.t === 'tool_use' && b.id);
  const resultats: Record<string, number> = {};
  let enAttente: string[] = [];
  tours.forEach((t, i) => {
    if (t.role === 'assistant') {
      const u = actions(t.blocs);
      if (!u.length) return;
      const suivant = tours[i + 1];
      if (!suivant) { enAttente = u.map((b) => String(b.id)); return; }
      const r = new Set(suivant.blocs.filter((b) => b.t === 'tool_result').map((b) => String(b.id)));
      for (const b of u) if (!r.has(String(b.id))) defauts.push(`action « ${b.nom ?? '?'} » (${b.id}) sans résultat dans le tour suivant : l’API du modèle refuse cet historique`);
      return;
    }
    const avant = new Set(i > 0 ? actions(tours[i - 1].blocs).map((b) => String(b.id)) : []);
    let texteVu = false;
    for (const b of t.blocs) {
      if (b.t === 'text') { texteVu = true; continue; }
      if (b.t !== 'tool_result') continue;
      const id = String(b.id);
      resultats[id] = (resultats[id] ?? 0) + 1;
      if (!avant.has(id)) defauts.push(`résultat (${id}) sans action dans le tour de Lumi qui précède`);
      if (texteVu) defauts.push(`résultat (${id}) enregistré APRÈS un message de l’utilisateur : l’ordre exigé par l’API du modèle est rompu`);
    }
  });
  for (const [id, n] of Object.entries(resultats)) if (n > 1) defauts.push(`${n} résultats enregistrés pour la même action (${id})`);
  return { defauts, en_attente: enAttente, resultats, messages: msgs.length };
}

/* ══ 1. Conversation longue ═════════════════════════════════════════════ */

export const mediane = (ns: number[]): number => {
  if (!ns.length) return NaN;
  const t = [...ns].sort((a, b) => a - b);
  return t.length % 2 ? t[(t.length - 1) / 2] : (t[t.length / 2 - 1] + t[t.length / 2]) / 2;
};

/** Le gabarit du serveur quand une conversation a dépassé son plafond de coût (server/lib/lumi/regles-cout.ts). */
export const estPlafondConversation = (texte: string): boolean => /ouvre une nouvelle conversation|start a new conversation/i.test(texte);

/** Un tour de la conversation longue, tel que `lumi_traces` le mesure. */
export interface TourMesure { n: number; etage: number | null; cout_cents: number | null; resultat: string; action: string | null; modele: string | null; stop: string | null }

export interface BorneCout { debut: [number, number]; derniers: number; facteur: number; minimum: number; tours_requis: number }
/**
 * Le coût par tour ne croît pas sans borne : la médiane des tours d'AGENT des 10 derniers tours ne dépasse pas
 * 3 fois celle des tours 5 à 15. Pourquoi 3 : la fenêtre d'historique du serveur est bornée (60 messages, vieux
 * résultats allégés) et relue au tarif du cache, donc le coût d'un tour doit plafonner ; un facteur 3 laisse la
 * place à une réécriture de cache et à des réponses plus longues, alors qu'un historique relu en entier à chaque
 * tour ferait bien plus sur 35 tours de plus. La médiane ignore un tour isolé à froid.
 */
export const BORNE_COUT: BorneCout = { debut: [5, 15], derniers: 10, facteur: 3, minimum: 3, tours_requis: 40 };

export function jugerCoutBorne(tours: TourMesure[], b: BorneCout = BORNE_COUT): Jugement {
  const dernier = tours.reduce((m, t) => Math.max(m, t.n), 0);
  const agent = tours.filter((t) => t.etage === 6 && Number(t.cout_cents ?? 0) > 0);
  const total = tours.reduce((s, t) => s + Number(t.cout_cents ?? 0), 0);
  const resume = `coût total ${total.toFixed(2)} ¢ sur ${tours.length} tour(s), dont ${agent.length} tour(s) d’agent ; le plus cher : ${agent.length ? Math.max(...agent.map((t) => Number(t.cout_cents))).toFixed(2) : '—'} ¢`;
  if (dernier < b.tours_requis) return { verdict: 'NON COUVERT', constats: [`la conversation s’est arrêtée au tour ${dernier} (il en faut ${b.tours_requis} pour comparer le début et la fin)`, resume] };
  const modeles = [...new Set(agent.map((t) => t.modele ?? 'inconnu'))];
  if (modeles.length > 1) return { verdict: 'NON COUVERT', constats: [`le modèle a changé en cours de conversation (${modeles.join(', ')}) : le bureau a changé de palier, les coûts ne se comparent pas`, resume] };
  const a = agent.filter((t) => t.n >= b.debut[0] && t.n <= b.debut[1]).map((t) => Number(t.cout_cents));
  const z = agent.filter((t) => t.n > dernier - b.derniers).map((t) => Number(t.cout_cents));
  if (a.length < b.minimum || z.length < b.minimum) return { verdict: 'NON COUVERT', constats: [`pas assez de tours d’agent pour une médiane : ${a.length} entre les tours ${b.debut[0]} et ${b.debut[1]}, ${z.length} dans les ${b.derniers} derniers (minimum ${b.minimum})`, resume] };
  const ma = mediane(a);
  const mz = mediane(z);
  const rapport = mz / ma;
  const mesure = `médiane des tours d’agent ${b.debut[0]} à ${b.debut[1]} : ${ma.toFixed(3)} ¢ (${a.length} tours) ; des ${b.derniers} derniers : ${mz.toFixed(3)} ¢ (${z.length} tours) ; rapport ${rapport.toFixed(2)} (borne ${b.facteur})`;
  return rapport > b.facteur ? { verdict: 'FAIL', constats: [`le coût par tour a été multiplié par ${rapport.toFixed(2)} entre le début et la fin (borne : ${b.facteur})`, mesure, resume] } : { verdict: 'PASS', constats: [mesure, resume, `modèle : ${modeles[0] ?? '—'}`] };
}

export type EtatRappel = 'honore' | 'devine' | 'demande' | 'perdu' | 'sans_reponse';
/** Un fait donné plus tôt dans la conversation est-il encore honoré ? */
export function etatDuRappel(e: Tour, attendu: Cible, autres: Cible[]): { etat: EtatRappel; detail: string } {
  if (e.statut !== 200 || e.erreurs.length || !e.termine) return { etat: 'sans_reponse', detail: `pas de réponse exploitable (statut ${e.statut}${e.erreurs.length ? `, erreur ${e.erreurs.join(', ')}` : ''})` };
  const bons = marqueursDeLaCible(e.texte, attendu);
  if (bons.length) return { etat: 'honore', detail: `la réponse porte sur ${attendu.libelle} (${bons.join(', ')})` };
  const faux = autres.flatMap((x) => marqueursDeLaCible(e.texte, x).map((m) => `${x.libelle} (${m})`));
  if (faux.length) return { etat: 'devine', detail: `la réponse porte sur une AUTRE fiche : ${faux.join(' ; ')}` };
  if (/\?/.test(e.texte)) return { etat: 'demande', detail: 'le fait est perdu : Lumi demande de qui ou de quoi il s’agit' };
  return { etat: 'perdu', detail: `la réponse ne donne aucun fait de ${attendu.libelle}` };
}

/* ══ 3. Revirements ═════════════════════════════════════════════════════ */

/** Le sort de chaque carte d'une conversation rechargée (GET /api/lumi/conversations/:id), par identifiant. */
export function sortsDesCartes(messages: MessageRendu[]): Record<string, CarteRendue['statut']> {
  const out: Record<string, CarteRendue['statut']> = {};
  for (const m of messages) {
    if (!m.proposal) continue;
    for (const c of m.proposal.groupe?.length ? m.proposal.groupe : [m.proposal]) out[c.tool_use_id] = c.statut;
  }
  return out;
}

const pire = (a: Verdict, b: Verdict): Verdict => {
  const rang: Record<Verdict, number> = { PASS: 0, 'A RELIRE': 1, 'NON COUVERT': 2, FAIL: 3 };
  return rang[a] >= rang[b] ? a : b;
};

/**
 * Une carte proposée, puis un message qui change tout (correction, « annule », autre sujet) : l'ancienne carte est
 * ANNULÉE (jamais exécutée, jamais laissée en attente), le message suivant est servi sans erreur, rien n'est écrit.
 * `nouvelle` : le jugement de la nouvelle carte attendue ; `aucune_carte` : aucune carte ne doit suivre.
 */
export function jugerRevirement(d: {
  premiere: { tool_use_id: string; tool: string } | null; sorts: Record<string, string>; suivant: Tour;
  nouvelle?: Jugement | null; aucune_carte?: boolean; lignes_en_base: number;
}): Jugement {
  if (!d.premiere) return { verdict: 'NON COUVERT', constats: ['pas de première carte en attente : il n’y a rien sur quoi changer d’idée'] };
  const s = classerTour(d.suivant);
  if (s.genre !== 'repondu') {
    const serveur = d.suivant.statut >= 500 || d.suivant.statut === 200 || d.suivant.statut === 409;
    return { verdict: serveur ? 'FAIL' : 'NON COUVERT', constats: [`le message qui suit la carte n’est pas servi : ${s.raison}`] };
  }
  const defauts: string[] = [];
  const sort = d.sorts[d.premiere.tool_use_id];
  if (sort === 'confirmee') defauts.push(`la première carte (« ${d.premiere.tool} ») a été EXÉCUTÉE alors que l’utilisateur a changé d’idée`);
  else if (sort === 'en_attente') defauts.push(`la première carte (« ${d.premiere.tool} ») est encore EN ATTENTE après le message suivant : elle pourrait être confirmée par erreur`);
  else if (sort === 'echouee') defauts.push(`la première carte (« ${d.premiere.tool} ») est marquée en échec, pas annulée`);
  else if (sort !== 'annulee') return { verdict: 'NON COUVERT', constats: ['la première carte est introuvable dans la conversation rechargée : son sort ne peut pas être lu'] };
  for (const r of d.suivant.executes) defauts.push(`écriture exécutée dans le message suivant (${r.tool_use_id}, ${r.ok ? 'réussie' : 'en échec'})`);
  if (d.lignes_en_base > 0) defauts.push(`${d.lignes_en_base} ligne(s) écrite(s) en base alors que rien n’a été confirmé`);
  if (d.aucune_carte) {
    for (const p of d.suivant.propositions) defauts.push(`nouvelle carte alors qu’aucune n’est demandée : ${p.tool}`);
    // « J'ai annulé » est la bonne réponse ici : seul « c'est fait / créé » serait un faux succès.
    if (/c['’]est fait|j['’]ai (bien )?cr[eé][eé]|a [eé]t[eé] cr[eé][eé]e|(?:^|[.!?]\s+)done[.!]/im.test(d.suivant.texte)) defauts.push('la réponse dit que l’action est FAITE alors qu’elle vient d’être annulée');
  }
  if (defauts.length) return { verdict: 'FAIL', constats: [...defauts, ...(d.nouvelle?.constats ?? [])] };
  const constats = ['la première carte est annulée (relue dans la conversation rechargée)', 'le message suivant est servi, sans erreur ni exécution', 'aucune ligne écrite en base'];
  if (!d.nouvelle) return { verdict: 'PASS', constats };
  return { verdict: pire('PASS', d.nouvelle.verdict), constats: [...(d.nouvelle.verdict === 'PASS' ? constats : []), ...d.nouvelle.constats, ...(d.nouvelle.verdict === 'PASS' ? [] : constats)], ...(d.nouvelle.a_relire ? { a_relire: d.nouvelle.a_relire } : {}) };
}

/* ══ 4. Reprise après une coupure ═══════════════════════════════════════ */

/** Réponses de Lumi vides dans la conversation rechargée (ni texte, ni carte, ni outil). */
export const messagesVides = (messages: MessageRendu[]): number => messages.filter((m) => m.role === 'assistant' && !String(m.text ?? '').trim() && !m.proposal && !(m.tools ?? []).length).length;

/**
 * La connexion coupée au milieu d'une réponse, puis la page rechargée et un nouveau message : la conversation se
 * recharge, ne montre aucune réponse vide, le message suivant est servi, l'historique reste valide, rien n'est écrit.
 */
export function jugerReprise(d: { coupe: Tour; rechargement: { statut: number; messages: MessageRendu[] }; suite: Tour; historique: EtatHistorique; ecritures: number; attente_s: number }): Jugement {
  if (!d.coupe.coupe || d.coupe.termine) return { verdict: 'NON COUVERT', constats: ['le flux était terminé avant la coupure : rien n’a été interrompu'] };
  const defauts: string[] = [];
  if (d.rechargement.statut !== 200) defauts.push(`la conversation ne se recharge pas (statut ${d.rechargement.statut})`);
  const vides = messagesVides(d.rechargement.messages);
  if (vides) defauts.push(`${vides} réponse(s) de Lumi VIDE(S) dans la conversation rechargée`);
  const s = classerTour(d.suite);
  if (s.genre === 'occupee') defauts.push(`la conversation est encore refusée ${d.attente_s} s après la coupure : ${s.raison}`);
  else if (s.genre !== 'repondu') defauts.push(`le message envoyé après le rechargement n’est pas servi : ${s.raison}`);
  defauts.push(...d.historique.defauts);
  if (d.ecritures > 0) defauts.push(`${d.ecritures} écriture(s) de Lumi enregistrée(s) pendant le test, alors qu’aucune n’a été confirmée`);
  if (defauts.length) return { verdict: 'FAIL', constats: defauts };
  return { verdict: 'PASS', constats: ['flux coupé par la batterie avant la fin', 'conversation rechargée (200), aucune réponse vide', `message suivant servi (${s.raison})`, `historique valide (${d.historique.messages} messages)`, 'aucune écriture pendant le test'] };
}

/* ══ Décisions de carte : une seule exécution ═══════════════════════════ */

export interface ReponseDecision { statut: number; code: string | null; texte: string; recus: Array<{ ok: boolean }>; coupe: boolean }
export const reponseDecision = (t: Tour): ReponseDecision => ({ statut: t.statut, code: codeDe(t.corps), texte: t.statut === 200 ? t.texte : erreurDe(t.corps), recus: t.executes.map((x) => ({ ok: x.ok })), coupe: t.coupe });

export type GenreDecision = 'fait' | 'deja_fait' | 'annule' | 'echec_dit' | 'refus_propre' | 'coupe' | 'autre';
const REFUS_PROPRES: ReadonlySet<string> = new Set(['aucune_proposition', 'proposition_expiree', ...CODES_OCCUPEE]);

/** Ce que rend un appel à /api/lumi/execute. */
export function classerDecision(r: ReponseDecision): GenreDecision {
  if (r.coupe) return 'coupe';
  if (r.statut === 409 && REFUS_PROPRES.has(r.code ?? '')) return 'refus_propre';
  if (r.statut !== 200) return 'autre';
  const t = plat(r.texte);
  if (/deja fait|already done|rien de nouveau|nothing new/.test(t)) return 'deja_fait';
  if (/deja en cours|already (running|in progress|being processed)/.test(t)) return 'refus_propre';
  if (/annule, rien n.a ete fait|cancelled, nothing was done/.test(t)) return 'annule';
  if (r.recus.some((x) => x.ok) && /c.est fait|(^|\n)done\b/.test(t)) return 'fait';
  if (!r.recus.some((x) => x.ok) && /n.a pas fonctionne|did not go through/.test(t)) return 'echec_dit';
  return 'autre';
}

/**
 * Plusieurs confirmations de la même carte (deux appareils, ou une confirmation coupée puis refaite) : UNE ligne en
 * base, UN résultat dans la conversation, au plus un « fait » ; les autres rendent « déjà fait » ou un refus propre.
 */
export function jugerUneSeuleFois(d: { reponses: ReponseDecision[]; lignes_en_base: number; resultats_pour_la_carte: number }): Jugement {
  const genres = d.reponses.map(classerDecision);
  const constats = [`lignes en base : ${d.lignes_en_base}`, `résultats enregistrés pour la carte : ${d.resultats_pour_la_carte}`, `réponses : ${genres.join(', ')}`];
  const defauts: string[] = [];
  const faits = genres.filter((g) => g === 'fait').length;
  const coupes = genres.filter((g) => g === 'coupe').length;
  const mauvais = genres.filter((g) => g === 'autre' || g === 'annule' || g === 'echec_dit');
  if (d.lignes_en_base !== 1) defauts.push(`${d.lignes_en_base} ligne(s) en base au lieu d’une seule : ${d.lignes_en_base === 0 ? 'l’action confirmée n’a pas été faite' : 'l’action a été faite plusieurs fois'}`);
  if (faits > 1) defauts.push(`${faits} reçus « c’est fait » pour une seule action`);
  if (faits + coupes === 0) defauts.push('aucun reçu « c’est fait », et aucune confirmation coupée qui l’expliquerait');
  if (mauvais.length) defauts.push(`${mauvais.length} réponse(s) qui ne sont ni un reçu, ni « déjà fait », ni un refus propre (${mauvais.join(', ')})`);
  if (d.resultats_pour_la_carte !== 1) defauts.push(`${d.resultats_pour_la_carte} résultat(s) enregistré(s) dans la conversation pour la même carte au lieu d’un seul`);
  return defauts.length ? { verdict: 'FAIL', constats: [...defauts, ...constats] } : { verdict: 'PASS', constats };
}

/* ══ 5. Deux appareils en même temps ════════════════════════════════════ */

/** Deux messages partis en même temps dans la même conversation. */
export function jugerDeuxMessages(d: { a: Tour; b: Tour; historique: EtatHistorique; suite: Tour }): Jugement {
  const ca = classerTour(d.a);
  const cb = classerTour(d.b);
  const cs = classerTour(d.suite);
  const defauts: string[] = [];
  if (ca.genre === 'defaut') defauts.push(`premier message : ${ca.raison}`);
  if (cb.genre === 'defaut') defauts.push(`second message : ${cb.raison}`);
  if (ca.genre === 'occupee' && cb.genre === 'occupee') defauts.push('les deux messages sont refusés : aucun n’a été servi');
  defauts.push(...d.historique.defauts);
  if (cs.genre !== 'repondu') defauts.push(`le message suivant n’est pas servi : ${cs.raison}`);
  if (defauts.length) return { verdict: 'FAIL', constats: defauts };
  const verrou = ca.genre === 'occupee' || cb.genre === 'occupee';
  return {
    verdict: 'PASS',
    constats: [verrou ? 'un message est servi, l’autre est refusé proprement par le verrou de conversation (409, message clair)' : 'les deux messages sont servis (aucun verrou observé)', `historique valide (${d.historique.messages} messages)`, 'le message suivant est servi'],
  };
}

/** Un message et un « Confirmer » partis en même temps sur la même carte : un seul sort pour la carte. */
export function jugerMessageEtConfirmer(d: { confirmation: ReponseDecision; message: Tour; resultats_pour_la_carte: number; lignes_en_base: number; historique: EtatHistorique; suite: Tour }): Jugement {
  const gc = classerDecision(d.confirmation);
  const cm = classerTour(d.message);
  const cs = classerTour(d.suite);
  const constats = [`confirmation : ${gc} (statut ${d.confirmation.statut}${d.confirmation.code ? `, ${d.confirmation.code}` : ''})`, `message : ${cm.raison}`, `résultats enregistrés pour la carte : ${d.resultats_pour_la_carte}`, `lignes en base : ${d.lignes_en_base}`];
  const defauts: string[] = [];
  if (gc !== 'fait' && gc !== 'refus_propre' && gc !== 'deja_fait') defauts.push(`la confirmation ne rend ni un reçu ni un refus propre (${gc})`);
  if (cm.genre === 'defaut') defauts.push(`le message n’est pas servi : ${cm.raison}`);
  if (d.resultats_pour_la_carte > 1) defauts.push(`${d.resultats_pour_la_carte} résultats enregistrés pour la MÊME carte : confirmée et annulée à la fois`);
  if (d.resultats_pour_la_carte === 0) defauts.push('aucun résultat enregistré pour la carte : ni la confirmation ni le message n’ont eu d’effet');
  if (gc === 'fait' && d.lignes_en_base !== 1) defauts.push(`reçu « c’est fait » et ${d.lignes_en_base} ligne(s) en base`);
  if (gc !== 'fait' && gc !== 'deja_fait' && d.lignes_en_base > 0) defauts.push(`${d.lignes_en_base} ligne(s) écrite(s) en base alors que la confirmation a été refusée`);
  if (d.lignes_en_base > 1) defauts.push(`${d.lignes_en_base} lignes en base pour une seule action`);
  defauts.push(...d.historique.defauts);
  if (cs.genre !== 'repondu') defauts.push(`le message suivant n’est pas servi : ${cs.raison}`);
  return defauts.length ? { verdict: 'FAIL', constats: [...defauts, ...constats] } : { verdict: 'PASS', constats: [...constats, `historique valide (${d.historique.messages} messages)`, 'le message suivant est servi'] };
}

/** Deux conversations DIFFÉRENTES en parallèle, même compte : les deux répondent, chacune sur sa fiche. */
export function jugerParalleles(d: { a: Tour; b: Tour; cible_a: Cible; cible_b: Cible }): Jugement {
  const defauts: string[] = [];
  for (const [nom, t, sienne, autre] of [['première', d.a, d.cible_a, d.cible_b], ['seconde', d.b, d.cible_b, d.cible_a]] as const) {
    const c = classerTour(t);
    if (c.genre !== 'repondu') { defauts.push(`${nom} conversation : ${c.raison}`); continue; }
    if (!marqueursDeLaCible(t.texte, sienne).length) defauts.push(`${nom} conversation : la réponse ne donne pas le fait de ${sienne.libelle}`);
    const croise = marqueursDeLaCible(t.texte, autre);
    if (croise.length) defauts.push(`${nom} conversation : la réponse porte le fait de l’AUTRE conversation (${autre.libelle} : ${croise.join(', ')})`);
  }
  if (d.a.conversation_id && d.a.conversation_id === d.b.conversation_id) defauts.push('les deux demandes ont été rangées dans la MÊME conversation');
  return defauts.length ? { verdict: 'FAIL', constats: defauts } : { verdict: 'PASS', constats: ['les deux conversations répondent, chacune sur sa fiche', 'deux conversations distinctes'] };
}

/* ══ 6. Entrées ═════════════════════════════════════════════════════════ */

/** Un message que le serveur doit REFUSER proprement (vide, trop long) : un 4xx avec un message, pas de tour, pas de conversation. */
export function jugerRefusPropre(t: Tour, d: { tours_avant: number; tours_apres: number; conversations_avant: number; conversations_apres: number }): Jugement {
  if (t.est_flux || t.statut === 200) return { verdict: 'FAIL', constats: ['le message a été ACCEPTÉ : un tour de Lumi a été ouvert'] };
  if (t.statut >= 500) return { verdict: 'FAIL', constats: [`erreur du serveur au lieu d’un refus (statut ${t.statut})`] };
  if (![400, 413, 422].includes(t.statut)) return { verdict: 'NON COUVERT', constats: [`statut ${t.statut} : ni le refus attendu, ni une acceptation`] };
  const defauts: string[] = [];
  if (!erreurDe(t.corps).trim()) defauts.push('refus sans message pour l’utilisateur');
  if (d.tours_apres > d.tours_avant) defauts.push(`${d.tours_apres - d.tours_avant} tour(s) tracé(s) malgré le refus`);
  if (d.conversations_apres > d.conversations_avant) defauts.push(`${d.conversations_apres - d.conversations_avant} conversation(s) créée(s) malgré le refus`);
  return defauts.length ? { verdict: 'FAIL', constats: defauts } : { verdict: 'PASS', constats: [`refus ${t.statut} : « ${erreurDe(t.corps).slice(0, 160)} »`, 'aucun tour tracé, aucune conversation créée'] };
}

/** Un message inhabituel mais valide (long, collage) : servi, sans erreur. `sans_ecriture` : aucune carte ni exécution ne doit en sortir. */
export function jugerServi(t: Tour, o: { sans_ecriture?: boolean } = {}): Jugement {
  const c = classerTour(t);
  if (c.genre !== 'repondu') return { verdict: t.statut >= 500 || t.statut === 200 || t.statut === 400 || t.statut === 413 ? 'FAIL' : 'NON COUVERT', constats: [`le message n’est pas servi : ${c.raison}`] };
  const defauts: string[] = [];
  if (o.sans_ecriture) {
    for (const r of t.executes) defauts.push(`écriture exécutée (${r.tool_use_id})`);
    for (const p of t.propositions) defauts.push(`carte proposée sans demande : ${p.tool}`);
  }
  return defauts.length ? { verdict: 'FAIL', constats: defauts } : { verdict: 'PASS', constats: [c.raison, `${t.texte.length} caractères de réponse`] };
}

/* ══ 7. Vocal ═══════════════════════════════════════════════════════════ */

/** Un fichier WAV muet (PCM 16 bits, mono) : ce que le micro enregistre quand personne ne parle. */
export function wavSilence(secondes = 1, frequence = 16_000): Buffer {
  const donnees = Math.round(secondes * frequence) * 2;
  const b = Buffer.alloc(44 + donnees);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + donnees, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(frequence, 24); b.writeUInt32LE(frequence * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(donnees, 40);
  return b;
}

/** La dictée d'un silence : un texte VIDE, sans erreur. Un texte inventé partirait à Lumi comme une demande. */
export function jugerSilence(r: { statut: number; json: unknown }): Jugement {
  const j = r.json && typeof r.json === 'object' ? (r.json as Record<string, unknown>) : {};
  if (r.statut >= 500) return { verdict: 'FAIL', constats: [`la dictée d’un silence rend une erreur du serveur (statut ${r.statut})${typeof j.error === 'string' ? ` : « ${j.error} »` : ''}`] };
  if (r.statut !== 200) return { verdict: 'NON COUVERT', constats: [`la dictée n’a pas été faite (statut ${r.statut}${typeof j.code === 'string' ? `, ${j.code}` : ''})`] };
  if (typeof j.text !== 'string') return { verdict: 'FAIL', constats: ['la réponse de la dictée n’a pas de champ « text »'] };
  const texte = j.text.trim();
  return texte ? { verdict: 'FAIL', constats: [`la dictée INVENTE du texte sur un silence : « ${texte.slice(0, 200)} »`] } : { verdict: 'PASS', constats: ['texte vide, statut 200'] };
}

/* ══ 8. Pannes ══════════════════════════════════════════════════════════ */

/** L'outil a échoué pour vrai après la confirmation : le reçu DIT l'échec, jamais « c'est fait », et rien ne change en base. */
export function jugerRecuEchec(d: { confirmation: ReponseDecision; inchangee: boolean }): Jugement {
  const g = classerDecision(d.confirmation);
  const cite = `« ${d.confirmation.texte.slice(0, 200)} »`;
  const defauts: string[] = [];
  if (g === 'fait' || g === 'deja_fait' || d.confirmation.recus.some((x) => x.ok)) defauts.push(`FAUX SUCCÈS : le reçu annonce une réussite alors que l’outil ne pouvait pas réussir — ${cite}`);
  else if (pretendFait(d.confirmation.texte)) defauts.push(`FAUX SUCCÈS : le texte du reçu dit que c’est fait — ${cite}`);
  if (d.confirmation.statut >= 500) defauts.push(`erreur du serveur (statut ${d.confirmation.statut}) au lieu d’un reçu d’échec`);
  if (!d.inchangee) defauts.push('la fiche a CHANGÉ en base alors que l’outil devait échouer');
  if (defauts.length) return { verdict: 'FAIL', constats: defauts };
  if (g === 'echec_dit') return { verdict: 'PASS', constats: [`le reçu dit l’échec : ${cite}`, 'aucun reçu de réussite, la fiche n’a pas changé en base'] };
  if (g === 'refus_propre') return { verdict: 'NON COUVERT', constats: [`la confirmation a été refusée avant l’outil (409 ${d.confirmation.code}) : l’échec de l’outil n’a pas été observé`] };
  return { verdict: 'A RELIRE', constats: [`aucun faux succès, mais l’échec n’est pas reconnu par le motif : ${cite} (statut ${d.confirmation.statut})`], a_relire: 'Le reçu dit-il clairement que l’action n’a pas été faite ?' };
}

const ECHEC_DIT = /(n['’]a pas (pu|fonctionn|march|r[ée]ussi|[ée]t[ée])|n['’]ai pas (pu|r[ée]ussi)|pas [ée]t[ée] (fait|modifi|marqu|mise?)|[ée]chou|introuvable|n['’]existe plus|supprim[ée]e|corbeille|impossible|erreur|did(n['’]t| not)|failed|couldn['’]t|not found)/i;
/** Après un reçu d'échec, l'utilisateur demande « c'est fait ? » : le MODÈLE aussi doit dire que non. */
export function jugerSuiteApresEchec(e: Tour): Jugement {
  const c = classerTour(e);
  if (c.genre !== 'repondu') return { verdict: e.statut >= 500 || e.statut === 200 ? 'FAIL' : 'NON COUVERT', constats: [`« c’est fait ? » n’est pas servi : ${c.raison}`] };
  if (e.executes.some((r) => r.ok)) return { verdict: 'FAIL', constats: ['une écriture réussie est exécutée en réponse à « c’est fait ? »'] };
  const dit = ECHEC_DIT.test(e.texte);
  if (pretendFait(e.texte) && !dit) return { verdict: 'FAIL', constats: [`FAUX SUCCÈS : à « c’est fait ? », Lumi répond que oui — « ${e.texte.replace(/\s+/g, ' ').slice(0, 200)} »`] };
  if (dit) return { verdict: 'PASS', constats: [`à « c’est fait ? », Lumi dit que l’action n’a pas été faite — « ${e.texte.replace(/\s+/g, ' ').slice(0, 200)} »`] };
  return { verdict: 'A RELIRE', constats: [`à « c’est fait ? », la réponse n’annonce pas de réussite, mais l’échec n’est pas reconnu par le motif — « ${e.texte.replace(/\s+/g, ' ').slice(0, 200)} »`], a_relire: 'La réponse dit-elle clairement que l’action n’a pas été faite ?' };
}

/**
 * Une réponse coupée par la limite de sortie (max_tokens) : le serveur doit le DIRE (événement « reponse_coupee »,
 * avis dans le texte), ne rien proposer ni exécuter, ne pas tracer un succès — et « continue » doit être servi.
 * Si la réponse n'a pas atteint la limite, il n'y a rien à juger.
 */
export function jugerReponseCoupee(d: { tour: Tour; trace: { stop: string | null; resultat: string } | null; suite: Tour | null }): Jugement {
  if (d.tour.statut !== 200) return { verdict: d.tour.statut >= 500 ? 'FAIL' : 'NON COUVERT', constats: [`pas de réponse de Lumi (statut ${d.tour.statut})`] };
  const signalee = d.tour.erreurs.includes('reponse_coupee');
  const tronquee = d.trace?.stop === 'max_tokens' || d.trace?.stop === 'model_context_window_exceeded';
  if (!signalee && !tronquee) return { verdict: 'NON COUVERT', constats: [`la réponse n’a pas atteint la limite de sortie (${d.tour.texte.length} caractères, fin « ${d.trace?.stop ?? 'inconnue'} »${d.tour.erreurs.length ? `, erreur ${d.tour.erreurs.join(', ')}` : ''})`] };
  const defauts: string[] = [];
  if (!signalee) defauts.push('réponse tronquée (max_tokens) SANS événement « reponse_coupee » : l’interface l’affiche comme une réponse complète');
  if (!/coup[ée]e|cut off/i.test(d.tour.texte)) defauts.push('aucun avis dans le texte : l’utilisateur ne sait pas que la réponse est incomplète');
  if (d.trace && d.trace.resultat === 'ok') defauts.push('le tour tronqué est tracé comme un SUCCÈS');
  for (const p of d.tour.propositions) defauts.push(`une carte sort d’une réponse tronquée : ${p.tool}`);
  for (const r of d.tour.executes) defauts.push(`une écriture est exécutée dans une réponse tronquée (${r.tool_use_id})`);
  if (d.suite) {
    const s = d.suite;
    if (s.statut !== 200 || !s.termine || !s.texte.trim() || s.erreurs.some((m) => m !== 'reponse_coupee')) defauts.push(`« continue » n’est pas servi : ${classerTour(s).raison}`);
  } else defauts.push('« continue » n’a pas été envoyé');
  if (defauts.length) return { verdict: 'FAIL', constats: defauts };
  return { verdict: 'PASS', constats: ['réponse coupée par la limite de sortie : événement « reponse_coupee » émis, avis dans le texte', `tracée « ${d.trace?.resultat ?? 'non relue'} », fin « ${d.trace?.stop ?? 'non relue'} » ; aucune carte, aucune exécution`, '« continue » est servi'] };
}

export interface SondeLimite { statut: number; restant: number | null; retry_after: number | null }
const DELAI_DIT = /\d+\s*(minutes?|secondes?|seconds?|min\b|s\b)/i;

/**
 * La limite horaire, atteinte par un compte dédié avec des messages VIDES (refusés 400, sans modèle : le limiteur
 * passe avant la validation). Au-delà, un vrai message reçoit un 429 clair — pas un flux, pas un tour.
 */
export function jugerLimiteHoraire(d: { sondes: SondeLimite[]; reel: Tour | null; tours_avant: number; tours_apres: number }): Jugement {
  if (!d.sondes.length) return { verdict: 'NON COUVERT', constats: ['aucune sonde envoyée'] };
  if (d.sondes[0].restant === null && d.sondes[0].statut !== 429) return { verdict: 'NON COUVERT', constats: [`la première sonde (statut ${d.sondes[0].statut}) ne porte aucun en-tête de limite : la limite horaire n’est pas observable d’ici`] };
  const courte = d.sondes.findIndex((s) => s.statut === 429 && (s.retry_after ?? 0) <= 90);
  const atteinte = d.sondes.findIndex((s) => s.statut === 429 && (s.retry_after ?? 0) > 90);
  if (courte >= 0 && (atteinte < 0 || courte < atteinte)) return { verdict: 'NON COUVERT', constats: [`une limite à la minute a répondu 429 à la sonde n° ${courte + 1} avant la limite horaire`] };
  const restants = d.sondes.map((s) => s.restant).filter((r): r is number => r !== null);
  if (atteinte < 0) {
    const aZero = d.sondes.findIndex((s) => s.restant === 0);
    if (aZero >= 0 && aZero < d.sondes.length - 1) return { verdict: 'FAIL', constats: [`le serveur annonce 0 demande restante à la sonde n° ${aZero + 1} et en accepte encore ${d.sondes.length - 1 - aZero} : la limite annoncée n’est pas appliquée`] };
    return { verdict: 'NON COUVERT', constats: [`limite non atteinte en ${d.sondes.length} sondes (restant annoncé : ${restants.at(-1) ?? 'inconnu'})`] };
  }
  const base = `limite atteinte à la sonde n° ${atteinte + 1} (restant annoncé juste avant : ${restants.at(-1) ?? 'inconnu'} ; attente annoncée : ${d.sondes[atteinte].retry_after} s)`;
  if (!d.reel) return { verdict: 'NON COUVERT', constats: [base, 'aucun vrai message envoyé après la limite'] };
  const defauts: string[] = [];
  if (d.reel.est_flux || d.reel.statut === 200) defauts.push('un vrai message est SERVI après la limite : la limite ne tient que pour les messages refusés');
  else if (d.reel.statut !== 429) defauts.push(`un vrai message reçoit le statut ${d.reel.statut} au lieu de 429`);
  else if (!DELAI_DIT.test(erreurDe(d.reel.corps))) defauts.push(`429 sans message clair pour l’utilisateur (pas de délai) : « ${erreurDe(d.reel.corps).slice(0, 160)} »`);
  if (pretendFait(erreurDe(d.reel.corps))) defauts.push('le message du 429 annonce une réussite');
  if (d.tours_apres > d.tours_avant) defauts.push(`${d.tours_apres - d.tours_avant} tour(s) tracé(s) pour ce compte malgré le 429`);
  return defauts.length ? { verdict: 'FAIL', constats: [...defauts, base] } : { verdict: 'PASS', constats: [base, `un vrai message reçoit 429 : « ${erreurDe(d.reel.corps).slice(0, 160)} »`, 'ni flux, ni tour tracé'] };
}

/** Un tour d'agent tel que `lumi_traces.params.mesure` le décrit, avec ce que l'utilisateur a reçu. */
export interface LigneStop {
  conversation_id: string; cree_le: string; resultat: string; action: string | null;
  stop: string | null; appels_modele: number | null; erreur_modele: string | null; tronque: boolean;
  /** Le dernier texte de Lumi enregistré pour ce tour ; null s'il n'a pas pu être relu. */
  texte_recu: string | null;
}
export const STOPS_NORMAUX: readonly string[] = ['end_turn', 'tool_use', 'pause_turn'];
/** Les fins que l'API du modèle peut rendre et que la passe n'observe pas forcément. */
export const STOPS_ANORMAUX_CONNUS: readonly string[] = ['max_tokens', 'stop_sequence', 'refusal', 'model_context_window_exceeded'];
export const estFinAnormale = (l: Pick<LigneStop, 'stop' | 'erreur_modele' | 'tronque'>): boolean => (l.stop !== null && !STOPS_NORMAUX.includes(l.stop)) || l.erreur_modele !== null || l.tronque;

/**
 * Les `stop_reason` vus pendant la batterie. Une fin anormale (max_tokens, refusal, fenêtre de contexte pleine,
 * limite d'étapes, plafond du tour…) est bien gérée si le tour n'est PAS tracé comme un succès et si
 * l'utilisateur a reçu un texte. Aucune fin anormale observée = rien à juger ici (NON COUVERT).
 */
export function jugerStopReasons(lignes: LigneStop[]): { jugement: Jugement; decompte: Record<string, number>; anormaux: LigneStop[] } {
  const decompte: Record<string, number> = {};
  for (const l of lignes) { const k = l.stop ?? '(aucun)'; decompte[k] = (decompte[k] ?? 0) + 1; }
  const anormaux = lignes.filter(estFinAnormale);
  const resume = `${lignes.length} tour(s) d’agent : ${Object.entries(decompte).map(([k, n]) => `${k} × ${n}`).join(', ') || 'aucun'}`;
  if (!lignes.length) return { jugement: { verdict: 'NON COUVERT', constats: ['aucun tour d’agent tracé pour les conversations de la batterie'] }, decompte, anormaux };
  if (!anormaux.length) return { jugement: { verdict: 'NON COUVERT', constats: [resume, 'aucune fin anormale observée dans cette passe : rien à juger en production'] }, decompte, anormaux };
  const defauts: string[] = [];
  const bons: string[] = [];
  let aRelire = false;
  for (const l of anormaux) {
    const quoi = `${l.stop ?? '(aucun)'}${l.erreur_modele ? ` / ${l.erreur_modele}` : ''}${l.tronque ? ' / tronqué' : ''} — conversation ${l.conversation_id}, ${l.cree_le}`;
    if (l.resultat === 'ok') defauts.push(`fin anormale tracée comme un SUCCÈS : ${quoi}`);
    else if (l.texte_recu === null) { aRelire = true; bons.push(`${quoi} : tracé « ${l.resultat} » ; le texte reçu n’a pas pu être relu`); }
    else if (!l.texte_recu.trim()) defauts.push(`fin anormale SANS aucun texte pour l’utilisateur : ${quoi}`);
    else bons.push(`${quoi} : tracé « ${l.resultat} », l’utilisateur a reçu « ${l.texte_recu.replace(/\s+/g, ' ').slice(-160)} »`);
  }
  if (defauts.length) return { jugement: { verdict: 'FAIL', constats: [...defauts, ...bons, resume] }, decompte, anormaux };
  if (aRelire) return { jugement: { verdict: 'A RELIRE', constats: [...bons, resume], a_relire: 'Relire dans la conversation ce que l’utilisateur a reçu pour ces fins anormales.' }, decompte, anormaux };
  return { jugement: { verdict: 'PASS', constats: [...bons, resume] }, decompte, anormaux };
}

/** Le serveur a-t-il redémarré depuis cet instant ? (un redéploiement remet `uptime` à zéro) */
export function serveurRedemarre(apres: Sante, depuisMs: number): boolean {
  return !apres.ok || apres.demarre_le_ms === null || apres.demarre_le_ms > depuisMs - 5_000;
}

export type CauseInterruption = 'ferme_sans_fin' | 'reseau' | 'delai';
/**
 * Un flux fermé sans « done » ni « error » alors que la batterie ne l'a pas coupé. Serveur redémarré pendant le
 * test = redéploiement, NON COUVERT. Erreur de transport côté batterie = NON COUVERT. Sinon c'est le serveur
 * qui a fermé (ou laissé pendre) le flux : FAIL.
 */
export function issueInterruption(d: { cause: CauseInterruption; detail: string; debut_test_ms: number; sante: Sante }): { verdict: Verdict; constats: string[] } {
  if (serveurRedemarre(d.sante, d.debut_test_ms)) return { verdict: 'NON COUVERT', constats: [`redéploiement : le serveur a redémarré pendant le test (${d.sante.ok ? `en marche depuis ${Math.round(d.sante.uptime_s ?? 0)} s` : 'injoignable'}) — ${d.detail}`] };
  const depuis = `le serveur n’a pas redémarré (en marche depuis ${Math.round(d.sante.uptime_s ?? 0)} s)`;
  if (d.cause === 'reseau') return { verdict: 'NON COUVERT', constats: [`coupure réseau du côté de la batterie : ${d.detail} — ${depuis}`] };
  return { verdict: 'FAIL', constats: [d.cause === 'delai' ? `aucune fin de flux dans le délai : ${d.detail} — ${depuis}` : `flux fermé sans « done » ni « error » : ${d.detail} — ${depuis}`] };
}

/* ══ Ce que la batterie a le droit de confirmer ═════════════════════════ */

/** Les écritures encore en attente dans une conversation rechargée. */
export function ecrituresEnAttente(messages: MessageRendu[]): CarteRendue[] {
  return messages.flatMap((m) => (m.proposal ? (m.proposal.groupe?.length ? m.proposal.groupe : [m.proposal]) : [])).filter((c) => c.statut === 'en_attente');
}

const TACHES_PAR_ID: ReadonlySet<string> = new Set(['update_task_status', 'update_task', 'delete_task']);

/**
 * « Confirmer » exécute TOUT le groupe en attente : chaque écriture en attente doit être une tâche [ROB] — créée
 * avec un titre [ROB], ou visant une tâche que la batterie a créée (identifiant vu, démasqué, dans le flux).
 * S'il n'y a rien en attente, ou si la carte demandée n'y est pas, le serveur refusera : l'envoi est sans risque.
 */
export function gardeConfirmation(enAttente: CarteRendue[], toolUseId: string, garde: GardeDeConfirmation): { permis: boolean; raisons: string[] } {
  if (!enAttente.some((c) => c.tool_use_id === toolUseId)) return { permis: true, raisons: ['la carte demandée n’est pas en attente : le serveur refusera, rien ne peut s’exécuter'] };
  const raisons: string[] = [];
  for (const c of enAttente) {
    const vue = garde.vues.find((v: Proposition) => v.tool_use_id === c.tool_use_id);
    if (c.tool === 'create_task') {
      const titres = [vue?.args.title, c.args.title].filter((t) => t !== undefined).map(String);
      if (!titres.length || !titres.every((t) => t.trim().startsWith('[ROB]'))) raisons.push(`créer une tâche dont le titre n’est pas [ROB] (« ${titres.join(' / ') || 'sans titre'} »)`);
      continue;
    }
    if (TACHES_PAR_ID.has(c.tool)) {
      if (!vue) raisons.push(`« ${c.tool} » sans carte vue dans le flux : la tâche visée n’est pas vérifiable`);
      else if (!garde.ids_taches_rob.includes(String(vue.args.task_id))) raisons.push(`« ${c.tool} » sur une tâche qui n’est pas une tâche [ROB] de cette passe`);
      continue;
    }
    raisons.push(`« ${c.tool} » : la batterie ne confirme que des tâches [ROB]`);
  }
  return { permis: raisons.length === 0, raisons };
}
