// Générateur du jeu de données « piégé » du banc d'essai de la migration
// assistée. Produit 4 CSV au format des exports Jobber dans le dossier passé
// en argument (défaut: ./trap-dataset). Chaque piège cible une garantie
// précise du système — voir e2e-trap.mjs pour les assertions correspondantes.
//
//   node scripts/migration-bench/gen-trap-dataset.mjs [dossier]
//
// Pièges inclus :
//  1. client exporté deux fois à l'identique  → fusion interne (1 seul créé)
//  2. deux « Jean Dupont » DISTINCTS          → jamais fusionnés, clé ambiguë
//  3. job lié à « Jean Dupont »               → orphelin exclu + problème signalé
//  4. job n° 1001 en double                   → fusion interne
//  5. factures datées JJ/MM/AAAA (25/03 = preuve) → convention par colonne
//  6. facture payée à moitié (Balance 50 $)   → statut partial exact au cent
//  7. facture n° 501 en double (1,15 $)       → fusion vers la VRAIE (172,46 $)
//  8. « Assigned To » = Marc Employe ×3       → correspondance employés
//  9. soumission Q-101 liée au job 1001       → lien quote→job
// 10. soumission n° Q-101 en double           → fusion interne

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.argv[2] ?? './trap-dataset';
mkdirSync(DIR, { recursive: true });

