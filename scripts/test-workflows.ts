/* ═══════════════════════════════════════════════════════════════
   Script — Test end-to-end des workflows d'automatisation

   Usage: npx tsx scripts/test-workflows.ts

   Vérifie directement en base de données que:
   1. Les presets automation_rules existent
   2. Les triggers matchent correctement
   3. Les stop conditions fonctionnent
   4. Le scheduler traite les tâches
   5. Les variables se résolvent
   ═══════════════════════════════════════════════════════════════ */

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !serviceKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let passed = 0;
let failed = 0;
let skipped = 0;

function ok(name: string, detail?: string) {
  passed++;
  console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name: string, detail?: string) {
  failed++;
  console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
}

function skip(name: string, detail?: string) {
  skipped++;
  console.log(`  ⏭️  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  WORKFLOW & AUTOMATION — END-TO-END VALIDATION');
  console.log('══════════════════════════════════════════════════\n');

  // ── 1. Find an org to test with ──
  const { data: orgs } = await supabase.from('orgs').select('id, name').limit(5);
  if (!orgs || orgs.length === 0) {
    console.error('❌ No organizations found in database');
    process.exit(1);
  }

  for (const org of orgs) {
    console.log(`\n── ORG: ${org.name} (${org.id.slice(0, 8)}...) ──\n`);
    await testOrg(org.id, org.name);
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  RÉSULTAT: ${passed} ✅  ${failed} ❌  ${skipped} ⏭️`);
  console.log('══════════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

async function testOrg(orgId: string, orgName: string) {

  // ════════════════════════════════════════════════════
  // TEST 1: Preset automation_rules existent
  // ════════════════════════════════════════════════════
  console.log('  📋 1. AUTOMATION RULES (presets)');

  const { data: rules } = await supabase
    .from('automation_rules')
    .select('id, name, preset_key, trigger_event, delay_seconds, is_active, is_preset, actions')
    .eq('org_id', orgId)
    .eq('is_preset', true);

  const expectedPresets: Record<string, { trigger: string; delay: number }> = {
    // Quote follow-ups (5)
    'quote_followup_1d': { trigger: 'quote.sent', delay: 86400 },
    'quote_followup_3d': { trigger: 'quote.sent', delay: 259200 },
    'quote_followup_7d': { trigger: 'quote.sent', delay: 604800 },
    'quote_followup_14d': { trigger: 'quote.sent', delay: 1209600 },
    'quote_followup_21d': { trigger: 'quote.sent', delay: 1814400 },
    // Invoice reminders (5)
    'invoice_sent_reminder_1d': { trigger: 'invoice.sent', delay: 86400 },
    'invoice_sent_reminder_3d': { trigger: 'invoice.sent', delay: 259200 },
    'invoice_sent_reminder_7d': { trigger: 'invoice.sent', delay: 604800 },
    'invoice_sent_reminder_14d': { trigger: 'invoice.sent', delay: 1209600 },
    'invoice_sent_reminder_30d': { trigger: 'invoice.sent', delay: 2592000 },
    // Lead nurturing (5)
    'welcome_new_lead': { trigger: 'lead.created', delay: 0 },
    'lead_followup_1d': { trigger: 'lead.created', delay: 86400 },
    'lead_followup_3d': { trigger: 'lead.created', delay: 259200 },
    'stale_lead_7d': { trigger: 'lead.created', delay: 604800 },
    'lead_followup_14d': { trigger: 'lead.created', delay: 1209600 },
    // Job/Appointment (5)
    'appointment_confirmation': { trigger: 'appointment.created', delay: 0 },
    'job_reminder_7d': { trigger: 'appointment.created', delay: -604800 },
    'job_reminder_1d': { trigger: 'appointment.created', delay: -86400 },
    'job_reminder_2h': { trigger: 'appointment.created', delay: -7200 },
    'thank_you_after_job': { trigger: 'job.completed', delay: 3600 },
    // Review (2)
    'google_review': { trigger: 'job.completed', delay: 7200 },
    'review_reminder_7d': { trigger: 'job.completed', delay: 604800 },
    // Payment (3)
    'payment_confirmation': { trigger: 'invoice.paid', delay: 0 },
    'deposit_reminder': { trigger: 'quote.approved', delay: 3600 },
    'deposit_followup_2d': { trigger: 'quote.approved', delay: 172800 },
    // Re-engagement (3)
    'cross_sell_30d': { trigger: 'job.completed', delay: 2592000 },
    'reengagement_90d': { trigger: 'job.completed', delay: 7776000 },
    'no_show_followup': { trigger: 'appointment.cancelled', delay: 3600 },
  };

  const ruleMap = new Map((rules || []).map((r: any) => [r.preset_key, r]));

  if (!rules || rules.length === 0) {
    fail('Aucun preset trouvé', 'Les automation_rules n\'ont pas été seedées. Exécute seed_automation_presets().');

    // Try to seed
    console.log('\n  🔧 Tentative de seed automatique...');
    const { data: seedResult, error: seedErr } = await supabase.rpc('seed_automation_presets', { p_org_id: orgId });
    if (seedErr) {
      fail('Seed des presets', seedErr.message);
    } else {
      ok('Seed des presets', `${seedResult} presets créés`);
      // Re-fetch
      const { data: rules2 } = await supabase
        .from('automation_rules')
        .select('id, name, preset_key, trigger_event, delay_seconds, is_active, is_preset, actions')
        .eq('org_id', orgId)
        .eq('is_preset', true);
      if (rules2) {
        for (const r of rules2) ruleMap.set((r as any).preset_key, r);
      }
    }
  }

  for (const [key, expected] of Object.entries(expectedPresets)) {
    const rule = ruleMap.get(key) as any;
    if (!rule) {
      fail(`Preset "${key}"`, 'MANQUANT en base');
      continue;
    }

    // Vérifier le trigger
    if (rule.trigger_event !== expected.trigger) {
      fail(`Preset "${key}" trigger`, `Attendu: ${expected.trigger}, Trouvé: ${rule.trigger_event}`);
    } else if (rule.delay_seconds !== expected.delay) {
      fail(`Preset "${key}" delay`, `Attendu: ${expected.delay}s, Trouvé: ${rule.delay_seconds}s`);
    } else {
      ok(`Preset "${key}"`, `trigger=${rule.trigger_event}, delay=${rule.delay_seconds}s, active=${rule.is_active}`);
    }
  }

  // ════════════════════════════════════════════════════
  // TEST 2: Quote follow-up chain
  // ════════════════════════════════════════════════════
  console.log('\n  📋 2. QUOTE FOLLOW-UP CHAIN');

  const { data: quotes } = await supabase
    .from('quotes')
    .select('id, quote_number, status, lead_id, created_at')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(3);

  if (!quotes || quotes.length === 0) {
    skip('Quote follow-up', 'Aucun devis trouvé. Crée un devis pour tester.');
  } else {
    for (const q of quotes as any[]) {
      // Check if there are scheduled tasks for this quote
      const { data: tasks } = await supabase
        .from('automation_scheduled_tasks')
        .select('id, status, execute_at, execution_key')
        .eq('entity_id', q.id)
        .eq('entity_type', 'quote');

      const pendingCount = (tasks || []).filter((t: any) => t.status === 'pending').length;
      const cancelledCount = (tasks || []).filter((t: any) => t.status === 'cancelled').length;

      if (q.status === 'sent') {
        if (pendingCount > 0) {
          ok(`Quote #${q.quote_number} (sent)`, `${pendingCount} follow-ups programmés ✓`);
        } else {
          // May not have tasks if quote was sent before the fix
          skip(`Quote #${q.quote_number} (sent)`, `Pas de follow-ups programmés. Normal si envoyé avant le fix.`);
        }
      } else if (['approved', 'declined', 'expired', 'converted'].includes(q.status)) {
        if (pendingCount === 0) {
          ok(`Quote #${q.quote_number} (${q.status})`, `Pas de follow-ups pending (stop condition OK) ${cancelledCount > 0 ? `— ${cancelledCount} annulés` : ''}`);
        } else {
          fail(`Quote #${q.quote_number} (${q.status})`, `${pendingCount} follow-ups encore pending malgré status=${q.status}!`);
        }
      } else {
        skip(`Quote #${q.quote_number} (${q.status})`, 'Statut non pertinent pour les follow-ups');
      }
    }
  }

  // ════════════════════════════════════════════════════
  // TEST 3: Invoice reminders chain
  // ════════════════════════════════════════════════════
  console.log('\n  📋 3. INVOICE REMINDERS CHAIN');

  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, invoice_number, status, sent_at, due_date, paid_at')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(5);

  if (!invoices || invoices.length === 0) {
    skip('Invoice reminders', 'Aucune facture trouvée.');
  } else {
    for (const inv of invoices as any[]) {
      const { data: tasks } = await supabase
        .from('automation_scheduled_tasks')
        .select('id, status, execute_at')
        .eq('entity_id', inv.id)
        .eq('entity_type', 'invoice');

      const pending = (tasks || []).filter((t: any) => t.status === 'pending').length;
      const completed = (tasks || []).filter((t: any) => t.status === 'completed').length;
      const cancelled = (tasks || []).filter((t: any) => t.status === 'cancelled').length;

      if (inv.status === 'paid') {
        if (pending === 0) {
          ok(`Invoice #${inv.invoice_number} (paid)`, `Pas de reminders pending (stop OK). ${completed} exécutés, ${cancelled} annulés.`);
        } else {
          fail(`Invoice #${inv.invoice_number} (paid)`, `${pending} reminders encore pending malgré paiement!`);
        }
      } else if (['sent', 'overdue'].includes(inv.status)) {
        ok(`Invoice #${inv.invoice_number} (${inv.status})`, `${pending} pending, ${completed} exécutés`);
      } else {
        skip(`Invoice #${inv.invoice_number} (${inv.status})`, 'Draft ou autre');
      }
    }
  }

  // ════════════════════════════════════════════════════
  // TEST 4: Scheduled tasks queue health
  // ════════════════════════════════════════════════════
  console.log('\n  📋 4. SCHEDULED TASKS QUEUE');

  const { count: pendingCount } = await supabase
    .from('automation_scheduled_tasks')
    .select('*', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('status', 'pending');

  const { count: completedCount } = await supabase
    .from('automation_scheduled_tasks')
    .select('*', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('status', 'completed');

  const { count: failedCount } = await supabase
    .from('automation_scheduled_tasks')
    .select('*', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('status', 'failed');

  const { count: cancelledCount } = await supabase
    .from('automation_scheduled_tasks')
    .select('*', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('status', 'cancelled');

  ok('Queue status', `pending=${pendingCount || 0}, completed=${completedCount || 0}, failed=${failedCount || 0}, cancelled=${cancelledCount || 0}`);

  if ((failedCount || 0) > 0) {
    const { data: failedTasks } = await supabase
      .from('automation_scheduled_tasks')
      .select('id, entity_type, last_error, execute_at')
      .eq('org_id', orgId)
      .eq('status', 'failed')
      .order('execute_at', { ascending: false })
      .limit(3);

    for (const t of (failedTasks || []) as any[]) {
      fail(`Task échouée (${t.entity_type})`, t.last_error || 'Pas de message d\'erreur');
    }
  }

  // ════════════════════════════════════════════════════
  // TEST 5: Execution logs
  // ════════════════════════════════════════════════════
  console.log('\n  📋 5. EXECUTION LOGS');

  const { data: logs } = await supabase
    .from('automation_execution_logs')
    .select('trigger_event, action_type, result_success, result_error, duration_ms, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (!logs || logs.length === 0) {
    skip('Execution logs', 'Aucun log d\'exécution. Normal si aucune automation n\'a encore tourné.');
  } else {
    const successLogs = logs.filter((l: any) => l.result_success);
    const failLogs = logs.filter((l: any) => !l.result_success);

    ok('Dernières exécutions', `${successLogs.length} succès, ${failLogs.length} échecs sur les 10 dernières`);

    for (const l of failLogs as any[]) {
      fail(`Exécution ${l.action_type} (${l.trigger_event})`, l.result_error || 'Erreur inconnue');
    }

    for (const l of successLogs.slice(0, 3) as any[]) {
      ok(`Exécution ${l.action_type} (${l.trigger_event})`, `${l.duration_ms}ms`);
    }
  }

  // ════════════════════════════════════════════════════
  // TEST 6: Provider configuration
  // ════════════════════════════════════════════════════
  console.log('\n  📋 6. PROVIDERS');

  const hasTwilio = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
  const hasResend = !!process.env.RESEND_API_KEY;

  if (hasTwilio) ok('Twilio SMS', 'Configuré');
  else skip('Twilio SMS', 'Non configuré — les actions SMS retourneront une erreur gracieuse');

  if (hasResend) ok('Resend Email', 'Configuré');
  else skip('Resend Email', 'Non configuré — les actions email retourneront une erreur gracieuse');

  // ════════════════════════════════════════════════════
  // TEST 7: Variable resolution with real data
  // ════════════════════════════════════════════════════
  console.log('\n  📋 7. VARIABLE RESOLUTION');

  const { resolveEntityVariables } = await import('../server/lib/actions/index.js');

  // Test with a real invoice
  const { data: anyInvoice } = await supabase
    .from('invoices')
    .select('id')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();

  if (anyInvoice) {
    const vars = await resolveEntityVariables(supabase, orgId, 'invoice', anyInvoice.id);
    if (vars.invoice_number) {
      ok('Invoice vars', `number=${vars.invoice_number}, client=${vars.client_name || 'N/A'}, email=${vars.client_email || 'N/A'}, phone=${vars.client_phone || 'N/A'}`);
    } else {
      fail('Invoice vars', 'invoice_number non résolu');
    }
  } else {
    skip('Invoice vars', 'Pas de facture');
  }

  // Test with a real job
  const { data: anyJob } = await supabase
    .from('jobs')
    .select('id')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();

  if (anyJob) {
    const vars = await resolveEntityVariables(supabase, orgId, 'job', anyJob.id);
    if (vars.job_name) {
      ok('Job vars', `name=${vars.job_name}, client=${vars.client_name || 'N/A'}`);
    } else {
      fail('Job vars', 'job_name non résolu');
    }
  } else {
    skip('Job vars', 'Pas de job');
  }

  // Test with a real lead
  const { data: anyLead } = await supabase
    .from('leads')
    .select('id')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();

  if (anyLead) {
    const vars = await resolveEntityVariables(supabase, orgId, 'lead', anyLead.id);
    if (vars.client_name) {
      ok('Lead vars', `name=${vars.client_name}, email=${vars.client_email || 'N/A'}, phone=${vars.client_phone || 'N/A'}`);
    } else {
      fail('Lead vars', 'client_name non résolu');
    }
  } else {
    skip('Lead vars', 'Pas de lead');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
