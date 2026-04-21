/**
 * apply-sql.ts — Apply SQL files to Supabase via the Management API.
 *
 * Usage:
 *   tsx scripts/apply-sql.ts <path-to-sql-file> [more-files...]
 *   tsx scripts/apply-sql.ts --dry-run <path-to-sql-file>
 *
 * Env (in .env.local, NEVER commit):
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx         (https://supabase.com/dashboard/account/tokens)
 *   SUPABASE_PROJECT_REF=bbzcuzqfgsdvjsymfwmr
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const token = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = process.env.SUPABASE_PROJECT_REF;

if (!token || !projectRef) {
  console.error('ERROR: SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required in .env.local');
  console.error('  Generate a token: https://supabase.com/dashboard/account/tokens');
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const files = args.filter(a => a !== '--dry-run');

if (files.length === 0) {
  console.error('Usage: tsx scripts/apply-sql.ts [--dry-run] <path-to-sql-file> [more-files...]');
  process.exit(1);
}

async function runQuery(sql: string): Promise<unknown> {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    }
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  try { return JSON.parse(text); } catch { return text; }
}

(async () => {
  for (const filePath of files) {
    const abs = resolve(filePath);
    const sql = readFileSync(abs, 'utf8');
    const lines = sql.split('\n').length;
    const bytes = Buffer.byteLength(sql, 'utf8');
    console.log(`\n━━━ ${filePath} (${lines} lines, ${bytes} bytes) ━━━`);

    if (dryRun) {
      console.log('[dry-run] would POST to Management API');
      continue;
    }

    try {
      const result = await runQuery(sql);
      console.log('✓ applied');
      if (Array.isArray(result) && result.length > 0) {
        console.log('  result:', JSON.stringify(result, null, 2).slice(0, 800));
      }
    } catch (err) {
      console.error('✗ FAILED:', (err as Error).message);
      process.exit(1);
    }
  }
  console.log('\nAll files applied.');
})();
