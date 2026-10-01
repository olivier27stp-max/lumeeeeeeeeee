/**
 * Un texte dicté entre guillemets ne part pas AVEC ses guillemets (2026-10-01).
 * ─────────────────────────────────────────────────────────────────────────
 * « Texte à Sophie : « Bonjour Sophie, on arrive vers 13 h. » » : mesuré en prod, le
 * modèle recopiait les guillemets dans le texto. Ils délimitent le message, ils n'en
 * font pas partie. Seuls les champs de texte libre sont touchés, et seulement quand la
 * valeur ENTIÈRE est entourée d'une seule paire (un texte qui cite un mot au milieu,
 * ou qui contient deux citations, est laissé tel quel).
 * Appliqué au même endroit pour la carte et pour l'exécution : ce qui est montré est ce qui part.
 */
const CHAMPS_TEXTE_LIBRE = /^(message|message_text|body|sms_body|email_body|text|note|notes|content|subject|description)$/;
const PAIRES_GUILLEMETS: Array<[string, string]> = [['«', '»'], ['“', '”'], ['"', '"'], ['‘', '’'], ["'", "'"]];

export function sansGuillemetsEnglobants(texte: string): string {
  const t = texte.trim();
  for (const [o, f] of PAIRES_GUILLEMETS) {
    if (t.length < 3 || !t.startsWith(o) || !t.endsWith(f)) continue;
    const dedans = t.slice(o.length, t.length - f.length);
    if (!dedans.trim() || dedans.includes(o) || dedans.includes(f)) return texte;
    return dedans.trim();
  }
  return texte;
}

/**
 * Les mots que la dictée coupe en deux (2026-10-01, éval en prod, cas devis-17).
 * « Les sous missions acceptées, c'est lesquelles ? » : la reconnaissance vocale écrit
 * « sous mission(s) » pour « soumission(s) », et Lumi répondait sur les « items optionnels »
 * au lieu des soumissions. Aucune phrase d'une entreprise de services ne dit « sous mission »
 * pour autre chose : on recolle, sans toucher à la casse du premier mot ni au reste.
 * Appliqué à la transcription (ce que la personne voit dans le champ) et au message reçu.
 */
export function recollerDictee(texte: string): string {
  return texte.replace(/(?<![\p{L}\p{N}])(s)ous[\s-]+missions?(?![\p{L}\p{N}])/giu, (tout, s: string) => `${s}oumission${/s$/i.test(tout) ? 's' : ''}`);
}

export function nettoyerTexteDicte<T>(valeur: T, cle = ''): T {
  if (typeof valeur === 'string') return (CHAMPS_TEXTE_LIBRE.test(cle) ? sansGuillemetsEnglobants(valeur) : valeur) as unknown as T;
  if (Array.isArray(valeur)) return valeur.map((v) => nettoyerTexteDicte(v, cle)) as unknown as T;
  if (valeur && typeof valeur === 'object') return Object.fromEntries(Object.entries(valeur as Record<string, unknown>).map(([k, v]) => [k, nettoyerTexteDicte(v, k)])) as T;
  return valeur;
}
