/**
 * Version texte d'un courriel HTML, pour l'envoi (2026-09-17).
 * ───────────────────────────────────────────────────────────
 * Un courriel qui part en HTML seul est un signal de pourriel pour Gmail et
 * Outlook (« multipart/alternative » attendu). Le mailer dérive donc, à chaque
 * envoi sans `text` explicite, une partie texte de son HTML.
 *
 * Le HTML visé est celui du gabarit (server/lib/courriels/gabarit.ts) : des
 * tableaux imbriqués, du CSS en ligne, un pré-en-tête caché en `display:none`.
 * Règles :
 *   - le pré-en-tête caché, le <head>, les styles et scripts disparaissent ;
 *   - un rang de tableau à deux cellules (libellé / valeur) devient
 *     « Libellé : valeur » ; à une cellule, son texte ;
 *   - un lien devient « Libellé : https://… », ou l'adresse seule quand le
 *     libellé EST l'adresse (lien de secours, mailto, tel) ;
 *   - le paragraphe « Le bouton ne fonctionne pas ? Copiez ce lien » est omis :
 *     la ligne du bouton porte déjà l'adresse ;
 *   - une image devient son texte alternatif (le logo → le nom de l'entreprise) ;
 *   - blocs (p, h1…, div, li, tr) = une ligne ; paragraphes séparés d'une
 *     ligne vide ; entités décodées UNE fois, à la fin (un « &lt;b&gt; » saisi
 *     par un utilisateur reste « <b> » dans le texte, il n'est pas pris pour
 *     une balise) ; aucune balise ne survit.
 *
 * Pure, sans dépendance à src/ (frontière serveur/client — voir
 * tests/frontiere-serveur-client.test.ts). Testée : tests/courriels/texte.test.ts.
 */

const ENTITES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', copy: '©', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', ecirc: 'ê', ocirc: 'ô', ucirc: 'û', icirc: 'î', acirc: 'â',
};

export function decoderEntites(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => codePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => codePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (tout, nom: string) => ENTITES[nom.toLowerCase()] ?? tout);
}

function codePoint(n: number): string {
  // Espace de largeur nulle (bourrage du pré-en-tête) : rien à lire.
  if (!Number.isFinite(n) || n === 0x200b || n === 0xfeff) return '';
  try { return String.fromCodePoint(n); } catch { return ''; }
}

