/**
 * Exemples — famille « compte et équipe » : ce que LUME envoie à ses abonnés
 * (confirmation, compte existant, bienvenue, mot de passe, paiement du checkout,
 * invitation et son rappel). Données inventées, aucune base.
 * Les mêmes fonctions que les routes (server/lib/email-templates/*).
 */
import type { Exemple } from './clients.mts';
import { renderVerificationEmail, renderWelcomeEmail, renderCheckoutWelcomeEmail } from '../../../server/lib/email-templates/welcome';
import { renderPasswordResetEmail, renderAccountExistsEmail } from '../../../server/lib/email-templates/password-reset';
import { renderInvitationEmail } from '../../../server/lib/email-templates/invitation';

const app = 'https://lumecrm.net';
const de = 'Lume';

const invitation = renderInvitationEmail({
  orgName: 'Vision Lavage',
  role: 'technician',
  inviteLink: `${app}/invite/exemple-jeton`,
  inviterName: 'Marie Tremblay',
  branding: { company_name: 'Vision Lavage', logo_url: null, primary_color: '#0f766e', website: 'https://visionlavage.ca' },
});

export const EXEMPLES: Exemple[] = [
  { nom: 'compte-confirmation', de, sujet: 'Confirme ton compte Lume', html: renderVerificationEmail({ name: 'Rafba', verifyUrl: `${app}/verify-email?token=exemple&email=rafba%40exemple.ca`, expiresInHours: 24 }) },
  { nom: 'compte-existant', de, sujet: 'Tu as déjà un compte Lume', html: renderAccountExistsEmail({ name: 'Rafba', appUrl: app, hasPassword: false }) },
  { nom: 'compte-bienvenue', de, sujet: 'Bienvenue dans Lume — par où commencer', html: renderWelcomeEmail({ name: 'Rafba', appUrl: app, supportEmail: 'support@lumecrm.net' }) },
  { nom: 'compte-mot-de-passe', de, sujet: 'Choisis un nouveau mot de passe Lume', html: renderPasswordResetEmail({ name: 'Rafba', resetUrl: `${app}/reset-password?token=exemple&email=rafba%40exemple.ca`, expiresInMinutes: 60 }) },
  { nom: 'compte-checkout-bienvenue', de, sujet: 'Bienvenue chez Lume — configure ton compte', html: renderCheckoutWelcomeEmail({ planName: 'Pro', setupUrl: `${app}/checkout/success?session_id=cs_test_exemple` }) },
  { nom: 'compte-invitation', de, sujet: invitation.subject, html: invitation.html },
  { nom: 'compte-invitation-rappel', de, sujet: `Rappel : ${invitation.subject}`, html: invitation.html },
];
