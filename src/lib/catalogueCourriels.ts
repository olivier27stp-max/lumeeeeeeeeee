/* ═══════════════════════════════════════════════════════════════
   Le catalogue des courriels qu'une entreprise envoie à SES clients.

   Une seule liste, rangée par moment du cycle de vie plutôt que par table
   technique : le propriétaire cherche « le courriel de facture », pas
   « invoice_sent dans email_templates ».

   Deux origines derrière ces entrées, invisibles pour lui :
     • PARCOURS — déclenchés par un geste (envoyer une facture) ou par le cron
       des rappels. Ils passent par le gabarit commun côté serveur.
     • AUTOMATISATION — les règles de /automations. Leur texte vit dans la
       règle elle-même ; la page les pointe vers leur éditeur existant plutôt
       que de déplacer des textes que des entreprises ont déjà personnalisés.

   `type` correspond à `email_templates.type` pour les entrées du parcours ;
   les automatisations n'en ont pas (leur texte n'est pas dans cette table).

   Le compte : 26 automatisations (vérifiées une à une dans
   automationPresets.data.ts) et 10 postes du parcours. Un poste n'apparaît
   ici QUE si un envoi existe vraiment derrière : lister un courriel qu'on ne
   peut pas modifier parce qu'il ne part jamais serait une promesse creuse.
   ═══════════════════════════════════════════════════════════════ */

export type OrigineCourriel = 'parcours' | 'automatisation';

export interface EntreeCourriel {
  /** `email_templates.type` — absent pour une automatisation. */
  type?: string;
  /** Ce que le propriétaire lit dans la liste. */
  titre: { fr: string; en: string };
  /** Quand ce courriel part, en une phrase. */
  quand: { fr: string; en: string };
  origine: OrigineCourriel;
  /** Combien de variantes ce poste regroupe (relances échelonnées). */
  variantes?: number;
  /**
   * La phrase que le serveur envoie quand l'entreprise n'a rien écrit.
   * L'éditeur s'en sert comme point de départ : sans elle, ouvrir « Envoi de
   * la facture » pour corriger un mot montrait une page blanche, et il fallait
   * tout réécrire. Miroir des `intro` de server/routes/emails.ts — les deux se
   * croisent dans tests/courriels/catalogue-courriels.test.ts.
   */
  texteOrigine?: { fr: string; en: string };
  /**
   * L'objet par défaut, en gabarit. Le serveur le compose avec des valeurs
   * calculées, donc il est réécrit ici avec les variables correspondantes :
   * c'est la forme que l'entreprise voit, modifie, et que `applyTemplate`
   * remplit à l'envoi. Sans lui, le champ Objet s'ouvrait VIDE et personne ne
   * savait ce qu'il remplaçait.
   */
  objetOrigine?: { fr: string; en: string };
}

export interface GroupeCourriels {
  cle: string;
  titre: { fr: string; en: string };
  entrees: EntreeCourriel[];
}

