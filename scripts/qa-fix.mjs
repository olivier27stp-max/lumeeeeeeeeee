/**
 * QA FIX — Fix all data inconsistencies in test data
 */

const TOKEN = 'sbp_70d8ff687c60f2afeb73c8c6d4f59725d3cda70e';
const PROJECT = 'bbzcuzqfgsdvjsymfwmr';
const ORG_ID = '4d885f6c-e076-4ed9-ab09-23637dbee6cd';

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  return await r.json();
}

async function main() {
  console.log('=== QA DATA FIX ===\n');

  // 1. Fix void invoice balance → 0
  console.log('1. Void invoice balance...');
  await q(`UPDATE invoices SET balance_cents = 0 WHERE subject LIKE '[QA]%' AND status = 'void'`);
  console.log('   Fixed');

  // 2. Link converted quote → job
  console.log('2. Linking converted quote to job...');
  const qConv = await q(`SELECT id FROM quotes WHERE title LIKE '[QA]%' AND status = 'converted'`);
  const jGarde = await q(`SELECT id FROM jobs WHERE title LIKE '[QA] Garde-gouttières%'`);
  if (qConv?.[0]?.id && jGarde?.[0]?.id) {
    await q(`UPDATE quotes SET job_id = '${jGarde[0].id}' WHERE id = '${qConv[0].id}'`);
    console.log('   Quote converted → Job Garde-gouttières linked');
  }

  // 3. Link approved quote (Bouchard lumières) → job installation
  console.log('3. Linking approved quote to job...');
  const qAppr = await q(`SELECT id FROM quotes WHERE title LIKE '[QA] Lumières de Noël%'`);
  const jLum = await q(`SELECT id FROM jobs WHERE title LIKE '[QA] Installation lumières%'`);
  if (qAppr?.[0]?.id && jLum?.[0]?.id) {
    await q(`UPDATE quotes SET job_id = '${jLum[0].id}' WHERE id = '${qAppr[0].id}'`);
    console.log('   Quote Bouchard → Job Installation lumières linked');
  }

  // 4. Check if invoices table has job_id column
  const jobIdCol = await q(`SELECT column_name FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'job_id'`);
  const hasJobId = jobIdCol?.length > 0;
  console.log('4. Invoices job_id column:', hasJobId ? 'EXISTS' : 'NOT FOUND');

  if (hasJobId) {
    // Link Invoice Morin → Job Morin
    const jMorin = await q(`SELECT id FROM jobs WHERE title LIKE '[QA] Entretien commercial — Morin%'`);
    const iMorin = await q(`SELECT id FROM invoices WHERE subject LIKE '[QA] Entretien commercial — Morin%'`);
    if (jMorin?.[0] && iMorin?.[0]) {
      await q(`UPDATE invoices SET job_id = '${jMorin[0].id}' WHERE id = '${iMorin[0].id}'`);
      console.log('   Invoice Morin → Job Morin');
    }

    // Link Invoice Bélanger → Job Bélanger
    const jBel = await q(`SELECT id FROM jobs WHERE title LIKE '[QA] Peinture balcon%'`);
    const iBel = await q(`SELECT id FROM invoices WHERE subject LIKE '[QA] Peinture balcon%'`);
    if (jBel?.[0] && iBel?.[0]) {
      await q(`UPDATE invoices SET job_id = '${jBel[0].id}' WHERE id = '${iBel[0].id}'`);
      console.log('   Invoice Bélanger → Job Bélanger');
    }

    // Link Invoice Roy → Job Roy
    const jRoy = await q(`SELECT id FROM jobs WHERE title LIKE '[QA] Nettoyage vitres%'`);
    const iRoy = await q(`SELECT id FROM invoices WHERE subject LIKE '[QA] Nettoyage vitres%'`);
    if (jRoy?.[0] && iRoy?.[0]) {
      await q(`UPDATE invoices SET job_id = '${jRoy[0].id}' WHERE id = '${iRoy[0].id}'`);
      console.log('   Invoice Roy → Job Roy');
    }
  }

  // 5. Verify all quote totals (subtotal = sum of non-optional items)
  console.log('5. Verifying quote totals...');
  const qtotals = await q(`
    SELECT q.id, q.quote_number, q.subtotal_cents,
      COALESCE((SELECT sum(total_cents) FROM quote_line_items WHERE quote_id = q.id AND is_optional = false), 0) as calc_sub
    FROM quotes q WHERE q.title LIKE '[QA]%' ORDER BY q.quote_number
  `);
  let qFixes = 0;
  for (const qt of (qtotals || [])) {
    if (Number(qt.subtotal_cents) !== Number(qt.calc_sub)) {
      const tax = Math.round(Number(qt.calc_sub) * 14.975 / 100);
      const total = Number(qt.calc_sub) + tax;
      await q(`UPDATE quotes SET subtotal_cents = ${qt.calc_sub}, tax_cents = ${tax}, total_cents = ${total} WHERE id = '${qt.id}'`);
      console.log(`   Fixed #${qt.quote_number}: ${qt.subtotal_cents} → ${qt.calc_sub}`);
      qFixes++;
    }
  }
  if (qFixes === 0) console.log('   All correct');

  // 6. Verify all invoice totals
  console.log('6. Verifying invoice totals...');
  const itotals = await q(`
    SELECT i.id, i.invoice_number, i.subtotal_cents, i.paid_cents,
      COALESCE((SELECT sum(line_total_cents) FROM invoice_items WHERE invoice_id = i.id), 0) as calc_sub
    FROM invoices i WHERE i.subject LIKE '[QA]%' ORDER BY i.invoice_number
  `);
  let iFixes = 0;
  for (const it of (itotals || [])) {
    if (Number(it.subtotal_cents) !== Number(it.calc_sub)) {
      const tax = Math.round(Number(it.calc_sub) * 14.975 / 100);
      const total = Number(it.calc_sub) + tax;
      const paid = Number(it.paid_cents);
      await q(`UPDATE invoices SET subtotal_cents = ${it.calc_sub}, tax_cents = ${tax}, total_cents = ${total}, balance_cents = ${total - paid} WHERE id = '${it.id}'`);
      console.log(`   Fixed ${it.invoice_number}: ${it.subtotal_cents} → ${it.calc_sub}`);
      iFixes++;
    }
  }
  if (iFixes === 0) console.log('   All correct');

  // 7. Verify all job totals
  console.log('7. Verifying job totals...');
  const jtotals = await q(`
    SELECT j.id, j.title, j.total_cents,
      COALESCE((SELECT sum(total_cents) FROM job_line_items WHERE job_id = j.id), 0) as calc
    FROM jobs j WHERE j.title LIKE '[QA]%'
  `);
  let jFixes = 0;
  for (const jt of (jtotals || [])) {
    if (Number(jt.total_cents) !== Number(jt.calc)) {
      await q(`UPDATE jobs SET total_cents = ${jt.calc}, total_amount = ${Number(jt.calc) / 100} WHERE id = '${jt.id}'`);
      console.log(`   Fixed: ${jt.title.substring(0, 35)}`);
      jFixes++;
    }
  }
  if (jFixes === 0) console.log('   All correct');

  // 8. Verify payment-invoice sync
  console.log('8. Payment-invoice sync...');
  const psync = await q(`
    SELECT i.id, i.invoice_number, i.paid_cents, i.status,
      COALESCE((SELECT sum(amount_cents) FROM payments WHERE invoice_id = i.id AND status = 'succeeded'), 0) as pay_sum
    FROM invoices i WHERE i.subject LIKE '[QA]%' AND i.status IN ('paid', 'partial')
  `);
  for (const p of (psync || [])) {
    if (Number(p.paid_cents) !== Number(p.pay_sum)) {
      console.log(`   FIXING ${p.invoice_number}: paid=${p.paid_cents} payments=${p.pay_sum}`);
      await q(`UPDATE invoices SET paid_cents = ${p.pay_sum}, balance_cents = total_cents - ${p.pay_sum} WHERE id = '${p.id}'`);
    }
  }
  console.log('   Synced');

  // 9. Final verification
  console.log('\n=== FINAL VERIFICATION ===');
  const final = await q(`
    SELECT 'clients' as t, count(*) as c FROM clients WHERE first_name LIKE '[QA]%'
    UNION ALL SELECT 'leads', count(*) FROM leads WHERE first_name LIKE '[QA]%'
    UNION ALL SELECT 'quotes', count(*) FROM quotes WHERE title LIKE '[QA]%'
    UNION ALL SELECT 'jobs', count(*) FROM jobs WHERE title LIKE '[QA]%'
    UNION ALL SELECT 'invoices', count(*) FROM invoices WHERE subject LIKE '[QA]%'
    UNION ALL SELECT 'payments', count(*) FROM payments WHERE org_id = '${ORG_ID}'
    UNION ALL SELECT 'calendar', count(*) FROM schedule_events WHERE notes LIKE '[QA]%'
    UNION ALL SELECT 'notes', count(*) FROM specific_notes WHERE text LIKE '[QA]%'
  `);
  final?.forEach(r => console.log(`  ${r.t}: ${r.c}`));

  // Quote-Job links
  const links = await q(`SELECT q.quote_number, q.status, j.title as job_title FROM quotes q LEFT JOIN jobs j ON q.job_id = j.id WHERE q.title LIKE '[QA]%' AND q.job_id IS NOT NULL`);
  console.log('\nQuote→Job links:');
  links?.forEach(l => console.log(`  #${l.quote_number} (${l.status}) → ${l.job_title}`));

  // Invoice details
  const invFinal = await q(`SELECT invoice_number, status, total_cents, paid_cents, balance_cents FROM invoices WHERE subject LIKE '[QA]%' ORDER BY invoice_number`);
  console.log('\nInvoices:');
  invFinal?.forEach(i => console.log(`  ${i.invoice_number} | ${i.status.padEnd(8)} | total:${i.total_cents} paid:${i.paid_cents} bal:${i.balance_cents}`));

  console.log('\n=== ALL DONE ===');
}

main().catch(e => console.error('FATAL:', e));
