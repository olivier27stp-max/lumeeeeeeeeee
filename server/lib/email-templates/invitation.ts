/**
 * Invitation à rejoindre une entreprise sur Lume (et son rappel).
 *
 * C'est LUME qui écrit au futur membre — pas l'entreprise : rendu par le
 * gabarit Lume (server/lib/courriels/gabarit.ts), en français, au tutoiement.
 * Le nom affiché de l'entreprise vient de company_settings quand il existe.
 */
import { rendreCourrielLume } from '../courriels/gabarit';
import { premierObjetQuiTient } from '../courriels/garde-envoi';

const ROLE_LABELS: Record<string, string> = {
  owner: 'Propriétaire',
  admin: 'Administrateur',
  sales_rep: 'Représentant',
  technician: 'Technicien',
};

/** Durée de vie du jeton, alignée sur `expires_at` dans server/routes/invitations.ts (Loi 25). */
const EXPIRATION_HEURES = 48;

export interface InvitationEmailInput {
  orgName: string;
  role: string;
  inviteLink: string;
  inviterName?: string | null;
  branding?: {
    logo_url?: string | null;
    primary_color?: string | null;
    company_name?: string | null;
    website?: string | null;
  } | null;
  /** Relance d'une invitation restée sans réponse : l'objet commence par « Rappel : ». */
  rappel?: boolean;
}

/** « Marie Tremblay » → « Marie » ; vide si inconnu. */
function prenomDe(nom: string | null | undefined): string {
  return String(nom || '').trim().split(/\s+/)[0] || '';
}

export function renderInvitationEmail(input: InvitationEmailInput): { subject: string; html: string; text: string } {
  const entreprise = String(input.branding?.company_name || input.orgName || '').trim() || 'une entreprise';
  const role = ROLE_LABELS[input.role] || input.role;
  const prenom = prenomDe(input.inviterName);
  const invitant = prenom || 'Un membre de l’équipe';

  // ≤ 60 caractères : un nom d'entreprise long raccourcit la formule, jamais l'objet coupé en plein mot.
  const rappel = input.rappel ? 'Rappel : ' : '';
  const subject = premierObjetQuiTient([
    `${rappel}${invitant} t’invite à rejoindre ${entreprise} sur Lume`,
    `${rappel}Rejoins ${entreprise} sur Lume`,
    `${rappel}${invitant} t’invite à rejoindre son équipe sur Lume`,
    `${rappel}Invitation à rejoindre une équipe sur Lume`,
  ]);
  const intro = `${invitant} t’invite à rejoindre l’équipe de ${entreprise} sur Lume. Clique sur le bouton pour créer ton accès et commencer à travailler avec eux.`;
  const note = `Cette invitation expire dans ${EXPIRATION_HEURES} heures. Si tu ne l’attendais pas, ignore simplement ce courriel.`;

  const html = rendreCourrielLume({
    langue: 'fr',
    preheader: `Rôle : ${role}. L’invitation expire dans ${EXPIRATION_HEURES} heures.`,
    titre: `Rejoins ${entreprise} sur Lume`,
    salutation: 'Salut,',
    intro,
    lignes: [
      { libelle: 'Entreprise', valeur: entreprise, fort: true },
      { libelle: 'Rôle', valeur: role },
      ...(input.inviterName ? [{ libelle: 'Invité par', valeur: String(input.inviterName) }] : []),
    ],
    bouton: { texte: 'Accepter l’invitation', url: input.inviteLink },
    note,
  });

  const text = `${intro}

Entreprise : ${entreprise}
Rôle : ${role}${input.inviterName ? `\nInvité par : ${input.inviterName}` : ''}

Accepter l’invitation : ${input.inviteLink}

${note}

— L’équipe Lume`;

  return { subject, html, text };
}
