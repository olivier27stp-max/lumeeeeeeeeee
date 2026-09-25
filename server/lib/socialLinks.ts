/* Réseaux sociaux (company_settings.social_links) côté serveur — miroir
   minimal de src/lib/socialLinks.ts (la frontière serveur/client interdit
   de partager le module). Clés fermées : tout le reste est ignoré. */

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

/** Ne garde que les clés connues portant une URL http(s) — jamais de javascript:. */
export function lireLiensSociaux(brut: unknown): SocialLinks {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return {};
  const liens: SocialLinks = {};
  for (const reseau of RESEAUX) {
    const v = (brut as Record<string, unknown>)[reseau];
    if (typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim())) liens[reseau] = v.trim();
  }
  return liens;
}
