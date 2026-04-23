import fs from 'fs';
import path from 'path';

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const ORG_SCOPED_TABLES = new Set([
  'invoices', 'quotes', 'jobs', 'clients', 'leads', 'conversations',
  'messages', 'payments', 'payment_requests', 'schedule_events',
  'notifications', 'tasks', 'expenses', 'time_entries', 'memberships',
  'job_line_items', 'invoice_items', 'teams', 'automations',
  'portal_tokens', 'workflows', 'deals', 'pipeline_deals',
  'team_availability', 'availabilities', 'review_requests',
  'email_templates', 'sms_opt_outs', 'org_features', 'field_territories',
  'field_houses', 'field_pins', 'field_sessions', 'survey_responses',
  'quote_templates', 'quote_views', 'quote_status_history',
  'courses', 'modules', 'lessons', 'course_progress', 'badges',
  'challenges', 'billing_profiles', 'subscriptions', 'plans',
  'connected_accounts', 'webhook_events', 'tax_configs', 'tax_groups',
]);

const files = walk('server');
const report = [];

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('getServiceClient()')) continue;
    const block = lines.slice(i, Math.min(i + 40, lines.length)).join('\n');
    const fromMatches = [...block.matchAll(/\.from\(['"](\w+)['"]\)/g)];
    for (const m of fromMatches) {
      const table = m[1];
      if (!ORG_SCOPED_TABLES.has(table)) continue;
      const tablePos = block.indexOf(m[0]);
      const chunk = block.slice(tablePos, tablePos + 1500);
      const hasOrg = /\.eq\(['"]org_id['"]/.test(chunk);
      const hasByIdOnly = /\.eq\(['"]id['"]/.test(chunk) && !hasOrg;
      if (!hasOrg) {
        report.push({ file: f, line: i + 1, table, byIdOnly: hasByIdOnly });
      }
    }
  }
}

const md = [
  '# getServiceClient() — queries without `.eq(org_id)` filter',
  '',
  `Generated ${new Date().toISOString()}`,
  '',
  'This is a heuristic audit: a getServiceClient() block in the same file',
  'may query several tables; we flag each org-scoped table seen in the',
  'next 40 lines without an `.eq("org_id", …)` clause. "by-id-only" means',
  'there is an `.eq("id", …)` in the same block — these are the highest',
  'priority: a service-role query that fetches a row by ID with no org',
  'check can, in theory, leak cross-org data if the ID is attacker-controlled.',
  '',
  '| File | Line | Table | By-ID-only? |',
  '|---|---:|---|:---:|',
];
for (const r of report) {
  md.push(`| ${r.file.replace(/\\/g, '/')} | ${r.line} | ${r.table} | ${r.byIdOnly ? 'yes' : 'no'} |`);
}
md.push('', `Total entries: ${report.length}`);
md.push(`By-ID-only entries (highest priority): ${report.filter(r => r.byIdOnly).length}`);

const outPath = '../audit/getServiceClient-orgfilter-audit.md';
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, md.join('\n'));
console.log(`Wrote ${outPath} with ${report.length} findings (${report.filter(r => r.byIdOnly).length} by-id-only)`);
