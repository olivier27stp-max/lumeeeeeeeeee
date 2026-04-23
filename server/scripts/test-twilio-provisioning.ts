/**
 * Test script: simulate Twilio number auto-provisioning end-to-end.
 *
 * Usage:
 *   npx tsx server/scripts/test-twilio-provisioning.ts <orgId>
 *
 * What it does:
 *   1. Reads TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN from process.env (.env.local)
 *   2. Loads the org's address (country/city/region/postal_code) from Supabase
 *   3. Resolves the area code from that address (Montréal → 514, NYC → 212, etc.)
 *   4. Searches Twilio for an available SMS-capable number matching the area code
 *   5. Purchases it and writes a row to communication_channels
 *
 * Safe to run multiple times — skips if an active SMS channel already exists.
 *
 * Cost: ~$1 USD per number purchased. Use a test orgId.
 */

import 'dotenv/config';
import { provisionSmsNumber, getOrgSmsChannel } from '../lib/twilioProvisioning';
import { twilioClient } from '../lib/config';
import { getServiceClient } from '../lib/supabase';

async function main() {
  const orgId = process.argv[2];
  if (!orgId) {
    console.error('Usage: npx tsx server/scripts/test-twilio-provisioning.ts <orgId>');
    process.exit(1);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Twilio auto-provisioning test');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // ── 1. Sanity check Twilio credentials
  if (!twilioClient) {
    console.error('❌ Twilio client is null. Check that TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are set in .env.local.');
    console.error('   Account SID must start with "AC".');
    process.exit(1);
  }
  console.log('✅ Twilio client initialized');

  // ── 2. Load org info
  const admin = getServiceClient();
  const { data: org, error } = await admin
    .from('orgs')
    .select('id, name, country, region, city, postal_code')
    .eq('id', orgId)
    .maybeSingle();

  if (error) {
    console.error('❌ Failed to load org:', error.message);
    process.exit(1);
  }
  if (!org) {
    console.error(`❌ Org ${orgId} not found.`);
    process.exit(1);
  }

  console.log(`✅ Org loaded: ${org.name}`);
  console.log(`   Country: ${org.country || '(empty)'}`);
  console.log(`   Region:  ${org.region || '(empty)'}`);
  console.log(`   City:    ${org.city || '(empty)'}`);
  console.log(`   Postal:  ${org.postal_code || '(empty)'}`);

  if (!org.country && !org.city && !org.postal_code) {
    console.warn('⚠️  Org has no address data — Twilio will pick a number anywhere in the default country (CA).');
  }

  // ── 3. Idempotency check
  const existing = await getOrgSmsChannel(orgId);
  if (existing) {
    console.log(`✅ Org already has an active SMS channel: ${existing.phone_number}`);
    console.log('   (Skipping purchase to avoid duplicate billing.)');
    process.exit(0);
  }

  // ── 4. Confirm before spending
  console.log('');
  console.log('💰 About to purchase a Twilio number (~$1 USD/month).');
  console.log('   Press Ctrl+C in the next 5 seconds to abort.');
  await new Promise((r) => setTimeout(r, 5000));

  // ── 5. Purchase
  console.log('🔄 Provisioning…');
  try {
    const result = await provisionSmsNumber(orgId);
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(' ✅ SUCCESS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`   Phone number: ${result.phoneNumber}`);
    console.log(`   Channel ID:   ${result.channelId}`);
    console.log('');
    console.log('Next steps:');
    console.log(`   1. Send a test SMS:  Settings → SMS Messaging in the app`);
    console.log(`   2. Verify webhooks reach: ${process.env.PUBLIC_URL}/api/messages/inbound`);
    console.log(`   3. To release this number later: Twilio console → Phone Numbers → ${result.phoneNumber} → Release`);
  } catch (err: any) {
    console.error('');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error(' ❌ FAILED');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error(`   ${err?.message || err}`);
    if (err?.code === 21450) {
      console.error('   → No SMS-capable numbers available. Try widening the area code or country.');
    }
    if (err?.code === 21452) {
      console.error('   → Insufficient Twilio account balance. Top up at console.twilio.com → Billing.');
    }
    if (err?.message?.includes('Geo-Permission')) {
      console.error('   → Enable geo permissions for the destination country at console.twilio.com → Messaging → Settings → Geo Permissions.');
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
