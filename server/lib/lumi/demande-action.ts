/**
 * Une demande d'ACTION ne reçoit jamais une réponse d'aide toute faite
 * (audit des outils de Lumi, 2026-09-30).
 * ─────────────────────────────────────────────────────────────────────────
 * L'étage « aide » (FAQ, articles) répond au premier message sans modèle, sur
 * des mots-clés. Mesuré par l'éval des outils : « Configure mes taxes pour le
 * Québec » recevait « Paramètres → Taxes : Ajouter une région… », « Remets les
 * permissions de Karim par défaut » recevait la marche à suivre du mot de
 * passe oublié, « Supprime le modèle de soumission X » la description d'un
 * modèle. L'utilisateur demandait à Lumi de FAIRE ; on lui expliquait comment
 * faire lui-même — et parfois autre chose.
 *
 * Règle : une question (« comment », « où », « how », « c'est quoi »…) peut
 * recevoir l'aide ; un ordre (verbe d'action en tête, « peux-tu … »,
 * « can you … ») va au modèle, qui a les outils.
 */

const QUESTION = /^(comment|où|ou est|pourquoi|c['’]est quoi|qu['’]est-ce|quel(le)?s?|est-ce que je peux|puis-je|how|where|why|what|which|is there|can i|do i|does)\b/i;

const VERBES_FR = [
  'supprime', 'efface', 'enlève', 'enleve', 'retire', 'envoie', 'renvoie', 'texte', 'textes', 'écris', 'ecris', 'crée', 'cree', 'créer', 'ajoute',
  'mets', 'met', 'marque', 'rembourse', 'annule', 'change', 'modifie', 'passe', 'déplace', 'deplace', 'planifie', 'replanifie', 'assigne',
  'remets', 'active', 'désactive', 'desactive', 'configure', 'duplique', 'archive', 'désarchive', 'facture', 'relance', 'fusionne',
  'invite', 'réinvite', 'réactive', 'reactive', 'révoque', 'revoque', 'approuve', 'monte', 'baisse', 'programme', 'lance', 'arrête',
  'arrete', 'génère', 'genere', 'convertis', 'transforme', 'traite', 'note', 'prends', 'prélève', 'preleve', 'charge', 'paie', 'paye',
  'publie', 'renomme', 'fais', 'prépare', 'prepare', 'bloque', 'débloque', 'ouvre', 'ferme', 'termine', 'démarre', 'demarre', 'pointe',
  'oublie', 'retiens', 'garde', 'souviens-toi', 'rappelle-toi', 'enregistre', 'inscris', 'ajuste', 'corrige', 'remplace', 'vide', 'range',
  'sors', 'coche', 'décoche', 'decoche', 'rédige', 'redige', 'déplanifie', 'deplanifie',
];
const VERBES_EN = [
  'delete', 'remove', 'send', 'resend', 'text', 'email', 'create', 'add', 'set', 'mark', 'refund', 'cancel', 'change', 'update', 'move',
  'schedule', 'reschedule', 'assign', 'reset', 'enable', 'disable', 'turn', 'configure', 'duplicate', 'archive', 'unarchive', 'invoice',
  'bill', 'merge', 'invite', 'reactivate', 'revoke', 'approve', 'raise', 'lower', 'run', 'generate', 'convert', 'stop', 'charge', 'pay',
  'publish', 'rename', 'make', 'prepare', 'void', 'record', 'log', 'clock', 'start', 'end', 'close', 'open', 'book', 'put',
  'forget', 'remember', 'keep', 'save', 'fix', 'replace', 'adjust', 'note down', 'write down',
  'tick', 'untick', 'check off', 'uncheck', 'draft', 'take', 'unschedule', 'pause', 'resume', 'apply', 'reorder', 'reorganize', 'optimize', 'optimise',
];
const DEBUT_POLI = /^(s['’]il te pla[iî]t|stp|svp|please|pls|peux-tu|tu peux|pourrais-tu|est-ce que tu peux|can you|could you|would you|go ahead and|j['’]aimerais que tu|je veux que tu|i want you to|i need you to)\s+/i;

// « Le client m'a payé la facture n° 1 », « Sophie a accepté la soumission » : aucun impératif,
// mais l'utilisateur rapporte un fait pour que Lumi mette la fiche à jour. Trouvé en prod le
// 2026-10-01 : la FAQ répondait « la facture apparaît comme en retard… ».
const EVENEMENT = /\b(?:m['’]a|nous a|m['’]ont|nous ont|a|ont)\s+(?:d[ée]j[aà]\s+)?(?:pay[ée]e?s?|r[ée]gl[ée]e?s?|accept[ée]e?s?|refus[ée]e?s?|annul[ée]e?s?|sign[ée]e?s?|confirm[ée]e?s?|dit (?:oui|non))(?![\p{L}\p{N}])|\b(?:paid|accepted|declined|approved|signed|cancell?ed|confirmed)\b[^.?!]{0,40}\b(?:invoice|quote|estimate|job|contract|me)\b/iu;
// (?![\p{L}]) et non \b : en JavaScript, \b ne voit pas la fin d'un mot qui se termine par « é ».

const VERBE = new RegExp(`^(${[...VERBES_FR, ...VERBES_EN].map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');

export function estDemandeDAction(message: string): boolean {
  const t = String(message || '').trim().replace(/^[«"'“(\s]+/, '').replace(/^(ok|bon|alors|so|hey|salut|allo|allô|lumi)[,!\s]+/i, '');
  if (QUESTION.test(t)) return false;
  if (EVENEMENT.test(t)) return true;
  // Chaque proposition : « Robert est en double, fusionne les deux fiches » — l'ordre suit la virgule.
  return t.split(/[,;:.!\n]+|\s[—–-]\s/).map((c) => c.trim().replace(DEBUT_POLI, '')).some((c) => VERBE.test(c));
}