// PRNG déterministe (mulberry32) — les comptes attendus du banc en dépendent.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const FIRST = ['Marc', 'Julie', 'Étienne', 'Sophie', 'François', 'Mélanie', 'Kevin', 'Isabelle', 'Patrick', 'Nathalie', 'Simon', 'Caroline', 'Hugo', 'Valérie', 'Alexandre', 'Karine', 'Mathieu', 'Chantal', 'David', 'Émilie'];
const LAST = ['Tremblay', 'Gagnon', 'Roy', 'Côté', 'Bouchard', 'Gauthier', 'Morin', 'Lavoie', 'Fortin', 'Gagné', 'Ouellet', 'Pelletier', 'Bélanger', 'Lévesque', 'Bergeron', 'Leblanc', 'Paquette', 'Girard', 'Simard', 'Boucher'];
const STREETS = ['Rue Saint-Denis', 'Boulevard des Pins', 'Avenue du Parc', 'Rue Notre-Dame', 'Chemin de la Côte', 'Rue Principale', 'Boulevard Curé-Labelle', 'Rue des Érables', 'Avenue Papineau', 'Rue Sherbrooke'];
const CITIES = [['Montréal', 'H2X 1Y4'], ['Laval', 'H7N 3T5'], ['Longueuil', 'J4K 2P8'], ['Brossard', 'J4W 2S9'], ['Terrebonne', 'J6W 1E2'], ['Repentigny', 'J6A 5N4']];
const csv = (rows) => rows.map((r) => r.map((v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(',')).join('\n') + '\n';

// ── clients (23 lignes → 22 attendus : 1 fusion interne, 2 homonymes distincts)
const clients = [];
const clientRows = [['Client Name', 'First Name', 'Last Name', 'Company Name', 'Email', 'Phone Number', 'Street', 'City', 'Province', 'Postal Code', 'Lead Source', 'Client Since']];
for (let i = 0; i < 20; i++) {
  const fn = FIRST[i]; const ln = LAST[i];
  const name = `${fn} ${ln}`;
  const email = `${fn.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}.${ln.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}@exemple.com`;
  const street = `${100 + Math.floor(rand() * 9899)} ${pick(STREETS)}`;
  const [city, pc] = pick(CITIES);
  clients.push({ name, street });
  clientRows.push([name, fn, ln, '', email, `(514) 555-${String(1000 + i).padStart(4, '0')}`, street, city, 'QC', pc, pick(['Referral', 'Google', 'Door to door', '']), pick(['03/15/2023', '2023-06-01', 'Jan 8, 2024', '11/02/2024'])]);
}
clientRows.push([...clientRows[1]]); // piège 1 : doublon interne exact
clientRows.push(['Jean Dupont', 'Jean', 'Dupont', '', 'jean.d1@exemple.com', '(438) 555-7001', '12 Rue des Lilas', 'Laval', 'QC', 'H7N 3T5', 'Referral', '2024-01-15']);
clientRows.push(['Jean Dupont', 'Jean', 'Dupont', '', 'jean.d2@exemple.com', '(438) 555-7002', '845 Avenue Papineau', 'Montréal', 'QC', 'H2X 1Y4', 'Google', '2024-02-20']);
writeFileSync(join(DIR, 'clients_export.csv'), csv(clientRows));

// ── jobs (30 lignes → 28 attendus : 1 orphelin homonyme, 1 fusion n°)
const TITLES = ['Lavage de vitres', 'Nettoyage de gouttières', 'Grand ménage extérieur', 'Lavage à pression', 'Entretien saisonnier'];
const TOTALS = [150, 275.5, 480, 1250.75, 89.99];
const jobs = [];
const jobRows = [['Job #', 'Client Name', 'Job Title', 'Status', 'Scheduled Start', 'Scheduled End', 'Job Total', 'Service Street', 'Notes', 'Assigned To']];
let n = 1000;
for (const c of clients) {
  const count = 1 + Math.floor(rand() * 2);
  for (let k = 0; k < count && jobs.length < 28; k++) {
    n += 1;
    const total = pick(TOTALS);
    const start = `${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}/${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}/2024`;
    const status = pick(['Complete', 'Complete', 'Complete', 'Scheduled', 'Cancelled']);
    jobs.push({ num: n, client: c.name, total, status });
    jobRows.push([`${n}`, c.name, pick(TITLES), status, `${start} 9:00 AM`, `${start} 12:00 PM`, `$${total.toFixed(2)}`, c.street, pick(['', 'Client régulier', 'Accès par la cour arrière']), jobs.length <= 3 ? 'Marc Employe' : '']);
  }
}
jobRows.push(['1900', 'Jean Dupont', 'Lavage de vitres', 'Complete', '06/10/2024 10:00 AM', '06/10/2024 12:00 PM', '$200.00', '12 Rue des Lilas', '', '']); // piège 3
jobRows.push(['1001', jobs[0].client, 'Lavage à pression', jobs[0].status, '05/12/2024 9:00 AM', '05/12/2024 12:00 PM', `$${jobs[0].total.toFixed(2)}`, clients[0].street, '', '']); // piège 4
writeFileSync(join(DIR, 'jobs_export.csv'), csv(jobRows));

// ── soumissions (5 lignes → 4 attendues : 1 fusion n°)
writeFileSync(join(DIR, 'quotes_export.csv'), csv([
  ['Quote Number', 'Client Name', 'Job #', 'Status', 'Subtotal', 'Tax Amount', 'Total', 'Valid Until'],
  ['Q-101', 'Marc Tremblay', '1001', 'Approved', '$480.00', '$71.88', '$551.88', '04/30/2024'],
  ['Q-102', 'Julie Gagnon', '', 'Sent', '$275.50', '$41.25', '$316.75', '05/15/2024'],
  ['Q-103', 'Sophie Côté', '', 'Draft', '$150.00', '$22.46', '$172.46', ''],
  ['Q-104', 'Kevin Morin', '', 'Declined', '$89.99', '$13.47', '$103.46', ''],
  ['Q-101', 'Marc Tremblay', '1001', 'Approved', '$480.00', '$71.88', '$551.88', '04/30/2024'],
]));

// ── factures (16 lignes → 15 attendues, dates JJ/MM, 1 partielle, 1 fusion n°)
const invRows = [['Invoice #', 'Client Name', 'Job #', 'Issued Date', 'Due Date', 'Subtotal', 'Tax Amount', 'Total', 'Balance', 'Status']];
let inv = 500;
let expectedCents = 0;
const complete = jobs.filter((j) => j.status === 'Complete');
for (const j of complete) {
  inv += 1;
  const sub = j.total;
  const tax = Math.round(sub * 0.14975 * 100) / 100;
  const tot = Math.round((sub + tax) * 100) / 100;
  const paid = rand() < 0.8;
  const issued = inv === 501 ? '25/03/2024' : '10/05/2024'; // piège 5 : jour>12 prouve JJ/MM
  expectedCents += Math.round(tot * 100);
  invRows.push([`${inv}`, j.client, `${j.num}`, issued, inv === 501 ? '24/04/2024' : '09/06/2024', `$${sub.toFixed(2)}`, `$${tax.toFixed(2)}`, `$${tot.toFixed(2)}`, paid ? '$0.00' : `$${tot.toFixed(2)}`, paid ? 'Paid' : 'Awaiting Payment']);
}
inv += 1;
invRows.push([`${inv}`, 'Marc Tremblay', '1001', '10/05/2024', '09/06/2024', '$100.00', '$14.98', '$114.98', '$50.00', 'Awaiting Payment']); // piège 6
expectedCents += 11498;
invRows.push(['501', complete[0].client, `${complete[0].num}`, '25/03/2024', '24/04/2024', '$1.00', '$0.15', '$1.15', '$0.00', 'Paid']); // piège 7
writeFileSync(join(DIR, 'invoices_export.csv'), csv(invRows));

const summary = {
  clients: { rows: clientRows.length - 1, expectedCreated: 22, expectedMerged: 1 },
  jobs: { rows: jobRows.length - 1, expectedCreated: jobs.length, expectedMerged: 1, expectedOrphans: 1 },
  quotes: { rows: 5, expectedCreated: 4, expectedMerged: 1 },
  invoices: { rows: invRows.length - 1, expectedCreated: complete.length + 1, expectedMerged: 1, expectedCents },
};
writeFileSync(join(DIR, 'expected.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
