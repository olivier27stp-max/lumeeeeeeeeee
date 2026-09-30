/**
 * Les gabarits des courriels que Supabase Auth envoie lui-même, au gabarit
 * Lume (français, tutoiement). Les variables Go de Supabase
 * ({{ .ConfirmationURL }}, {{ .Token }}, {{ .Email }}, {{ .NewEmail }})
 * restent telles quelles : Supabase les remplit à l'envoi.
 * Posés dans la configuration Auth par scripts/courriels/gabarits-auth-supabase.mts.
 */
import { rendreCourrielLume } from './gabarit';

const note = 'Si tu n’es pas à l’origine de cette demande, ignore simplement ce courriel : rien ne change sans ton clic.';
export const GABARITS_AUTH: Record<string, { sujet: string; html: string }> = {
  confirmation: {
    sujet: 'Confirme ton adresse courriel',
    html: rendreCourrielLume({
      langue: 'fr', titre: 'Plus qu’un clic',
      preheader: 'Confirme ton adresse pour activer ton compte Lume.',
      intro: 'Confirme ton adresse courriel pour activer ton compte Lume.',
      bouton: { texte: 'Confirmer mon adresse', url: '{{ .ConfirmationURL }}' }, note,
    }),
  },
  email_change: {
    sujet: 'Confirme ta nouvelle adresse courriel',
    html: rendreCourrielLume({
      langue: 'fr', titre: 'Changement d’adresse',
      preheader: 'Une confirmation avant de changer l’adresse de ton compte Lume.',
      intro: 'Tu as demandé à remplacer {{ .Email }} par {{ .NewEmail }} pour te connecter à Lume. Confirme ce changement :',
      bouton: { texte: 'Confirmer le changement', url: '{{ .ConfirmationURL }}' }, note,
    }),
  },
  invite: {
    sujet: 'Ton invitation à Lume',
    html: rendreCourrielLume({
      langue: 'fr', titre: 'Bienvenue dans l’équipe',
      preheader: 'Crée ton accès à Lume en un clic.',
      intro: 'Une équipe t’invite à la rejoindre sur Lume. Clique sur le bouton pour créer ton accès.',
      bouton: { texte: 'Accepter l’invitation', url: '{{ .ConfirmationURL }}' }, note,
    }),
  },
  magic_link: {
    sujet: 'Ton lien de connexion à Lume',
    html: rendreCourrielLume({
      langue: 'fr', titre: 'Connexion en un clic',
      preheader: 'Ton lien pour te connecter à Lume, valable une seule fois.',
      intro: 'Voici ton lien pour te connecter à Lume. Il ne fonctionne qu’une seule fois.',
      bouton: { texte: 'Me connecter', url: '{{ .ConfirmationURL }}' }, note,
    }),
  },
  reauthentication: {
    sujet: 'Ton code de confirmation Lume',
    html: rendreCourrielLume({
      langue: 'fr', titre: 'Ton code',
      preheader: 'Le code à saisir dans Lume : {{ .Token }}',
      intro: 'Saisis ce code dans Lume pour confirmer que c’est bien toi :',
      corpsHtml: '<p style="margin:0;font-size:28px;font-weight:700;letter-spacing:6px;text-align:center;">{{ .Token }}</p>',
      note,
    }),
  },
  recovery: {
    sujet: 'Choisis un nouveau mot de passe Lume',
    html: rendreCourrielLume({
      langue: 'fr', titre: 'Nouveau mot de passe',
      preheader: 'Le lien pour choisir un nouveau mot de passe.',
      intro: 'Tu as demandé à changer ton mot de passe Lume. Clique sur le bouton pour en choisir un nouveau.',
      bouton: { texte: 'Choisir mon mot de passe', url: '{{ .ConfirmationURL }}' }, note,
    }),
  },
};

