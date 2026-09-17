/**
 * Courriels du parcours « compte » : confirmation d'adresse, bienvenue après
 * confirmation, bienvenue après paiement. Rendus par le gabarit commun (voix
 * Lume, server/lib/courriels/gabarit.ts) — aucun HTML maison ici.
 *
 * Bienvenue — envoyé une fois, après confirmation de l'adresse.
 * POURQUOI : après avoir cliqué le lien de vérification, le client arrivait
 * dans un espace vide sans rien recevoir. C'est pourtant le moment où il a le
 * plus besoin d'être guidé, et le seul où on est certain qu'il lit ses
 * courriels (il vient d'en ouvrir un).
 *
 * Volontairement PAS un message de remerciement : chaque courriel sans contenu
 * utile entraîne l'habitude de ne plus les ouvrir, et le jour où on envoie
 * quelque chose d'important il passe à la trappe. Celui-ci dit quoi faire.
 *
 * La plupart des clients de messagerie masquent les images distantes tant que
 * le destinataire ne clique pas « afficher les images » : le texte doit donc
 * rester compréhensible sans le logo — c'est le cas, l'objet et la première
 * ligne suffisent.
 */
import { rendreCourrielLume, echapper } from '../courriels/gabarit';

function salut(name: string): string {
  return name ? `Salut ${name},` : 'Salut,';
}

export interface VerificationEmailData {
  /** Prénom du destinataire ; vide si inconnu. */
  name: string;
  /** Lien complet de confirmation (/verify-email?token=…). */
  verifyUrl: string;
  /** Durée de validité, en heures, pour l'afficher au client. */
  expiresInHours: number;
}

/** Confirmation d'inscription : le seul bouton active l'espace de travail. */
export function renderVerificationEmail(data: VerificationEmailData): string {
  return rendreCourrielLume({
    langue: 'fr',
    preheader: 'Un clic pour confirmer ton adresse et activer ton espace de travail.',
    titre: 'Confirme ton compte',
    salutation: salut(data.name),
    intro: 'Merci d’avoir créé ton compte. Clique sur le bouton pour confirmer ton adresse courriel et activer ton espace de travail.',
    bouton: { texte: 'Confirmer mon compte', url: data.verifyUrl },
    note: `Ce lien expire dans ${data.expiresInHours} heures. Si tu n’as pas créé de compte, ignore simplement ce courriel.`,
  });
}

export interface WelcomeEmailData {
  /** Prénom du destinataire ; vide si inconnu — la salutation s'adapte. */
  name: string;
  /** Racine de l'application (FRONTEND_URL). */
  appUrl: string;
  /** Adresse à laquelle le client peut répondre. */
  supportEmail: string;
}

const ETAPES: ReadonlyArray<{ titre: string; texte: string }> = [
  { titre: 'Importe tes clients.', texte: 'Depuis la page Clients, un fichier CSV suffit : le nom et un moyen de contact par ligne.' },
  { titre: 'Complète les infos de ton entreprise.', texte: 'Logo, adresse et couleur apparaissent sur tes soumissions et tes factures.' },
  { titre: 'Envoie ta première soumission.', texte: 'C’est le meilleur moyen de voir le parcours complet, jusqu’au paiement en ligne.' },
];

/** Les trois étapes, numérotées — le seul contenu libre du courriel, entièrement échappé. */
function etapesHtml(): string {
  return ETAPES.map((e, i) => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"${i ? ' style="border-top:1px solid #e5e7eb;"' : ''}>
<tr>
<td width="30" valign="top" style="padding:12px 0;"><div style="width:20px;height:20px;border-radius:50%;background:#111827;color:#ffffff;font-size:11px;font-weight:700;line-height:20px;text-align:center;">${i + 1}</div></td>
<td style="padding:12px 0;font-size:14px;line-height:1.55;color:#374151;"><strong style="color:#111827;">${echapper(e.titre)}</strong> ${echapper(e.texte)}</td>
</tr>
</table>`).join('');
}

export function renderWelcomeEmail(data: WelcomeEmailData): string {
  const app = data.appUrl.replace(/\/$/, '');
  return rendreCourrielLume({
    langue: 'fr',
    preheader: 'Ton espace est prêt. Trois choses à faire en premier — compte une quinzaine de minutes.',
    titre: 'Bienvenue dans Lume',
    salutation: salut(data.name),
    intro: 'Ton compte est confirmé et ton espace de travail est prêt. Voici les trois choses à faire en premier — compte une quinzaine de minutes.',
    corpsHtml: etapesHtml(),
    bouton: { texte: 'Ouvrir mon espace', url: app },
    note: 'Une question ? Réponds simplement à ce courriel — c’est une vraie personne qui lit. Tu peux aussi utiliser le bouton d’aide, en bas à droite dans l’application.',
    supportEmail: data.supportEmail || null,
  });
}

export interface CheckoutWelcomeEmailData {
  /** Nom du forfait payé (« Pro », « Croissance »…). */
  planName: string;
  /** Lien durable vers la page de configuration (/checkout/success?session_id=…). */
  setupUrl: string;
}

/**
 * Après paiement d'un lien de checkout, pour un compte qui n'a pas encore de
 * mot de passe : un lien durable vers la page de configuration, au cas où
 * l'onglet a été fermé.
 */
export function renderCheckoutWelcomeEmail(data: CheckoutWelcomeEmailData): string {
  return rendreCourrielLume({
    langue: 'fr',
    preheader: `Ton abonnement ${data.planName} est actif. Une dernière étape : configure ton compte.`,
    titre: 'Paiement confirmé — configure ton compte',
    salutation: 'Salut,',
    intro: `Ton abonnement ${data.planName} est actif. Il te reste une étape : créer ton mot de passe et remplir les infos de ton entreprise pour commencer à travailler.`,
    lignes: [{ libelle: 'Forfait', valeur: data.planName, fort: true }],
    bouton: { texte: 'Configurer mon compte', url: data.setupUrl },
    note: 'Garde ce courriel : le lien te ramène à la configuration si tu as fermé l’onglet.',
  });
}