export const CATALOGUE_COURRIELS: GroupeCourriels[] = [
  {
    cle: 'demande',
    titre: { fr: 'Une demande arrive', en: 'A request comes in' },
    entrees: [
      {
        origine: 'automatisation',
        titre: { fr: 'Accusé de réception', en: 'Request acknowledged' },
        quand: { fr: 'Dès qu’un client remplit votre formulaire', en: 'As soon as a client fills your form' },
      },
      {
        origine: 'automatisation',
        variantes: 3,
        titre: { fr: 'Relances de prospect', en: 'Lead follow-ups' },
        quand: { fr: 'Si la demande reste sans suite', en: 'When a request goes quiet' },
      },
    ],
  },
  {
    cle: 'soumission',
    titre: { fr: 'La soumission', en: 'The quote' },
    entrees: [
      {
        type: 'quote_sent',
        origine: 'parcours',
        titre: { fr: 'Envoi de la soumission', en: 'Quote sent' },
        quand: { fr: 'Quand vous envoyez une soumission', en: 'When you send a quote' },
        objetOrigine: {
          fr: 'Soumission [quote_number] — [quote_amount]',
          en: 'Quote [quote_number] — [quote_amount]',
        },
        texteOrigine: {
          fr: 'Voici notre proposition pour vos travaux. Le détail est ci-dessous ; approuvez-la quand vous êtes prêt.',
          en: 'Here is our proposal for your work. The details are below — approve it when you are ready.',
        },
      },
      {
        origine: 'automatisation',
        titre: { fr: 'Soumission acceptée', en: 'Quote accepted' },
        quand: { fr: 'Quand le client accepte', en: 'When the client accepts' },
      },
      {
        origine: 'automatisation',
        variantes: 5,
        titre: { fr: 'Relances de soumission', en: 'Quote follow-ups' },
        quand: { fr: 'De 3 à 30 jours sans réponse', en: 'From 3 to 30 days without an answer' },
      },
      {
        origine: 'automatisation',
        titre: { fr: 'Suivi de devis', en: 'Estimate follow-up' },
        quand: { fr: 'Après l’envoi d’un devis', en: 'After an estimate goes out' },
      },
    ],
  },
  {
    cle: 'contrat',
    titre: { fr: 'Le contrat', en: 'The contract' },
    entrees: [
      {
        type: 'contract_sent',
        origine: 'parcours',
        titre: { fr: 'Contrat à signer', en: 'Contract to sign' },
        quand: { fr: 'Quand vous envoyez un contrat', en: 'When you send a contract' },
        objetOrigine: {
          fr: 'Contrat [contract_number] — à signer',
          en: 'Contract [contract_number] — to sign',
        },
        texteOrigine: {
          fr: 'Voici votre contrat. Vous pouvez le consulter et le signer en ligne, sur votre téléphone ou votre ordinateur.',
          en: 'Here is your contract. You can review and sign it online, on your phone or computer.',
        },
      },
      {
        origine: 'automatisation',
        titre: { fr: 'Contrat signé', en: 'Contract signed' },
        quand: { fr: 'Dès que le client a signé', en: 'As soon as the client signs' },
      },
    ],
  },
  {
    cle: 'rendezvous',
    titre: { fr: 'Le rendez-vous', en: 'The appointment' },
    entrees: [
      {
        origine: 'automatisation',
        titre: { fr: 'Rendez-vous confirmé', en: 'Appointment confirmed' },
        quand: { fr: 'Quand la date est fixée', en: 'When the date is set' },
      },
      {
        origine: 'automatisation',
        titre: { fr: 'Rappel de rendez-vous', en: 'Appointment reminder' },
        quand: { fr: 'La veille de la visite', en: 'The day before the visit' },
      },
      {
        origine: 'automatisation',
        variantes: 3,
        titre: { fr: 'Rappels automatiques', en: 'Automatic reminders' },
        quand: { fr: 'À la prise de rendez-vous, une semaine avant, puis la veille', en: 'On booking, a week before, then the day before' },
      },
    ],
  },
  {
    cle: 'argent',
    titre: { fr: 'L’argent', en: 'Money' },
    entrees: [
      {
        type: 'deposit_request',
        origine: 'parcours',
        titre: { fr: 'Demande de dépôt', en: 'Deposit request' },
        quand: { fr: 'Pour réserver une date à l’horaire', en: 'To hold a date on the schedule' },
        objetOrigine: {
          fr: 'Dépôt de [amount_due] — facture [invoice_number]',
          en: '[amount_due] due — invoice [invoice_number]',
        },
        texteOrigine: {
          fr: 'Ce dépôt réserve votre date à l’horaire. Dès qu’il est reçu, la date est à vous.',
          en: 'This deposit holds your spot in the schedule. As soon as it is received, the date is yours.',
        },
      },
      {
        type: 'invoice_sent',
        origine: 'parcours',
        titre: { fr: 'Envoi de la facture', en: 'Invoice sent' },
        quand: { fr: 'Quand vous envoyez une facture', en: 'When you send an invoice' },
        objetOrigine: {
          fr: 'Facture [invoice_number] — [invoice_amount]',
          en: 'Invoice [invoice_number] — [invoice_amount]',
        },
        texteOrigine: {
          fr: 'Les travaux sont terminés — merci de votre confiance. Voici votre facture, détail ci-dessous.',
          en: 'The work is done — thank you for your trust. Here is your invoice, details below.',
        },
      },
      {
        type: 'invoice_reminder',
        origine: 'parcours',
        titre: { fr: 'Rappel de paiement', en: 'Payment reminder' },
        quand: { fr: 'Selon votre calendrier de relance', en: 'On your reminder schedule' },
        objetOrigine: {
          fr: 'Facture [invoice_number] — il reste [amount_due]',
          en: 'Invoice [invoice_number] — [amount_due] outstanding',
        },
        texteOrigine: {
          fr: 'Un petit rappel, sans plus : la facture [invoice_number] de [amount_due] était due le [due_date]. Si le paiement est déjà parti, ce message le croise — merci !',
          en: 'A gentle reminder: invoice {invoice_number} for {amount_due} was due on {due_date}. If your payment is already on its way, this message crossed it — thank you!',
        },
      },
      {
        origine: 'automatisation',
        titre: { fr: 'Reçu de paiement', en: 'Payment receipt' },
        quand: { fr: 'Dès qu’un paiement entre', en: 'As soon as a payment lands' },
      },
      {
        origine: 'automatisation',
        variantes: 5,
        titre: { fr: 'Relances de facture', en: 'Invoice follow-ups' },
        quand: { fr: 'De 1 à 30 jours après l’échéance', en: 'From 1 to 30 days past due' },
      },
      {
        origine: 'automatisation',
        variantes: 3,
        titre: { fr: 'Dépôt demandé et reçu', en: 'Deposit requested and received' },
        quand: { fr: 'Après l’acceptation d’une soumission', en: 'After a quote is accepted' },
      },
    ],
  },
  {
    cle: 'apres',
    titre: { fr: 'Après les travaux', en: 'After the job' },
    entrees: [
      {
        origine: 'automatisation',
        titre: { fr: 'Demande d’avis', en: 'Review request' },
        quand: { fr: 'Après une job terminée', en: 'After a completed job' },
      },
      {
        origine: 'automatisation',
        variantes: 4,
        titre: { fr: 'Fidélisation', en: 'Staying in touch' },
        quand: { fr: 'À 1 mois, 3 mois, 1 an, et avant la saison', en: 'At 1 month, 3 months, 1 year, and before the season' },
      },
    ],
  },
];

/** Les types du parcours, dans l'ordre de la page — utile aux tests. */
export const TYPES_PARCOURS: string[] = CATALOGUE_COURRIELS
  .flatMap((g) => g.entrees)
  .map((e) => e.type)
  .filter((t): t is string => Boolean(t));

/** Combien de courriels ce catalogue couvre réellement, variantes comprises. */
export function nombreDeCourriels(): number {
  return CATALOGUE_COURRIELS
    .flatMap((g) => g.entrees)
    .reduce((n, e) => n + (e.variantes ?? 1), 0);
}
