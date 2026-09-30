/**
 * Modules simulés COMMUNS aux bancs de quarantaine (unitaires et intégration).
 *
 * Chaque fichier déclarait sa propre copie de ces mocks : à chaque export ajouté
 * au module réel (`langueEntreprise`, puis `senderForOrg`, puis
 * `adresseInjoignable`), les dix copies périmaient ensemble et le moteur
 * échouait sur « No export is defined on the mock » — des dizaines de rouges
 * qui ressemblaient à des défauts produit. Un seul endroit à tenir à jour.
 *
 * Usage (la fabrique de `vi.mock` est hissée : l'import doit être dynamique) :
 *   vi.mock('../../../server/routes/emails', async () => (await import('../_simulations')).emailsSimules());
 *   vi.mock('../../../server/lib/mailer', async () => (await import('../_simulations')).mailerSimule(envoi));
 */
type Envoi = (p: any) => Promise<{ sent: boolean; messageId?: string }>;

/**
 * `server/routes/emails` : gabarit transparent, expéditeur fixe. L'entreprise
 * a un nom et une adresse postale : sans eux, un courriel commercial est
 * sauté (LCAP, audit V2 L8) — un test qui veut ce cas passe `societe`.
 */
export function emailsSimules(from = 'test@lume.test', societe: Record<string, unknown> = { company_name: 'Entreprise test', company_address: '120 rue Principale, Granby, QC, J2G 2V1' }) {
  return {
    getCompanySettings: async () => societe,
    buildEmailLayout: (_c: unknown, b: string) => b,
    senderFor: () => ({ from }),
    senderForOrg: async () => ({ from }),
    langueEntreprise: () => 'fr',
  };
}

/** `server/lib/mailer` : l'envoi est confié au test ; aucune adresse n'a rebondi. */
export function mailerSimule(sendEmail: Envoi) {
  return {
    isMailerConfigured: () => true,
    sendEmail,
    adresseInjoignable: async () => false,
  };
}
