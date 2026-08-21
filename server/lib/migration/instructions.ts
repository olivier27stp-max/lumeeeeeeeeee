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
}

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
    reports: [
      { fr: 'Rapport « Clients » (Reports → Clients)', en: '"Clients" report (Reports → Clients)' },
      { fr: 'Rapport « Jobs » et « Visits »', en: '"Jobs" and "Visits" reports' },
      { fr: 'Rapport « Invoices » et « Payments »', en: '"Invoices" and "Payments" reports' },
      { fr: 'Rapport « Quotes »', en: '"Quotes" report' },
    ],
    formats: ['csv'],
    steps: [
      { fr: 'Dans Jobber, ouvrez Reports.', en: 'In Jobber, open Reports.' },
      { fr: 'Sélectionnez le rapport (Clients, Jobs, Invoices…), période « All time ».', en: 'Select the report (Clients, Jobs, Invoices…), date range "All time".' },
      { fr: 'Cliquez « Export CSV » et enregistrez le fichier sans le modifier.', en: 'Click "Export CSV" and save the file without editing it.' },
      { fr: 'Répétez pour chaque type de données à migrer.', en: 'Repeat for each data type to migrate.' },
    ],
    typicalFields: ['Client Name', 'Email', 'Phone', 'Service Address', 'Job Number', 'Scheduled Start', 'Total', 'Invoice Number', 'Status'],
    knownLimitations: [
      { fr: 'Les pièces jointes et photos ne sont pas incluses dans les exports CSV.', en: 'Attachments and photos are not included in CSV exports.' },
      { fr: 'Les items de lignes détaillés peuvent nécessiter un rapport séparé.', en: 'Detailed line items may require a separate report.' },
    ],
    docsUrl: 'https://help.getjobber.com/',
    tips: GENERIC_TIPS,
  },
  housecall_pro: {
    key: 'housecall_pro',
    name: 'Housecall Pro',
    reports: [
      { fr: 'Export « Customers » (Customers → Export)', en: '"Customers" export (Customers → Export)' },
      { fr: 'Rapport « Jobs » (Reporting)', en: '"Jobs" report (Reporting)' },
      { fr: 'Rapport « Invoices »', en: '"Invoices" report' },
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
  },
  servicetitan: {
    key: 'servicetitan',
    name: 'ServiceTitan',
    reports: [
      { fr: 'Rapports personnalisés Customers / Jobs / Invoices (Reports)', en: 'Custom Customers / Jobs / Invoices reports (Reports)' },
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
  },
  quickbooks: {
    key: 'quickbooks',
    name: 'QuickBooks',
    reports: [
      { fr: 'Liste des clients (Sales → Customers → Export)', en: 'Customer list (Sales → Customers → Export)' },
      { fr: 'Rapport « Invoice List » / « Transaction List »', en: '"Invoice List" / "Transaction List" report' },
      { fr: 'Liste « Products and Services »', en: '"Products and Services" list' },
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
  },
  other: {
    key: 'other',
    name: 'Autre CRM',
    reports: [{ fr: 'Tout export CSV disponible (clients, jobs, factures…)', en: 'Any available CSV export (clients, jobs, invoices…)' }],
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
  },
};

export function getCrmConfig(crm: SourceCrm): CrmExportConfig {
  return CRM_EXPORT_CONFIGS[crm] ?? CRM_EXPORT_CONFIGS.other;
}
