/**
 * Qui voit la page « télécharger l'application », et qui ne la voit jamais.
 *
 * LE PIÈGE QUE CE FICHIER EXISTE POUR ÉVITER
 * lumecrm.net sert DEUX publics avec le même domaine :
 *   · nos utilisateurs — entrepreneurs et employés qui viennent travailler
 *     dans le CRM. Sur téléphone, on les envoie vers l'application ;
 *   · LEURS clients — qui reçoivent par texto un lien vers une soumission, un
 *     contrat à signer, une facture à payer. Ces gens ouvrent forcément le
 *     lien sur leur téléphone, n'ont aucun compte Lume, et n'installeront
 *     jamais notre application.
 *
 * Bloquer le second groupe ferait perdre des contrats à nos utilisateurs : un
 * client qui ne peut pas signer sa soumission ne signe pas. C'est la
 * fonctionnalité qui rapporte de l'argent, et elle vit entièrement sur mobile.
 */

/**
 * Chemins publics, toujours servis normalement — y compris sur téléphone.
 *
 * Cette liste double `detectTokenKind` de src/routes/TokenRoutes.tsx. Les deux
 * sont vérifiées ensemble par les tests : ajouter une route publique sans
 * l'inscrire ici fait échouer la suite, avant que le lien ne parte à un client.
 */
export const CHEMINS_PUBLICS = [
  '/quote/',     // soumission envoyée par texto ou courriel
  '/contract/',  // contrat à signer
  '/survey/',    // sondage après intervention
  '/portal/',    // portail client
  '/pay/',       // paiement de facture
  '/invite/',    // invitation d'un employé — souvent ouverte au téléphone
  '/form/',      // formulaire public de demande de soumission
  '/checkout',   // parcours d'abonnement, y compris /checkout/success
  '/privacy',    // obligations légales : joignables partout, toujours
  '/terms',
  '/subprocessors',
] as const;

/** Le chemin doit-il rester accessible sur mobile ? */
export function estCheminPublic(pathname: string): boolean {
  return CHEMINS_PUBLICS.some((p) => pathname === p || pathname.startsWith(p));
}

/**
 * Vrai téléphone, par opposition à une fenêtre de navigateur rétrécie.
 *
 * Les deux critères sont exigés ensemble, et c'est délibéré :
 *   · le seul `userAgent` classerait un iPad comme téléphone, alors que le CRM
 *     y est parfaitement utilisable en paysage ;
 *   · la seule largeur sortirait du CRM quelqu'un qui réduit sa fenêtre sur un
 *     ordinateur — comportement absurde et très frustrant.
 *
 * 768 px est le seuil `md` de Tailwind, celui-là même sur lequel les mises en
 * page du CRM sont construites : en dessous, elles ne se dégradent pas, elles
 * cassent.
 */
export function estTelephone(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  // `iPad` est volontairement absent : une tablette reste un poste de travail.
  const uaTelephone = /iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry/i.test(ua);
  return uaTelephone && window.innerWidth < 768;
}

/** Faut-il afficher la page « télécharger l'application » ? */
export function afficherPorteMobile(pathname: string): boolean {
  if (estCheminPublic(pathname)) return false;
  return estTelephone();
}
