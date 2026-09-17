/* ═══════════════════════════════════════════════════════════════
   Réseaux sociaux de l'entreprise — company_settings.social_links.

   Un jsonb {clé → URL}. Les clés sont fermées (RESEAUX) : tout le
   reste est ignoré à la lecture comme à l'écriture, donc une valeur
   inattendue en base ne casse jamais l'affichage.
   ═══════════════════════════════════════════════════════════════ */

export const RESEAUX = ['facebook', 'x', 'instagram', 'yelp', 'angi', 'google_business'] as const;
export type Reseau = (typeof RESEAUX)[number];
export type SocialLinks = Partial<Record<Reseau, string>>;

export const RESEAU_LABEL: Record<Reseau, string> = {
  facebook: 'Facebook',
  x: 'X',
  instagram: 'Instagram',
  yelp: 'Yelp',
  angi: 'Angi',
  google_business: 'Google',
};

/** Ne garde que les clés connues portant une chaîne non vide. */
export function lireLiensSociaux(brut: unknown): SocialLinks {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return {};
  const liens: SocialLinks = {};
  for (const reseau of RESEAUX) {
    const v = (brut as Record<string, unknown>)[reseau];
    if (typeof v === 'string' && v.trim()) liens[reseau] = v.trim();
  }
  return liens;
}

/**
 * Tolère « instagram.com/xyz » → « https://instagram.com/xyz ».
 * Renvoie null si, même préfixée, la valeur n'est pas une URL http(s).
 */
export function normaliserUrlSociale(valeur: string): string | null {
  let url = valeur.trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!/^[^\s.]+\.\S{2,}$/.test(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Liste ordonnée des réseaux renseignés — pour les pieds de page. */
export function reseauxRenseignes(liens: SocialLinks | null | undefined): Array<{ reseau: Reseau; url: string; label: string }> {
  const propres = lireLiensSociaux(liens);
  return RESEAUX
    .filter((r) => propres[r])
    .map((r) => ({ reseau: r, url: propres[r] as string, label: RESEAU_LABEL[r] }));
}
