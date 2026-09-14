/**
 * Traduction des erreurs du moteur d'automatisations en français lisible.
 *
 * Les actions produisent des messages techniques en anglais (« No recipient
 * phone », « SMTP not configured », « Frequency cap reached for +1514… »).
 * Ils sont utiles dans les journaux, illisibles pour l'entrepreneur — et
 * c'est lui qu'on prévient quand une relance n'est pas partie (F22, T10.3).
 *
 * JUMEAU CÔTÉ NAVIGATEUR : `src/lib/automationErreurs.ts` porte le même
 * dictionnaire (la frontière serveur/client interdit l'import croisé). Le test
 * `tests/automation/erreurs-dictionnaire-parite.test.ts` vérifie que les deux
 * listes de motifs restent identiques.
 */
export const DICTIONNAIRE_ERREURS: Array<{ motif: RegExp; fr: string }> = [
  { motif: /no recipient phone|has no phone number/i, fr: 'Le client n’a pas de numéro de téléphone.' },
  { motif: /no recipient email|has no email address/i, fr: 'Le client n’a pas d’adresse courriel.' },
  { motif: /smtp not configured/i, fr: 'L’envoi de courriels n’est pas configuré sur la plateforme.' },
  { motif: /twilio not configured/i, fr: 'L’envoi de SMS n’est pas configuré sur la plateforme.' },
  { motif: /opted out/i, fr: 'Le client a demandé de ne plus recevoir de SMS (STOP).' },
  { motif: /has unsubscribed/i, fr: 'Le client s’est désabonné des courriels.' },
  { motif: /frequency cap/i, fr: 'Plafond de messages atteint pour ce client (trop de relances en 24 h).' },
  { motif: /daily cap|plafond quotidien/i, fr: 'Plafond quotidien d’envois de votre forfait atteint.' },
  { motif: /plan does not include/i, fr: 'Votre forfait n’inclut pas les SMS.' },
  { motif: /no sms number provisioned/i, fr: 'Aucun numéro SMS n’est attribué à votre entreprise.' },
  { motif: /consent/i, fr: 'Le client n’a pas consenti aux communications commerciales.' },
  { motif: /review requests are disabled/i, fr: 'Les demandes d’avis sont désactivées dans vos réglages.' },
  { motif: /no google or facebook review link/i, fr: 'Aucun lien d’avis Google ou Facebook n’est configuré.' },
  { motif: /already sent to this client/i, fr: 'Une demande d’avis a déjà été envoyée à ce client cette semaine.' },
  { motif: /timed out/i, fr: 'Le fournisseur d’envoi n’a pas répondu à temps.' },
  { motif: /règle désactivée/i, fr: 'L’automatisation a été désactivée avant l’envoi.' },
  { motif: /no org owner/i, fr: 'Aucun propriétaire trouvé pour attribuer la tâche.' },
];

/** Phrase en français pour un `result_error` du moteur. Jamais le texte brut seul. */
export function traduireErreurAutomatisation(erreur: string | null | undefined): string {
  if (!erreur) return 'Envoi impossible, cause inconnue.';
  const trouve = DICTIONNAIRE_ERREURS.find((e) => e.motif.test(erreur));
  if (trouve) return trouve.fr;
  // Inconnue : on garde une phrase française devant, le détail technique
  // tronqué derrière pour le diagnostic.
  return `Envoi impossible (détail technique : ${erreur.slice(0, 120)}).`;
}
