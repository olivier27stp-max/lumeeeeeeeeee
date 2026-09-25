// Instructions d'exportation par ancien CRM. Structure extensible : pas de
// fausses intégrations API — uniquement des guides d'export de fichiers et
// les limites connues de chaque plateforme. Textes bilingues (fr/en).

import type { SourceCrm } from './types';

export interface CrmExportConfig {
  key: SourceCrm;
  name: string;
  reports: { fr: string; en: string }[];
  formats: string[];
  steps: { fr: string; en: string }[];
  typicalFields: string[];
  knownLimitations: { fr: string; en: string }[];
  docsUrl: string | null;
  tips: { fr: string; en: string }[];
  /** Ce que la migration n'importe PAS au lancement — dit tel quel au client (voir LIMITES_LANCEMENT). */
  notImported: { fr: string; en: string }[];
}

/**
 * Périmètre honnête du lancement (2026-09-24) : identique pour tous les CRM
 * sources, affiché dans le portail sous « Ce qui ne s'importe pas ». À mettre à
 * jour le jour où l'importeur couvre l'un de ces points.
 */
export const LIMITES_LANCEMENT: { fr: string; en: string }[] = [
  {
    fr: 'Les notes, pièces jointes, étiquettes, champs personnalisés et demandes de service ne s\'importent pas.',
    en: 'Notes, attachments, tags, custom fields and service requests are not imported.',
  },
  {
    fr: 'Les plans récurrents deviennent des jobs récurrents, sans contrat de service.',
    en: 'Recurring plans become recurring jobs, without a service contract.',
  },
  {
    fr: 'Excel : seule la première feuille du classeur est lue.',
    en: 'Excel: only the first sheet of the workbook is read.',
  },
  {
    fr: 'Un fichier dépasse rarement 20 000 lignes ; au-delà, scindez-le en plusieurs fichiers (maximum absolu : 50 000 lignes).',
    en: 'A file rarely exceeds 20,000 rows; beyond that, split it into several files (hard limit: 50,000 rows).',
  },
];

const GENERIC_TIPS: { fr: string; en: string }[] = [
  {
    fr: 'Exportez en CSV lorsque possible — c\'est le format le plus fiable pour l\'analyse.',
    en: 'Export as CSV when possible — it is the most reliable format for analysis.',
  },
  {
    fr: 'Incluez les colonnes d\'identifiants (numéro de client, de job, de facture) : elles servent à relier vos données.',
    en: 'Include ID columns (client, job, invoice numbers): they are used to link your data together.',
  },
  {
    fr: 'Évitez de modifier les fichiers exportés avant de les téléverser (pas de colonnes supprimées ni renommées).',
    en: 'Avoid editing exported files before uploading (no deleted or renamed columns).',
  },
];

