/**
 * Quelles routes l'application rend-elle SANS session ?
 *
 * Quand la session tombe (jeton de rafraîchissement expiré ou révoqué,
 * déconnexion dans un autre onglet, fin du délai d'inactivité), le routeur
 * reste sur la route protégée que l'utilisateur occupait — /jobs, /day… —
 * alors que l'app, déconnectée, n'affiche plus que <PublicRoutes />, dont seul
 * le catch-all attrape cette route : « 404 — Page introuvable ». Cette liste
 * sert à décider si une déconnexion doit ramener à l'accueil.
 *
 * Elle double les routes déclarées dans src/routes/PublicRoutes.tsx et les
 * pages publiques rendues directement par App.tsx ; les pages par jeton
 * (soumission, contrat, paiement…) viennent de CHEMINS_PUBLICS. Les tests
 * croisent cette liste avec le fichier de routes : ajouter une route publique
 * sans l'inscrire ici fait échouer la suite.
 */
import { estCheminPublic } from './mobileGate';

export const ROUTES_SANS_SESSION = [
  '/',
  '/auth',           // connexion (+ /auth/callback)
  '/register',
  '/reset-password',
  '/verify-email',
  '/oauth/consent',
  '/apercu-mobile',
  '/features',       // pages marketing
  '/solutions',
  '/industries',     // + /industries/:slug
  '/pricing',
  '/contact',
] as const;

/** La route est-elle affichable sans être connecté ? */
export function rendueSansSession(pathname: string): boolean {
  if (estCheminPublic(pathname)) return true;
  return ROUTES_SANS_SESSION.some(
    (p) => pathname === p || (p !== '/' && pathname.startsWith(p + '/')),
  );
}
