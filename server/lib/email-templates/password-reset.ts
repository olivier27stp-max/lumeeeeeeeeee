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
 * la vérification d'adresse. Même gabarit visuel que le courriel de bienvenue.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const LOGO_URL = 'https://lumecrm.net/lume-logo-v2.png';

function enveloppe(corps: string): string {
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ffffff;">
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;max-width:500px;margin:0 auto;padding:40px 20px;">
    <img src="${LOGO_URL}" alt="Lume" style="height:34px;width:auto;display:block;margin:0 0 26px;" />
    ${corps}
  </div>
</body></html>`;
}

function bouton(href: string, libelle: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;margin-top:22px;padding:14px 32px;background:#111;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;letter-spacing:0.5px;">${libelle}</a>`;
}

const P = 'font-size:14px;color:#555;line-height:1.6;margin:0 0 14px;';
const PETIT = 'font-size:12px;color:#999;margin-top:30px;line-height:1.6;';

export interface PasswordResetEmailData {
  /** Prénom du destinataire ; vide si inconnu. */
  name: string;
  /** Lien complet vers /reset-password?token=…&email=… */
  resetUrl: string;
  /** Durée de validité, en minutes, pour l'afficher au client. */
  expiresInMinutes: number;
}

export function renderPasswordResetEmail(data: PasswordResetEmailData): string {
  const salutation = data.name ? `Salut <strong>${escapeHtml(data.name)}</strong>,` : 'Salut,';
  return enveloppe(`
    <p style="${P}">${salutation}</p>
    <p style="${P}">
      Tu as demandé à choisir un nouveau mot de passe pour ton compte Lume.
      Clique sur le bouton ci-dessous : tu pourras ensuite te connecter avec
      ton courriel et ce mot de passe, même si tu avais créé ton compte avec Google.
    </p>
    ${bouton(data.resetUrl, 'Choisir mon mot de passe')}
    <p style="${PETIT}">
      Ce lien expire dans ${data.expiresInMinutes} minutes et ne sert qu'une fois.
      Si tu n'as rien demandé, ignore simplement ce courriel : ton mot de passe
      actuel reste inchangé.
    </p>
  `);
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
  const salutation = data.name ? `Salut <strong>${escapeHtml(data.name)}</strong>,` : 'Salut,';
  const explication = data.hasPassword
    ? `Tu peux te connecter avec ton courriel et ton mot de passe. Si tu l'as oublié,
       le lien « Mot de passe oublié » sur la page de connexion t'en fera choisir un nouveau.`
    : `Ce compte a été créé avec Google : connecte-toi avec le bouton Google, ou
       clique « Mot de passe oublié » sur la page de connexion pour te choisir un
       mot de passe et ne plus dépendre de Google.`;
  return enveloppe(`
    <p style="${P}">${salutation}</p>
    <p style="${P}">
      Quelqu'un — probablement toi — vient d'essayer de créer un compte Lume avec
      cette adresse. Bonne nouvelle : tu en as déjà un.
    </p>
    <p style="${P}">${explication}</p>
    ${bouton(`${app}/auth`, 'Me connecter')}
    <p style="${PETIT}">
      Si ce n'était pas toi, tu n'as rien à faire : personne ne peut accéder à
      ton compte sans ton mot de passe ou ton compte Google.
    </p>
  `);
}
