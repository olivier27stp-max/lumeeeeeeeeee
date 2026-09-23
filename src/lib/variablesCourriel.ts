/* ═══════════════════════════════════════════════════════════════
   Les variables qu'une entreprise peut insérer dans SES courriels.

   Une seule liste, PAR TYPE de courriel, parce que le serveur ne remplit pas
   les mêmes selon l'envoi : une facture connaît `invoice_amount` et
   `payment_link`, une soumission connaît `quote_amount` et `quote_link`, un
   rappel connaît `amount_due` et `pay_url`.

   Pourquoi ce fichier existe : l'éditeur proposait `invoice_total`, que le
   serveur ne remplit nulle part. Une entreprise qui l'insérait voyait un trou
   dans le courriel reçu par son client — sans erreur, sans avertissement. Les
   deux listes vivaient à des endroits différents et avaient dérivé.

   Toute variable listée ici DOIT être passée à `texteDuCourriel` par la route
   correspondante. `tests/courriels/variables-courriel.test.ts` croise les deux
   et casse si elles divergent.
   ═══════════════════════════════════════════════════════════════ */

export interface VariableCourriel {
  /** La clé écrite entre accolades : {invoice_number}. */
  cle: string;
  fr: string;
  en: string;
  /** Ce que le propriétaire verra dans l'aperçu, à la place de la variable. */
  exemple: { fr: string; en: string };
}

/** Les trois variables que TOUS les courriels connaissent. */
const COMMUNES: VariableCourriel[] = [
  {
    cle: 'client_name',
    fr: 'Nom du client',
    en: 'Client name',
    exemple: { fr: 'Sophie Tremblay', en: 'Sophie Tremblay' },
  },
  {
    cle: 'company_name',
    fr: 'Votre entreprise',
    en: 'Your company',
    exemple: { fr: 'Coquin lavage', en: 'Coquin lavage' },
  },
];

/**
 * Par type de courriel, ce que le serveur remplit vraiment.
 * Relevé dans server/routes/emails.ts et server/routes/reminders-cron.ts.
 */
export const VARIABLES_PAR_TYPE: Record<string, VariableCourriel[]> = {
  invoice_sent: [
    ...COMMUNES,
    { cle: 'invoice_number', fr: 'N° de facture', en: 'Invoice #', exemple: { fr: '48', en: '48' } },
    { cle: 'invoice_amount', fr: 'Montant', en: 'Amount', exemple: { fr: '1 220,17 $', en: '$1,220.17' } },
    { cle: 'due_date', fr: 'Échéance', en: 'Due date', exemple: { fr: '24 avril 2026', en: 'April 24, 2026' } },
    { cle: 'payment_link', fr: 'Lien de paiement', en: 'Payment link', exemple: { fr: 'lumecrm.net/pay/…', en: 'lumecrm.net/pay/…' } },
  ],
  invoice_reminder: [
    ...COMMUNES,
    { cle: 'invoice_number', fr: 'N° de facture', en: 'Invoice #', exemple: { fr: '48', en: '48' } },
    { cle: 'amount_due', fr: 'Montant dû', en: 'Amount due', exemple: { fr: '1 220,17 $', en: '$1,220.17' } },
    { cle: 'due_date', fr: 'Échéance', en: 'Due date', exemple: { fr: '24 avril 2026', en: 'April 24, 2026' } },
    { cle: 'pay_url', fr: 'Lien de paiement', en: 'Payment link', exemple: { fr: 'lumecrm.net/pay/…', en: 'lumecrm.net/pay/…' } },
  ],
  quote_sent: [
    ...COMMUNES,
    { cle: 'quote_number', fr: 'N° de soumission', en: 'Quote #', exemple: { fr: '31', en: '31' } },
    { cle: 'quote_amount', fr: 'Montant', en: 'Amount', exemple: { fr: '1 626,90 $', en: '$1,626.90' } },
    { cle: 'valid_until', fr: 'Valide jusqu’au', en: 'Valid until', exemple: { fr: '2 mai 2026', en: 'May 2, 2026' } },
    { cle: 'quote_link', fr: 'Lien de la soumission', en: 'Quote link', exemple: { fr: 'lumecrm.net/quote/…', en: 'lumecrm.net/quote/…' } },
  ],
  /* Ces deux postes manquaient (2026-09-23), alors que le serveur remplit
     bien leurs variables — `server/routes/agreements.ts` ligne 922 et
     `server/routes/payment-requests.ts` ligne 140.

     La conséquence était visible par le CLIENT : l'objet par défaut du
     contrat cite `[contract_number]`, que `variablesPour` ne connaissait pas.
     L'éditeur ne le proposait donc pas, et surtout l'aperçu ne le remplaçait
     pas par son exemple — on validait un objet à trou. Un test croise
     désormais ces listes avec le catalogue. */
  contract_sent: [
    ...COMMUNES,
    { cle: 'contract_number', fr: 'N° de contrat', en: 'Contract #', exemple: { fr: '12', en: '12' } },
    { cle: 'contract_link', fr: 'Lien du contrat', en: 'Contract link', exemple: { fr: 'lumecrm.net/contract/…', en: 'lumecrm.net/contract/…' } },
  ],
  deposit_request: [
    ...COMMUNES,
    { cle: 'invoice_number', fr: 'N° de facture', en: 'Invoice #', exemple: { fr: '48', en: '48' } },
    { cle: 'amount_due', fr: 'Montant demandé', en: 'Amount due', exemple: { fr: '406,73 $', en: '$406.73' } },
    { cle: 'payment_link', fr: 'Lien de paiement', en: 'Payment link', exemple: { fr: 'lumecrm.net/pay/…', en: 'lumecrm.net/pay/…' } },
  ],
};

/**
 * Ce qu'on propose pour un poste donné.
 *
 * Un type non listé ne reçoit que les variables communes : mieux vaut en
 * offrir deux qui marchent que six dont quatre laisseront un trou.
 */
export function variablesPour(type: string | undefined): VariableCourriel[] {
  if (!type) return COMMUNES;
  return VARIABLES_PAR_TYPE[type] ?? COMMUNES;
}

/**
 * Remplace les variables par leur exemple, pour l'aperçu.
 *
 * Une variable inconnue reste visible telle quelle : c'est le signe qu'elle
 * n'existe pas, et l'effacer la ferait passer pour correcte.
 */
export function remplacerParExemples(texte: string, type: string | undefined, fr: boolean): string {
  const table = new Map(variablesPour(type).map((v) => [v.cle, v.exemple[fr ? 'fr' : 'en']]));
  /* Les DEUX syntaxes, comme `applyTemplate` côté serveur (notificationHelpers
     ligne 344) : `{cle}` et `[cle]`.

     Cette fonction ne gérait que les accolades — mais tous les objets par
     défaut du catalogue sont écrits avec des crochets. L'aperçu affichait
     donc « Soumission [quote_number] — [quote_amount] », et le propriétaire
     validait un objet plein de crochets en croyant que c'est ce que son
     client recevrait. */
  const remplacer = (tout: string, cle: string) => table.get(cle) ?? tout;
  return texte.replace(/\{(\w+)\}/g, remplacer).replace(/\[(\w+)\]/g, remplacer);
}