function nettoyerLigne(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

const SCHEMA_CONTACT = /^(mailto|tel|sms):/i;

/**
 * Texte d'un lien : « Libellé : url », ou l'adresse seule si le libellé la
 * répète. Reçoit et rend du texte encore encodé (entités) : href et libellé
 * viennent du même `echapper`, la comparaison reste juste.
 */
export function texteDeLien(href: string, libelle: string): string {
  const url = href.trim();
  const texte = nettoyerLigne(libelle.replace(/<[^>]+>/g, ' '));
  if (!url) return texte;
  const affiche = SCHEMA_CONTACT.test(url) ? url.replace(SCHEMA_CONTACT, '') : url;
  // « 514 555-0199 » et « tel:5145550199 » sont le MÊME numéro : la ponctuation
  // du libellé ne doit pas produire « 514 555-0199 : 5145550199 ». On compare
  // les chiffres seuls pour un lien téléphone.
  const memeNumero = /^tel:/i.test(url)
    && texte.replace(/\D/g, '') !== ''
    && texte.replace(/\D/g, '') === affiche.replace(/\D/g, '');
  const identiques = !texte || texte === url || texte === affiche || memeNumero;
  // Sur un numéro, on garde la forme lisible du libellé (« 514 555-0199 »)
  // plutôt que la suite de chiffres du lien.
  if (memeNumero) return texte;
  return identiques ? affiche : `${texte} : ${affiche}`;
}

const PARAGRAPHE_DE_SECOURS = /^(Le bouton ne fonctionne pas|Button not working)/i;

/**
 * HTML sans tableau → texte. Chaque bloc devient une ligne ; `<p>`, titres et
 * listes sont suivis d'une ligne vide. `decoder` = false pour un passage
 * intermédiaire (cellule de tableau) : les entités ne se décodent qu'à la fin.
 */
function texteInline(html: string, decoder: boolean): string {
  let t = html;
  t = t.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (tout, corps: string) => (PARAGRAPHE_DE_SECOURS.test(nettoyerLigne(decoderEntites(corps.replace(/<[^>]+>/g, ' ')))) ? '' : tout));
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<li\b[^>]*>/gi, '- ');
  // Un bloc se termine par une ligne ; un paragraphe, un titre ou une liste par une ligne vide.
  t = t.replace(/<\/(p|h[1-6]|ul|ol|table)>/gi, '\n\n');
  t = t.replace(/<\/(div|li|tr|td|th)>/gi, '\n');
  t = t.replace(/<(ul|ol|table)\b[^>]*>/gi, '\n');
  t = t.replace(/<(p|h[1-6]|div|tr|td|th)\b[^>]*>/gi, '');
  t = t.replace(/<a\b[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, libelle: string) => texteDeLien(href, libelle));
  t = t.replace(/<a\b[^>]*href\s*=\s*'([^']*)'[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, libelle: string) => texteDeLien(href, libelle));
  t = t.replace(/<img\b[^>]*\balt\s*=\s*"([^"]*)"[^>]*>/gi, ' $1 ');
  t = t.replace(/<img\b[^>]*>/gi, ' ');
  t = t.replace(/<[^>]+>/g, '');
  if (decoder) t = decoderEntites(t);
  return t
    .split('\n')
    .map(nettoyerLigne)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Un <tr> qui ne contient ni tableau ni rang imbriqué : le plus profond.
const RANG_INTERNE = /<tr\b[^>]*>((?:(?!<tr\b|<table\b)[\s\S])*?)<\/tr>/i;
// Un <table> qui n'a plus de rang ni de tableau à l'intérieur (déjà aplati).
const TABLE_VIDE = /<table\b[^>]*>((?:(?!<tr\b|<table\b)[\s\S])*?)<\/table>/i;
const CELLULE = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;

function aplatirRang(interieur: string): string {
  const cellules = Array.from(interieur.matchAll(CELLULE)).map((m) => texteInline(m[1], false)).filter(Boolean);
  if (cellules.length === 0) return '';
  // Libellé / valeur : les rangs de détail restent groupés ; tout autre rang forme son propre bloc.
  if (cellules.length === 2 && !cellules[0].includes('\n') && !cellules[1].includes('\n')) return `${cellules[0]} : ${cellules[1]}\n`;
  return `${cellules.join('\n')}\n\n`;
}

/** HTML d'un courriel (gabarit ou libre) → texte lisible, pour la partie `text` de l'envoi. */
export function htmlVersTextePourEnvoi(html: string): string {
  if (!html) return '';
  let t = html;
  t = t.replace(/<!--[\s\S]*?-->/g, '');
  t = t.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '');
  t = t.replace(/<(style|script|title)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Pré-en-tête et tout élément caché.
  t = t.replace(/<(div|span|p)\b[^>]*display\s*:\s*none[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Les retours à la ligne du gabarit entre deux balises ne sont pas du texte.
  t = t.replace(/>\s*\n\s*</g, '><');

  // Tableaux imbriqués : on aplatit du plus profond vers l'extérieur.
  for (let i = 0; i < 500; i++) {
    const rang = RANG_INTERNE.exec(t);
    if (rang) { t = `${t.slice(0, rang.index)}${aplatirRang(rang[1])}${t.slice(rang.index + rang[0].length)}`; continue; }
    const table = TABLE_VIDE.exec(t);
    if (table) { t = `${t.slice(0, table.index)}${table[1]}\n${t.slice(table.index + table[0].length)}`; continue; }
    break;
  }
  return texteInline(t, true);
}
