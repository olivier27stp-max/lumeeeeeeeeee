#!/usr/bin/env npx tsx
/**
 * Reverse PII Encryption Migration
 * ==================================
 * Decrypts all encrypted PII fields back to plaintext in the database.
 *
 * WHY: Application-level encryption of emails/phones/addresses is incompatible
 * with the CRM's architecture where the frontend queries Supabase directly.
 * The frontend has no access to the encryption key, so encrypted values
 * show as `enc:...` in the UI.
 *
 * SECURITY MODEL AFTER THIS:
 * - Supabase provides encryption at rest (AES-256 at disk level via AWS)
 * - Row-Level Security (RLS) enforces org_id isolation
 * - HTTPS encrypts data in transit
 * - Application-level encryption remains for PAYMENT secrets (Stripe/PayPal keys)
 *   which are only accessed server-side via Express, never by the frontend
 *
 * Usage:
 *   npx tsx scripts/reverse-pii-encryption.ts --dry-run
 *   npx tsx scripts/reverse-pii-encryption.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { decryptPii, isEncrypted } from '../server/lib/pii-crypto';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 100;

const admin = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PII_FIELDS = ['email', 'phone', 'address'] as const;

interface MigrationResult {
  table: string;
  total: number;
  decrypted: number;
  skipped: number;
  errors: number;
}

async function reverseTable(table: string): Promise<MigrationResult> {
  const result: MigrationResult = { table, total: 0, decrypted: 0, skipped: 0, errors: 0 };

  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: rows, error } = await admin
      .from(table)
      .select('id, email, phone, address')
      .range(offset, offset + BATCH_SIZE - 1)
      .order('id');

    if (error) {
      console.error(`[${table}] Query error:`, error.message);
      result.errors++;
      break;
    }

    if (!rows || rows.length === 0) { hasMore = false; break; }

    for (const row of rows) {
      result.total++;

      const updates: Record<string, string> = {};
      for (const field of PII_FIELDS) {
        const value = row[field];
        if (typeof value === 'string' && isEncrypted(value)) {
          const decrypted = decryptPii(value);
          if (decrypted && decrypted !== value && !decrypted.startsWith('[')) {
            updates[field] = decrypted;
          }
        }
      }

      if (Object.keys(updates).length === 0) {
        result.skipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`[DRY RUN] ${table}/${row.id}: would decrypt ${Object.keys(updates).join(', ')} → ${Object.values(updates).join(', ')}`);
        result.decrypted++;
        continue;
      }

      const { error: updateErr } = await admin.from(table).update(updates).eq('id', row.id);
      if (updateErr) {
        console.error(`[${table}] Failed to update ${row.id}:`, updateErr.message);
        result.errors++;
      } else {
        result.decrypted++;
      }
    }

    offset += BATCH_SIZE;
    if (rows.length < BATCH_SIZE) hasMore = false;
  }

  return result;
}

async function main() {
  console.log('='.repeat(60));
  console.log('PII Encryption REVERSAL');
  console.log(DRY_RUN ? '*** DRY RUN MODE ***' : '*** LIVE MODE — decrypting back to plaintext ***');
  console.log('='.repeat(60));
  console.log();

  const tables = ['clients', 'leads'];
  const results: MigrationResult[] = [];

  for (const table of tables) {
    console.log(`Reversing ${table}...`);
    const r = await reverseTable(table);
    results.push(r);
    console.log(`  Total: ${r.total} | Decrypted: ${r.decrypted} | Skipped: ${r.skipped} | Errors: ${r.errors}`);
    console.log();
  }

  console.log('='.repeat(60));
  console.log('SUMMARY');
  for (const r of results) {
    console.log(`${r.table.padEnd(15)} total=${r.total} decrypted=${r.decrypted} skipped=${r.skipped} errors=${r.errors}`);
  }

  const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);
  if (totalErrors > 0) {
    console.error(`\nWARNING: ${totalErrors} errors occurred.`);
    process.exit(1);
  }
  console.log('\nReversal complete. PII is now plaintext (protected by Supabase encryption at rest + RLS).');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
