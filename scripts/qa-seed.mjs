/**
 * QA SEED — Complete test dataset for Lume CRM
 *
 * Convention: All test data uses "[QA]" prefix in names/titles
 * Cleanup: node scripts/qa-cleanup.mjs
 *
 * Uses Supabase Management API to bypass RLS/triggers.
 * Run: node scripts/qa-seed.mjs
 */

import crypto from 'crypto';

const SUPABASE_URL = 'https://bbzcuzqfgsdvjsymfwmr.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJiemN1enFmZ3NkdmpzeW1md21yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTM0NzA4MSwiZXhwIjoyMDg2OTIzMDgxfQ.s91KDFG3iz7q-WoaNYkyRHs6Y8YmC6F-o13qFcFvOec';
const MGMT_TOKEN = 'sbp_70d8ff687c60f2afeb73c8c6d4f59725d3cda70e';
const PROJECT_REF = 'bbzcuzqfgsdvjsymfwmr';
const ORG_ID = '4d885f6c-e076-4ed9-ab09-23637dbee6cd';
const USER_ID = 'e0cf4b92-c229-4785-a2e7-7081fae3e18e';

const uid = () => crypto.randomUUID();

// ── SQL execution via Management API ──
async function execSQL(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${MGMT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.json();
  if (res.status !== 201) {
    console.error('  SQL ERROR:', JSON.stringify(body).substring(0, 300));
    return null;
  }
  return body;
}

// ── Helpers ──
function esc(s) { return s ? s.replace(/'/g, "''") : 'NULL'; }
function val(v) { return v === null || v === undefined ? 'NULL' : `'${esc(String(v))}'`; }
function numVal(v) { return v === null || v === undefined ? 'NULL' : String(v); }
function boolVal(v) { return v ? 'true' : 'false'; }

function daysFromNow(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString(); }
function dateOnly(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().split('T')[0]; }
function timeSlot(daysOffset, hour = 9) { const d = new Date(); d.setDate(d.getDate() + daysOffset); d.setHours(hour, 0, 0, 0); return d.toISOString(); }
function timeSlotEnd(daysOffset, hour, dur) { const d = new Date(); d.setDate(d.getDate() + daysOffset); d.setHours(hour + dur, 0, 0, 0); return d.toISOString(); }

const stats = {};
function track(key, n = 1) { stats[key] = (stats[key] || 0) + n; }

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  QA SEED — Lume CRM Test Data');
  console.log('═══════════════════════════════════════════════════\n');

  // ══════════════════════════════════════════
  // CLIENTS (8)
  // ══════════════════════════════════════════
  console.log('Creating clients...');
  const clientIds = Array.from({ length: 8 }, () => uid());
  const clients = [
    { id: clientIds[0], fn: '[QA] Marie', ln: 'Tremblay', email: 'qa.marie@test.lume.dev', phone: '514-555-0101', addr: '123 Rue Saint-Denis, Montréal, QC', company: 'Résidences Tremblay' },
    { id: clientIds[1], fn: '[QA] Jean-Pierre', ln: 'Gagnon', email: 'qa.jp@test.lume.dev', phone: '438-555-0102', addr: '456 Boul. René-Lévesque, Québec, QC', company: null },
    { id: clientIds[2], fn: '[QA] Sophie', ln: 'Bouchard', email: 'qa.sophie@test.lume.dev', phone: '450-555-0103', addr: '789 Rue Principale, Laval, QC', company: 'Immeubles Bouchard Inc.' },
    { id: clientIds[3], fn: '[QA] Robert', ln: 'Côté', email: 'qa.robert@test.lume.dev', phone: '819-555-0104', addr: '321 Av. des Pins, Sherbrooke, QC', company: null },
    { id: clientIds[4], fn: '[QA] Isabelle', ln: 'Roy', email: 'qa.isabelle@test.lume.dev', phone: '514-555-0105', addr: '654 Rue Notre-Dame, Montréal, QC', company: 'Roy & Associés' },
    { id: clientIds[5], fn: '[QA] Luc', ln: 'Lavoie', email: 'qa.luc@test.lume.dev', phone: '418-555-0106', addr: '987 Ch. Sainte-Foy, Québec, QC', company: null },
    { id: clientIds[6], fn: '[QA] Catherine', ln: 'Morin', email: 'qa.catherine@test.lume.dev', phone: '438-555-0107', addr: '147 Rue du Parc, Longueuil, QC', company: 'Centre Commercial Morin' },
    { id: clientIds[7], fn: '[QA] Patrick', ln: 'Bélanger', email: 'qa.patrick@test.lume.dev', phone: '514-555-0108', addr: '258 Boul. Décarie, Montréal, QC', company: null },
  ];

  for (const c of clients) {
    const r = await execSQL(`
      INSERT INTO clients (id, org_id, created_by, first_name, last_name, email, phone, address, company, status, notes)
      VALUES ('${c.id}', '${ORG_ID}', '${USER_ID}', '${esc(c.fn)}', '${esc(c.ln)}', '${c.email}', '${c.phone}', '${esc(c.addr)}', ${c.company ? `'${esc(c.company)}'` : 'NULL'}, 'active', '[QA SEED] Donnée de test')
      ON CONFLICT DO NOTHING;
    `);
    if (r !== null) track('clients');
  }
  console.log(`  ${stats.clients} clients created`);

  // ══════════════════════════════════════════
  // LEADS (4)
  // ══════════════════════════════════════════
  console.log('Creating leads...');
  const leadIds = Array.from({ length: 4 }, () => uid());
  const leads = [
    { id: leadIds[0], fn: '[QA] Alexandre', ln: 'Fortin', email: 'qa.alex@test.lume.dev', phone: '514-555-0201', status: 'new', value: 2500, source: 'Website' },
    { id: leadIds[1], fn: '[QA] Nathalie', ln: 'Pelletier', email: 'qa.nathalie@test.lume.dev', phone: '450-555-0202', status: 'contacted', value: 8000, source: 'Referral' },
    { id: leadIds[2], fn: '[QA] François', ln: 'Gauthier', email: 'qa.francois@test.lume.dev', phone: '438-555-0203', status: 'proposal', value: 3500, source: 'Google' },
    { id: leadIds[3], fn: '[QA] Émilie', ln: 'Bergeron', email: 'qa.emilie@test.lume.dev', phone: '514-555-0204', status: 'follow_up_1', value: 12000, source: 'Facebook' },
  ];

  // Disable the problematic trigger temporarily, insert, then re-enable
  const leadSQL = `
    ALTER TABLE leads DISABLE TRIGGER trg_leads_force_org_id;
    ${leads.map(l => `
      INSERT INTO leads (id, org_id, user_id, created_by, first_name, last_name, email, phone, status, value, source, notes, tags, line_items)
      VALUES ('${l.id}', '${ORG_ID}', '${USER_ID}', '${USER_ID}', '${esc(l.fn)}', '${esc(l.ln)}', '${l.email}', '${l.phone}', '${l.status}', ${l.value}, '${l.source}', '[QA SEED] Lead de test', '{}', '[]');
    `).join('\n')}
    ALTER TABLE leads ENABLE TRIGGER trg_leads_force_org_id;
  `;
  await execSQL(leadSQL);
  track('leads', 4);
  console.log('  4 leads created');

  // ══════════════════════════════════════════
  // QUOTES (8) with line items
  // ══════════════════════════════════════════
  console.log('Creating quotes...');

  // Get next quote number
  const seqRes = await execSQL(`SELECT last_value FROM quote_sequences WHERE org_id = '${ORG_ID}'`);
  let qNum = (seqRes?.[0]?.last_value || 16) + 1;

  const quoteDefs = [
    { cid: clientIds[0], lid: null, title: '[QA] Nettoyage gouttières — Tremblay', status: 'draft', ctx: 'client',
      items: [['Nettoyage de gouttières', 'Nettoyage complet avant/arrière', 1, 35000], ['Inspection descentes pluviales', 'Vérification écoulement', 1, 7500]] },
    { cid: clientIds[1], lid: null, title: '[QA] Revêtement extérieur — Gagnon', status: 'sent', ctx: 'client', sent: daysFromNow(-3),
      items: [['Revêtement en vinyle', 'Remplacement côté sud', 120, 4500], ['Isolation R-20', 'Ajout isolant', 1, 85000, true]] },
    { cid: clientIds[2], lid: null, title: '[QA] Lumières de Noël — Bouchard', status: 'approved', ctx: 'client', approved: daysFromNow(-5),
      items: [['Installation lumières Noël', 'Façade + entrée', 1, 125000], ['Minuterie automatique', 'Timer 6h', 2, 4500], ['Rallonge 50pi', null, 3, 2500]] },
    { cid: clientIds[3], lid: null, title: '[QA] Peinture intérieure — Côté', status: 'declined', ctx: 'client', declined: daysFromNow(-2),
      items: [['Peinture salon + salle à manger', '2 couches premium', 1, 175000]] },
    { cid: null, lid: leadIds[0], title: '[QA] Nettoyage vitres — Fortin', status: 'action_required', ctx: 'lead',
      items: [['Nettoyage vitres résidentiel', '12 fenêtres standard', 12, 3500], ['Nettoyage moustiquaires', null, 12, 1000]] },
    { cid: null, lid: leadIds[1], title: '[QA] Entretien commercial — Pelletier', status: 'sent', ctx: 'lead', sent: daysFromNow(-1),
      items: [['Entretien mensuel bureau', '500 pi²', 12, 45000], ['Nettoyage tapis', 'Extraction vapeur', 4, 22500]] },
    { cid: clientIds[4], lid: null, title: '[QA] Réparation toiture — Roy', status: 'expired', ctx: 'client', expired: daysFromNow(-10),
      items: [['Réparation bardeaux', 'Section ~30 pi²', 1, 95000]] },
    { cid: clientIds[5], lid: null, title: '[QA] Garde-gouttières — Lavoie', status: 'converted', ctx: 'client', approved: daysFromNow(-14), converted: daysFromNow(-12),
      items: [['Garde-gouttières aluminium', 'Micro-perforé, 80 pi lin.', 80, 2200], ['Nettoyage gouttières', 'Pré-installation', 1, 15000]] },
  ];

  const quoteIds = [];
  for (const def of quoteDefs) {
    const qid = uid();
    quoteIds.push(qid);
    const sub = def.items.filter(i => !i[4]).reduce((s, i) => s + i[2] * i[3], 0);
    const tax = Math.round(sub * 14.975 / 100);
    const total = sub + tax;
    const dep = sub > 100000;

    let sql = `INSERT INTO quotes (id, org_id, created_by, quote_number, title, client_id, lead_id, status, context_type,
      subtotal_cents, tax_rate, tax_rate_label, tax_cents, total_cents, currency, notes, valid_until,
      sent_via_email_at, approved_at, declined_at, expired_at, converted_at, deposit_required, deposit_type, deposit_value)
    VALUES ('${qid}', '${ORG_ID}', '${USER_ID}', '${qNum++}', '${esc(def.title)}',
      ${def.cid ? `'${def.cid}'` : 'NULL'}, ${def.lid ? `'${def.lid}'` : 'NULL'},
      '${def.status}', '${def.ctx}',
      ${sub}, 14.975, 'TPS+TVQ (14.975%)', ${tax}, ${total}, 'CAD', '[QA SEED] Devis de test', '${dateOnly(30)}',
      ${def.sent ? `'${def.sent}'` : 'NULL'}, ${def.approved ? `'${def.approved}'` : 'NULL'},
      ${def.declined ? `'${def.declined}'` : 'NULL'}, ${def.expired ? `'${def.expired}'` : 'NULL'},
      ${def.converted ? `'${def.converted}'` : 'NULL'}, ${dep}, ${dep ? "'percentage'" : 'NULL'}, ${dep ? 25 : 0});\n`;

    // Line items
    for (let idx = 0; idx < def.items.length; idx++) {
      const [name, desc, qty, price, opt] = def.items[idx];
      const liid = uid();
      sql += `INSERT INTO quote_line_items (id, quote_id, name, description, quantity, unit_price_cents, total_cents, sort_order, is_optional, item_type)
        VALUES ('${liid}', '${qid}', '${esc(name)}', ${desc ? `'${esc(desc)}'` : 'NULL'}, ${qty}, ${price}, ${qty * price}, ${idx}, ${opt ? 'true' : 'false'}, 'service');\n`;
    }

    // Intro section
    sql += `INSERT INTO quote_sections (quote_id, section_type, title, content, sort_order, enabled)
      VALUES ('${qid}', 'introduction', 'Introduction', 'Merci de considérer nos services. Ce devis est valable 30 jours.', 0, true);\n`;

    await execSQL(sql);
    track('quotes');
    track('quoteItems', def.items.length);
  }

  await execSQL(`UPDATE quote_sequences SET last_value = ${qNum - 1}, updated_at = now() WHERE org_id = '${ORG_ID}'`);
  console.log(`  ${stats.quotes} quotes created with ${stats.quoteItems} line items`);

  // ══════════════════════════════════════════
  // JOBS (9) + SCHEDULE EVENTS
  // ══════════════════════════════════════════
  console.log('Creating jobs + calendar events...');

  const jobDefs = [
    { ci: 2, title: '[QA] Installation lumières Noël — Bouchard', status: 'in_progress', d: 0, h: 9, dur: 4,
      items: [['Installation lumières Noël', 1, 125000], ['Minuterie', 2, 4500], ['Rallonge 50pi', 3, 2500]] },
    { ci: 0, title: '[QA] Nettoyage gouttières — Tremblay', status: 'scheduled', d: 1, h: 8, dur: 3,
      items: [['Nettoyage gouttières', 1, 35000], ['Inspection descentes', 1, 7500]] },
    { ci: 5, title: '[QA] Garde-gouttières — Lavoie', status: 'scheduled', d: 3, h: 10, dur: 6,
      items: [['Garde-gouttières alu', 80, 2200], ['Nettoyage pré-install', 1, 15000]] },
    { ci: 4, title: '[QA] Nettoyage vitres — Roy', status: 'completed', d: -1, h: 13, dur: 3,
      items: [['Nettoyage vitres ext.', 12, 3500], ['Nettoyage moustiquaires', 12, 1000]] },
    { ci: 6, title: '[QA] Entretien commercial — Morin', status: 'completed', d: -7, h: 7, dur: 4,
      items: [['Nettoyage bureau', 1, 45000], ['Nettoyage tapis', 1, 22500]] },
    { ci: 7, title: '[QA] Peinture balcon — Bélanger', status: 'completed', d: -14, h: 9, dur: 8,
      items: [['Peinture balcon avant', 1, 55000], ['Décapage revêtement', 1, 30000]] },
    { ci: 1, title: '[QA] Estimation revêtement — Gagnon', status: 'scheduled', d: 7, h: 14, dur: 2,
      items: [['Visite estimation', 1, 0]] },
    { ci: 3, title: '[QA] Réparation clôture — Côté', status: 'draft', d: null, h: null, dur: null,
      items: [['Réparation section clôture', 1, 35000], ['Matériaux', 1, 10000]] },
    { ci: 0, title: '[QA] Déneigement — Tremblay', status: 'scheduled', d: -3, h: 7, dur: 2,
      items: [['Déneigement entrée + trottoir', 1, 12500]] },
  ];

  const jobIds = [];
  for (const def of jobDefs) {
    const jid = uid();
    jobIds.push(jid);
    const totalC = def.items.reduce((s, i) => s + i[1] * i[2], 0);
    const c = clients[def.ci];

    let sql = `INSERT INTO jobs (id, org_id, created_by, client_id, title, description, client_name, property_address,
      status, scheduled_at, total_cents, total_amount, currency, notes)
    VALUES ('${jid}', '${ORG_ID}', '${USER_ID}', '${c.id}', '${esc(def.title)}', '[QA SEED] Job de test',
      '${esc(c.fn + " " + c.ln)}', '${esc(c.addr)}', '${def.status}',
      ${def.d !== null ? `'${timeSlot(def.d, def.h)}'` : 'NULL'},
      ${totalC}, ${totalC / 100}, 'CAD', '[QA SEED] Job de test');\n`;

    // Line items
    for (const [name, qty, price] of def.items) {
      sql += `INSERT INTO job_line_items (id, org_id, created_by, job_id, name, qty, unit_price_cents, total_cents)
        VALUES ('${uid()}', '${ORG_ID}', '${USER_ID}', '${jid}', '${esc(name)}', ${qty}, ${price}, ${qty * price});\n`;
      track('jobItems');
    }

    // Schedule event (calendar)
    if (def.d !== null && def.status !== 'unscheduled') {
      sql += `INSERT INTO schedule_events (id, org_id, created_by, job_id, start_time, end_time, notes)
        VALUES ('${uid()}', '${ORG_ID}', '${USER_ID}', '${jid}', '${timeSlot(def.d, def.h)}', '${timeSlotEnd(def.d, def.h, def.dur)}', '${esc(def.title)}');\n`;
      track('scheduleEvents');
    }

    await execSQL(sql);
    track('jobs');
  }

  console.log(`  ${stats.jobs} jobs, ${stats.jobItems} items, ${stats.scheduleEvents} calendar events`);

  // ══════════════════════════════════════════
  // INVOICES (6) + ITEMS
  // ══════════════════════════════════════════
  console.log('Creating invoices...');

  const seqInv = await execSQL(`SELECT last_value FROM invoice_sequences WHERE org_id = '${ORG_ID}'`);
  let invNum = (seqInv?.[0]?.last_value || 1) + 1;

  const invDefs = [
    { ci: 4, subject: '[QA] Nettoyage vitres — Roy', status: 'draft', due: 30,
      items: [['Nettoyage vitres ext. x12', 12, 3500], ['Nettoyage moustiquaires x12', 12, 1000]] },
    { ci: 6, subject: '[QA] Entretien commercial — Morin', status: 'sent', due: 15,
      items: [['Nettoyage bureau commercial', 1, 45000], ['Nettoyage tapis vapeur', 1, 22500]] },
    { ci: 1, subject: '[QA] Consultation revêtement — Gagnon', status: 'sent', due: -5,
      items: [['Consultation estimation', 1, 15000]] },
    { ci: 7, subject: '[QA] Peinture balcon — Bélanger', status: 'paid', due: -10,
      items: [['Peinture balcon avant', 1, 55000], ['Décapage revêtement', 1, 30000]] },
    { ci: 2, subject: '[QA] Dépôt lumières Noël — Bouchard', status: 'partial', due: 14,
      items: [['Installation lumières Noël (total)', 1, 141500]] },
    { ci: 3, subject: '[QA] Facture annulée — Côté', status: 'void', due: -20,
      items: [['Peinture intérieure (annulé)', 1, 175000]] },
  ];

  const invoiceIds = [];
  for (const def of invDefs) {
    const iid = uid();
    invoiceIds.push(iid);
    const sub = def.items.reduce((s, i) => s + i[1] * i[2], 0);
    const tax = Math.round(sub * 14.975 / 100);
    const total = sub + tax;
    // Insert invoices as 'sent' or 'draft' or 'void' — payments will update status to paid/partial
    const initialStatus = def.status === 'void' ? 'void' : (def.status === 'draft' ? 'draft' : 'sent');
    const invNumber = `INV-${String(invNum++).padStart(6, '0')}`;

    let sql = `INSERT INTO invoices (id, org_id, created_by, client_id, invoice_number, status, subject,
      issued_at, due_date, subtotal_cents, tax_cents, total_cents, paid_cents, balance_cents)
    VALUES ('${iid}', '${ORG_ID}', '${USER_ID}', '${clientIds[def.ci]}', '${invNumber}', '${initialStatus}',
      '${esc(def.subject)}', '${daysFromNow(def.due < 0 ? def.due - 15 : -5)}', '${dateOnly(def.due)}',
      ${sub}, ${tax}, ${total}, 0, ${total});\n`;

    for (const [desc, qty, price] of def.items) {
      sql += `INSERT INTO invoice_items (id, org_id, invoice_id, description, qty, unit_price_cents, line_total_cents)
        VALUES ('${uid()}', '${ORG_ID}', '${iid}', '${esc(desc)}', ${qty}, ${price}, ${qty * price});\n`;
      track('invoiceItems');
    }

    await execSQL(sql);
    track('invoices');
  }

  await execSQL(`UPDATE invoice_sequences SET last_value = ${invNum - 1}, updated_at = now() WHERE org_id = '${ORG_ID}'`);
  console.log(`  ${stats.invoices} invoices, ${stats.invoiceItems} items`);

  // ══════════════════════════════════════════
  // PAYMENTS (3)
  // ══════════════════════════════════════════
  console.log('Creating payments...');

  const paymentDefs = [];
  // Paid invoice (Bélanger)
  const paidInv = invDefs[3];
  const paidTotal = paidInv.items.reduce((s, i) => s + i[1] * i[2], 0);
  const paidTax = Math.round(paidTotal * 14.975 / 100);
  paymentDefs.push({ cid: clientIds[7], iid: invoiceIds[3], amount: paidTotal + paidTax, method: 'e-transfer', date: daysFromNow(-7) });

  // Partial invoice (Bouchard — 25%)
  const partialInv = invDefs[4];
  const partialTotal = partialInv.items.reduce((s, i) => s + i[1] * i[2], 0);
  const partialTax = Math.round(partialTotal * 14.975 / 100);
  paymentDefs.push({ cid: clientIds[2], iid: invoiceIds[4], amount: Math.round((partialTotal + partialTax) * 0.25), method: 'card', date: daysFromNow(-2) });

  // Standalone cash payment (Tremblay)
  paymentDefs.push({ cid: clientIds[0], iid: null, amount: 5000, method: 'cash', date: daysFromNow(-1) });

  let paySQL = `ALTER TABLE payments DISABLE TRIGGER trg_payments_enforce_scope;
    ALTER TABLE payments DISABLE TRIGGER trg_payment_to_invoice_paid;
    ALTER TABLE payments DISABLE TRIGGER trg_payments_recalculate_invoice;\n`;
  for (const p of paymentDefs) {
    paySQL += `INSERT INTO payments (id, org_id, created_by, client_id, invoice_id, provider, status, method, amount_cents, currency, payment_date)
      VALUES ('${uid()}', '${ORG_ID}', '${USER_ID}', '${p.cid}', ${p.iid ? `'${p.iid}'` : 'NULL'}, 'manual', 'succeeded', '${p.method}', ${p.amount}, 'CAD', '${p.date}');\n`;
    track('payments');
  }
  paySQL += `ALTER TABLE payments ENABLE TRIGGER trg_payments_enforce_scope;
    ALTER TABLE payments ENABLE TRIGGER trg_payment_to_invoice_paid;
    ALTER TABLE payments ENABLE TRIGGER trg_payments_recalculate_invoice;\n`;

  // Now update invoice paid_cents and status manually
  for (const inv of invDefs) {
    if (inv.status === 'paid' || inv.status === 'partial') {
      const idx = invDefs.indexOf(inv);
      const iid = invoiceIds[idx];
      const sub = inv.items.reduce((s, i) => s + i[1] * i[2], 0);
      const tax = Math.round(sub * 14.975 / 100);
      const total = sub + tax;
      const paid = inv.status === 'paid' ? total : Math.round(total * 0.25);
      paySQL += `UPDATE invoices SET paid_cents = ${paid}, balance_cents = ${total - paid}, status = '${inv.status}'${inv.status === 'paid' ? `, paid_at = '${daysFromNow(inv.due + 3)}'` : ''} WHERE id = '${iid}';\n`;
    }
  }
  await execSQL(paySQL);
  console.log(`  ${stats.payments} payments created`);

  // ══════════════════════════════════════════
  // SPECIFIC NOTES (6)
  // ══════════════════════════════════════════
  console.log('Creating notes...');
  const notesSQL = [
    `INSERT INTO specific_notes (org_id, entity_type, entity_id, text, created_by, files, tags) VALUES ('${ORG_ID}', 'client', '${clientIds[0]}', '[QA] Cliente fidèle depuis 2024. Toujours ponctuelle.', '${USER_ID}', '[]', '{}');`,
    `INSERT INTO specific_notes (org_id, entity_type, entity_id, text, created_by, files, tags) VALUES ('${ORG_ID}', 'client', '${clientIds[2]}', '[QA] Propriétaire de 3 immeubles. Potentiel contrats récurrents.', '${USER_ID}', '[]', '{}');`,
    `INSERT INTO specific_notes (org_id, entity_type, entity_id, text, created_by, files, tags) VALUES ('${ORG_ID}', 'job', '${jobIds[0]}', '[QA] Accès porte arrière. Code cadenas: 1234. Chien dans la cour.', '${USER_ID}', '[]', '{}');`,
    `INSERT INTO specific_notes (org_id, entity_type, entity_id, text, created_by, files, tags) VALUES ('${ORG_ID}', 'job', '${jobIds[3]}', '[QA] Travail complété. Client veut aussi nettoyage gouttières.', '${USER_ID}', '[]', '{}');`,
    `INSERT INTO specific_notes (org_id, entity_type, entity_id, text, created_by, files, tags) VALUES ('${ORG_ID}', 'quote', '${quoteIds[2]}', '[QA] Doit être fait avant le 15 décembre.', '${USER_ID}', '[]', '{}');`,
    `INSERT INTO specific_notes (org_id, entity_type, entity_id, text, created_by, files, tags) VALUES ('${ORG_ID}', 'quote', '${quoteIds[5]}', '[QA] Relancer semaine prochaine si pas de réponse.', '${USER_ID}', '[]', '{}');`,
  ].join('\n');
  await execSQL(notesSQL);
  track('notes', 6);
  console.log('  6 notes created');

  // ══════════════════════════════════════════
  // REPORT
  // ══════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  SEED COMPLETE');
  console.log('═══════════════════════════════════════════════════');
  Object.entries(stats).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  console.log('\n  Scénarios couverts:');
  console.log('  1. Client avec devis brouillon (Tremblay)');
  console.log('  2. Client avec devis envoyé (Gagnon)');
  console.log('  3. Client avec devis approuvé (Bouchard)');
  console.log('  4. Client avec devis décliné (Côté)');
  console.log('  5. Lead avec devis en attente (Fortin)');
  console.log('  6. Lead avec devis envoyé (Pelletier)');
  console.log('  7. Devis expiré (Roy)');
  console.log('  8. Devis converti en job (Lavoie)');
  console.log('  9. Job aujourd\'hui - en cours (Bouchard)');
  console.log('  10. Job demain - planifié (Tremblay)');
  console.log('  11. Job cette semaine (Lavoie)');
  console.log('  12. Job complété hier - pas facturé (Roy)');
  console.log('  13. Job complété - facturé (Morin)');
  console.log('  14. Job complété - payé (Bélanger)');
  console.log('  15. Job semaine prochaine (Gagnon)');
  console.log('  16. Job brouillon/non planifié (Côté)');
  console.log('  17. Job planifié passé dû (Tremblay)');
  console.log('  18. Facture brouillon (Roy)');
  console.log('  19. Facture envoyée (Morin)');
  console.log('  20. Facture en retard (Gagnon)');
  console.log('  21. Facture payée (Bélanger)');
  console.log('  22. Facture partiellement payée (Bouchard)');
  console.log('  23. Facture annulée (Côté)');
  console.log('  24. Paiement e-transfer (Bélanger)');
  console.log('  25. Paiement carte (Bouchard)');
  console.log('  26. Paiement cash standalone (Tremblay)');
  console.log('  27. Notes internes sur clients, jobs, devis');
  console.log('  28. 8 events calendrier (jobs planifiés)');
  console.log('  29. Clients avec multiple jobs (Tremblay: 2)');

  console.log('\n  Cleanup: node scripts/qa-cleanup.mjs');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
