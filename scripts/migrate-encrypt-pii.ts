#!/usr/bin/env npx tsx
/**
 * PII Encryption Migration Script
 * ================================
 * Encrypts existing plaintext PII fields (email, phone, address) in the database.
 *
 * This is a ONE-TIME migration. Run it after setting PII_ENCRYPTION_KEY in .env.local.
 * It's idempotent — already-encrypted rows (prefixed with "enc:") are skipped.
 *
 * Usage:
 *   npx tsx scripts/migrate-encrypt-pii.ts
 *   npx tsx scripts/migrate-encrypt-pii.ts --dry-run   # Preview without writing
 *
 * Tables migrated:
 *   - clients (email, phone, address)
 *   - leads (email, phone, address)
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { encryptPii, isEncrypted } from '../server/lib/pii-crypto';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 100;

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('FATAL: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  process.exit(1);
}

if (!process.env.PII_ENCRYPTION_KEY && !process.env.PAYMENTS_ENCRYPTION_KEY) {
  console.error('FATAL: PII_ENCRYPTION_KEY or PAYMENTS_ENCRYPTION_KEY must be set');
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface MigrationResult {
  table: string;
  total: number;
  encrypted: number;
  skipped: number;
  errors: number;
}

const PII_FIELDS = ['email', 'phone', 'address'] as const;

async function migrateTable(table: string): Promise<MigrationResult> {
  const result: MigrationResult = { table, total: 0, encrypted: 0, skipped: 0, errors: 0 };

  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: rows, error } = await admin
      .from(table)
      .select('id, email, phone, address')
      .range(offset, offset + BATCH_SIZE - 1)
      .order('id');

    if (error) {
      console.error(`[${table}] Query error at offset ${offset}:`, error.message);
      result.errors++;
      break;
    }

    if (!rows || rows.length === 0) {
      hasMore = false;
      break;
    }

    for (const row of rows) {
      result.total++;

      // Build update payload — only encrypt non-null, non-empty, non-encrypted fields
      const updates: Record<string, string> = {};
      for (const field of PII_FIELDS) {
        const value = row[field];
        if (typeof value === 'string' && value.length > 0 && !isEncrypted(value)) {
          const encrypted = encryptPii(value);
          if (encrypted && encrypted !== value) {
            updates[field] = encrypted;
          }
        }
      }

      if (Object.keys(updates).length === 0) {
        result.skipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`[DRY RUN] ${table}/${row.id}: would encrypt ${Object.keys(updates).join(', ')}`);
        result.encrypted++;
        continue;
      }

      const { error: updateErr } = await admin
        .from(table)
        .update(updates)
        .eq('id', row.id);

      if (updateErr) {
        console.error(`[${table}] Failed to update ${row.id}:`, updateErr.message);
        result.errors++;
      } else {
        result.encrypted++;
      }
    }

    offset += BATCH_SIZE;
    if (rows.length < BATCH_SIZE) hasMore = false;
  }

  return result;
}

async function main() {
  console.log('='.repeat(60));
  console.log('PII Encryption Migration');
  console.log(DRY_RUN ? '*** DRY RUN MODE — no changes will be written ***' : '*** LIVE MODE — encrypting data ***');
  console.log('='.repeat(60));
  console.log();

  const tables = ['clients', 'leads'];
  const results: MigrationResult[] = [];

  for (const table of tables) {
    console.log(`Migrating ${table}...`);
    const result = await migrateTable(table);
    results.push(result);
    console.log(`  Total: ${result.total} | Encrypted: ${result.encrypted} | Skipped: ${result.skipped} | Errors: ${result.errors}`);
    console.log();
  }

  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  for (const r of results) {
    console.log(`${r.table.padEnd(15)} total=${r.total} encrypted=${r.encrypted} skipped=${r.skipped} errors=${r.errors}`);
  }

  const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);
  if (totalErrors > 0) {
    console.error(`\nWARNING: ${totalErrors} errors occurred. Review logs and re-run.`);
    process.exit(1);
  }

  console.log('\nMigration complete.');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
