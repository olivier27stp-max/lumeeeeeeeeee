/**
 * Courriels du parcours « mot de passe » — envoyés par NOTRE mailer, pas par
 * Supabase.
 *
 * POURQUOI ne pas utiliser `resetPasswordForEmail` de Supabase :
 *   1. Le lien Supabase (flux PKCE) n'est échangeable que dans le navigateur
 *      qui l'a demandé — ouvert depuis le téléphone, il échoue en silence.
 *   2. Sans SMTP personnalisé, Supabase plafonne à 2 courriels/heure pour
 *      tout le projet : le deuxième client qui oublie son mot de passe dans
 *      l'heure ne reçoit rien.
 *   3. L'URL de retour doit figurer dans la liste blanche du projet ; en prod
 *      elle n'y était pas, et le client atterrissait sur l'accueil sans aucun
 *      formulaire pour choisir un nouveau mot de passe.
 * Le jeton vit dans les métadonnées de l'utilisateur (haché), comme celui de
 * la vérification d'adresse. Rendu par le gabarit commun (voix Lume,
 * server/lib/courriels/gabarit.ts) — aucun HTML maison ici.
 */
import { rendreCourrielLume } from '../courriels/gabarit';

function salut(name: string): string {
  return name ? `Salut ${name},` : 'Salut,';
}

export interface PasswordResetEmailData {
  /** Prénom du destinataire ; vide si inconnu. */
  name: string;
  /** Lien complet vers /reset-password?token=…&email=… */
  resetUrl: string;
  /** Durée de validité, en minutes, pour l'afficher au client. */
  expiresInMinutes: number;
}

export function renderPasswordResetEmail(data: PasswordResetEmailData): string {
  return rendreCourrielLume({
    langue: 'fr',
    preheader: `Ton lien est valide ${data.expiresInMinutes} minutes et ne sert qu’une fois.`,
    titre: 'Choisis un nouveau mot de passe',
    salutation: salut(data.name),
    intro: 'Tu as demandé à choisir un nouveau mot de passe pour ton compte Lume. Clique sur le bouton : tu pourras ensuite te connecter avec ton courriel et ce mot de passe, même si tu avais créé ton compte avec Google.',
    bouton: { texte: 'Choisir mon mot de passe', url: data.resetUrl },
    note: `Ce lien expire dans ${data.expiresInMinutes} minutes et ne sert qu’une fois. Si tu n’as rien demandé, ignore simplement ce courriel : ton mot de passe actuel reste inchangé.`,
  });
}

export interface AccountExistsEmailData {
  name: string;
  /** Racine de l'application (FRONTEND_URL). */
  appUrl: string;
  /** Le compte a-t-il déjà un mot de passe ? Sinon, il a été créé avec Google. */
  hasPassword: boolean;
}

/**
 * Envoyé quand quelqu'un tente de s'inscrire avec un courriel déjà rattaché à
 * un compte confirmé. La réponse HTTP reste identique à une inscription
 * réussie (aucune énumération d'adresses) ; c'est ce courriel qui explique au
 * vrai propriétaire de la boîte quoi faire, au lieu d'attendre une confirmation
 * qui n'arrivera jamais.
 */
export function renderAccountExistsEmail(data: AccountExistsEmailData): string {
  const app = data.appUrl.replace(/\/$/, '');
  const explication = data.hasPassword
    ? 'Tu peux te connecter avec ton courriel et ton mot de passe. Si tu l’as oublié, le lien « Mot de passe oublié » sur la page de connexion t’en fera choisir un nouveau.'
    : 'Ce compte a été créé avec Google : connecte-toi avec le bouton Google, ou clique « Mot de passe oublié » sur la page de connexion pour te choisir un mot de passe et ne plus dépendre de Google.';
  return rendreCourrielLume({
    langue: 'fr',
    preheader: 'Bonne nouvelle : tu as déjà un compte. Connecte-toi.',
    titre: 'Tu as déjà un compte Lume',
    salutation: salut(data.name),
    intro: `Quelqu’un — probablement toi — vient d’essayer de créer un compte Lume avec cette adresse. Bonne nouvelle : tu en as déjà un. ${explication}`,
    bouton: { texte: 'Me connecter', url: `${app}/auth` },
    note: 'Si ce n’était pas toi, tu n’as rien à faire : personne ne peut accéder à ton compte sans ton mot de passe ou ton compte Google.',
  });
}