export const CRM_EXPORT_CONFIGS: Record<SourceCrm, CrmExportConfig> = {
  jobber: {
    key: 'jobber',
    name: 'Jobber',
    // Les cinq rapports qui font une migration complète. Chacun : Reports → le rapport →
    // période « All time » → statut « All » → Export CSV. Le piège vu chez Vision Lavage
    // (2026-09-23) : Jobber propose « Last 30 days » par défaut → un export « Jobs » de
    // 29 lignes au lieu de 859.
    reports: [
      { fr: '1. « Client Contact Info » (Reports → Clients) : vos clients avec courriels, téléphones et adresses', en: '1. "Client Contact Info" (Reports → Clients): your clients with emails, phones and addresses' },
      { fr: '2. « Quotes » (Reports → Work) : toutes les soumissions, tous statuts', en: '2. "Quotes" (Reports → Work): all quotes, all statuses' },
      { fr: '3. « One-Off Jobs » et, si vous en avez, « Recurring Jobs » (Reports → Work) : tous les jobs, tous statuts', en: '3. "One-Off Jobs" and, if you use them, "Recurring Jobs" (Reports → Work): all jobs, all statuses' },
      { fr: '4. « Visits » (Reports → Work) : toutes les visites planifiées et complétées — c\'est ce qui remplit le calendrier', en: '4. "Visits" (Reports → Work): all scheduled and completed visits — this is what fills the calendar' },
      { fr: '5. « Invoices » (Reports → Financial) : toutes les factures, tous statuts (payées, dues, en retard)', en: '5. "Invoices" (Reports → Financial): all invoices, all statuses (paid, due, past due)' },
      { fr: 'Facultatif : « Products & Services » (Settings) pour votre catalogue, « Client Properties » pour les adresses de service secondaires', en: 'Optional: "Products & Services" (Settings) for your catalogue, "Client Properties" for secondary service addresses' },
    ],
    formats: ['csv', 'xlsx'],
    steps: [
      { fr: 'Dans Jobber, ouvrez Reports et choisissez le rapport.', en: 'In Jobber, open Reports and pick the report.' },
      { fr: 'Période : choisissez « All time ». Par défaut Jobber n\'exporte que les 30 derniers jours — c\'est l\'erreur la plus fréquente (un fichier Jobs de 29 lignes au lieu de plusieurs centaines).', en: 'Date range: choose "All time". Jobber defaults to the last 30 days — the most common mistake (a Jobs file with 29 rows instead of several hundred).' },
      { fr: 'Statut : « All » (ne filtrez pas sur Active, Paid ou Completed).', en: 'Status: "All" (do not filter on Active, Paid or Completed).' },
      { fr: 'Cliquez « Export » (CSV ou Excel) et enregistrez le fichier sans le modifier : aucune colonne supprimée ni renommée.', en: 'Click "Export" (CSV or Excel) and save the file without editing it: no deleted or renamed columns.' },
      { fr: 'Répétez pour les cinq rapports, puis déposez chaque fichier dans la bonne catégorie du portail.', en: 'Repeat for the five reports, then drop each file in the matching category of the portal.' },
    ],
    typicalFields: ['Client Name', 'Email', 'Phone', 'Service Address', 'Job #', 'Visit Start', 'Total', 'Invoice #', 'Status'],
    knownLimitations: [
      { fr: 'Les pièces jointes et photos ne sont pas incluses dans les exports Jobber.', en: 'Attachments and photos are not included in Jobber exports.' },
      { fr: 'Les visites se rattachent aux jobs par leur numéro (Job #) : un fichier Visits sans son fichier Jobs laisse les visites orphelines.', en: 'Visits attach to jobs by their number (Job #): a Visits file without its Jobs file leaves the visits orphaned.' },
    ],
    docsUrl: 'https://help.getjobber.com/',
    tips: GENERIC_TIPS,
    notImported: LIMITES_LANCEMENT,
  },
  housecall_pro: {
    key: 'housecall_pro',
    name: 'Housecall Pro',
    reports: [
      { fr: 'Export « Customers » (Customers → Export)', en: '"Customers" export (Customers → Export)' },
      { fr: 'Rapport « Jobs » (Reporting)', en: '"Jobs" report (Reporting)' },
      { fr: 'Rapport « Invoices »', en: '"Invoices" report' },
      { fr: 'Taux de taxe (Settings → Tax Rates) — un CSV nom / taux', en: 'Tax rates (Settings → Tax Rates) — one CSV with name / rate' },
    ],
    formats: ['csv'],
    steps: [
      { fr: 'Ouvrez la liste des clients, puis Export.', en: 'Open the customer list, then Export.' },
      { fr: 'Dans Reporting, exportez les jobs et les factures pour toute la période.', en: 'In Reporting, export jobs and invoices for the full period.' },
      { fr: 'Téléversez les CSV obtenus sans les modifier.', en: 'Upload the resulting CSVs without editing them.' },
    ],
    typicalFields: ['Customer', 'Email', 'Mobile Phone', 'Address', 'Job', 'Scheduled Date', 'Amount', 'Invoice #'],
    knownLimitations: [
      { fr: 'L\'historique détaillé des visites peut être limité selon le forfait.', en: 'Detailed visit history may be limited depending on the plan.' },
    ],
    docsUrl: 'https://help.housecallpro.com/',
    tips: GENERIC_TIPS,
    notImported: LIMITES_LANCEMENT,
  },
  servicetitan: {
    key: 'servicetitan',
    name: 'ServiceTitan',
    reports: [
      { fr: 'Rapports personnalisés Customers / Jobs / Invoices (Reports)', en: 'Custom Customers / Jobs / Invoices reports (Reports)' },
      { fr: 'Taux de taxe (Settings → Invoicing → Tax Zones) — un CSV nom / taux / région', en: 'Tax rates (Settings → Invoicing → Tax Zones) — one CSV with name / rate / region' },
    ],
    formats: ['csv', 'xlsx (réexporter en CSV)'],
    steps: [
      { fr: 'Créez un rapport par type de données dans Reports, avec toutes les colonnes utiles.', en: 'Create one report per data type in Reports, with all useful columns.' },
      { fr: 'Exportez chaque rapport ; si le fichier est en XLSX, réenregistrez-le en CSV.', en: 'Export each report; if the file is XLSX, re-save it as CSV.' },
    ],
    typicalFields: ['Customer Name', 'Location Address', 'Job Number', 'Completion Date', 'Invoice Number', 'Total', 'Balance'],
    knownLimitations: [
      { fr: 'Selon vos permissions ServiceTitan, certains rapports peuvent être restreints.', en: 'Depending on your ServiceTitan permissions, some reports may be restricted.' },
    ],
    docsUrl: 'https://help.servicetitan.com/',
    tips: GENERIC_TIPS,
    notImported: LIMITES_LANCEMENT,
  },
  gohighlevel: {
    key: 'gohighlevel',
    name: 'GoHighLevel',
    reports: [
      { fr: 'Export « Contacts » (Contacts → Export)', en: '"Contacts" export (Contacts → Export)' },
      { fr: 'Export « Opportunities » si utilisé', en: '"Opportunities" export if used' },
    ],
    formats: ['csv'],
    steps: [
      { fr: 'Dans Contacts, sélectionnez tous les contacts puis Export.', en: 'In Contacts, select all contacts then Export.' },
      { fr: 'Exportez aussi les opportunités si votre pipeline y vit.', en: 'Also export opportunities if your pipeline lives there.' },
    ],
    typicalFields: ['Contact Name', 'Email', 'Phone', 'Address', 'Pipeline Stage', 'Opportunity Value'],
    knownLimitations: [
      { fr: 'GoHighLevel n\'a pas de notion native de jobs/visites — ces données devront venir d\'un autre outil ou de fichiers personnalisés.', en: 'GoHighLevel has no native jobs/visits concept — that data must come from another tool or custom files.' },
    ],
    docsUrl: 'https://help.gohighlevel.com/',
    tips: GENERIC_TIPS,
    notImported: LIMITES_LANCEMENT,
  },
  quickbooks: {
    key: 'quickbooks',
    name: 'QuickBooks',
    reports: [
      { fr: 'Liste des clients (Sales → Customers → Export)', en: 'Customer list (Sales → Customers → Export)' },
      { fr: 'Rapport « Invoice List » / « Transaction List »', en: '"Invoice List" / "Transaction List" report' },
      { fr: 'Liste « Products and Services »', en: '"Products and Services" list' },
      { fr: 'Taux de taxe (Taxes → Sales Tax Settings) — un CSV nom / taux / organisme', en: 'Tax rates (Taxes → Sales Tax Settings) — one CSV with name / rate / agency' },
    ],
    formats: ['csv', 'xlsx (réexporter en CSV)'],
    steps: [
      { fr: 'Exportez la liste des clients depuis Sales → Customers.', en: 'Export the customer list from Sales → Customers.' },
      { fr: 'Exportez le rapport des factures pour toute la période.', en: 'Export the invoice report for the full period.' },
      { fr: 'Exportez la liste Produits et services.', en: 'Export the Products and Services list.' },
    ],
    typicalFields: ['Customer', 'Email', 'Billing Address', 'Invoice No.', 'Invoice Date', 'Due Date', 'Amount', 'Open Balance', 'Product/Service'],
    knownLimitations: [
      { fr: 'QuickBooks ne contient pas les visites/horaires — seulement clients, factures et paiements.', en: 'QuickBooks holds no visits/schedule — only customers, invoices and payments.' },
    ],
    docsUrl: 'https://quickbooks.intuit.com/learn-support/',
    tips: GENERIC_TIPS,
    notImported: LIMITES_LANCEMENT,
  },
  other: {
    key: 'other',
    name: 'Autre CRM',
    reports: [
      { fr: 'Tout export CSV disponible (clients, jobs, factures…)', en: 'Any available CSV export (clients, jobs, invoices…)' },
      { fr: 'Vos taxes (nom, taux en %, région) — un petit CSV suffit', en: 'Your taxes (name, rate in %, region) — a small CSV is enough' },
    ],
    formats: ['csv'],
    steps: [
      { fr: 'Cherchez une fonction « Export » ou « Rapports » dans votre CRM.', en: 'Look for an "Export" or "Reports" feature in your CRM.' },
      { fr: 'Exportez un fichier par type de données, en CSV de préférence.', en: 'Export one file per data type, preferably CSV.' },
      { fr: 'Si seul un export complet existe, téléversez-le : notre équipe le découpera.', en: 'If only a full export exists, upload it: our team will split it.' },
    ],
    typicalFields: [],
    knownLimitations: [],
    docsUrl: null,
    tips: GENERIC_TIPS,
    notImported: LIMITES_LANCEMENT,
  },
  custom_files: {
    key: 'custom_files',
    name: 'Fichiers personnalisés',
    reports: [{ fr: 'Vos propres fichiers CSV (ex. tableurs maison)', en: 'Your own CSV files (e.g. homemade spreadsheets)' }],
    formats: ['csv'],
    steps: [
      { fr: 'Enregistrez chaque tableur en CSV (UTF-8 de préférence).', en: 'Save each spreadsheet as CSV (UTF-8 preferred).' },
      { fr: 'Une ligne d\'en-tête par fichier, une ligne par dossier.', en: 'One header row per file, one row per record.' },
    ],
    typicalFields: [],
    knownLimitations: [
      { fr: 'La qualité de la migration dépend de la constance de vos colonnes.', en: 'Migration quality depends on how consistent your columns are.' },
    ],
    docsUrl: null,
    tips: GENERIC_TIPS,
    notImported: LIMITES_LANCEMENT,
  },
};

export function getCrmConfig(crm: SourceCrm): CrmExportConfig {
  return CRM_EXPORT_CONFIGS[crm] ?? CRM_EXPORT_CONFIGS.other;
}
