/**
 * Repair Twilio webhook configuration for every active SMS channel.
 *
 * Usage:
 *   npx tsx server/scripts/repair-twilio-webhooks.ts            # dry-run
 *   npx tsx server/scripts/repair-twilio-webhooks.ts --apply    # actually patch Twilio
 *
 * What it does:
 *   1. Reads every active SMS channel from communication_channels
 *   2. Looks up the matching incomingPhoneNumber on Twilio (by phone_number)
 *   3. Verifies smsUrl + statusCallback point to PUBLIC_URL
 *   4. With --apply, updates Twilio + backfills metadata.twilio_sid in Supabase
 *
 * Requires: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, PUBLIC_URL in .env.local
 */

import 'dotenv/config';
import { twilioClient } from '../lib/config';
import { getServiceClient } from '../lib/supabase';

const APPLY = process.argv.includes('--apply');

async function main() {
  if (!twilioClient) {
    console.error('Twilio client is null. Check TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN.');
    process.exit(1);
  }
  const publicUrl = (process.env.PUBLIC_URL || process.env.TWILIO_WEBHOOK_BASE_URL || '').trim().replace(/\/$/, '');
  if (!publicUrl || publicUrl.includes('localhost')) {
    console.error('PUBLIC_URL must be a publicly reachable https URL. Got:', publicUrl || '(empty)');
    process.exit(1);
  }
  const expectedSmsUrl = `${publicUrl}/api/messages/inbound`;
  const expectedStatusUrl = `${publicUrl}/api/messages/status`;

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Expected smsUrl:    ${expectedSmsUrl}`);
  console.log(`Expected statusUrl: ${expectedStatusUrl}`);
  console.log('');

  const admin = getServiceClient();
  const { data: channels, error } = await admin
    .from('communication_channels')
    .select('id, org_id, phone_number, status, metadata')
    .eq('channel_type', 'sms')
    .eq('status', 'active');

  if (error) {
    console.error('Failed to load channels:', error.message);
    process.exit(1);
  }

  let fixed = 0;
  let alreadyOk = 0;
  let missing = 0;

  for (const ch of channels || []) {
    const phone = ch.phone_number;
    console.log(`\n[${phone}] org=${ch.org_id}`);

    // Find the number on Twilio
    const matches = await twilioClient.incomingPhoneNumbers.list({ phoneNumber: phone, limit: 1 });
    const twNumber = matches[0];
    if (!twNumber) {
      console.log('  ❌ Not found on Twilio account.');
      missing++;
      continue;
    }
    console.log(`  Twilio SID: ${twNumber.sid}`);
    console.log(`  Current smsUrl:    ${twNumber.smsUrl || '(empty)'}`);
    console.log(`  Current statusCb:  ${twNumber.statusCallback || '(empty)'}`);

    const needsSmsUrl = twNumber.smsUrl !== expectedSmsUrl;
    const needsStatusCb = twNumber.statusCallback !== expectedStatusUrl;
    const needsMethod = twNumber.smsMethod !== 'POST';
    const needsSidBackfill = !ch.metadata || (ch.metadata as any).twilio_sid !== twNumber.sid;

    if (!needsSmsUrl && !needsStatusCb && !needsMethod && !needsSidBackfill) {
      console.log('  ✅ Already configured correctly.');
      alreadyOk++;
      continue;
    }

    console.log('  ⚠️  Needs update:');
    if (needsSmsUrl) console.log('     - smsUrl');
    if (needsStatusCb) console.log('     - statusCallback');
    if (needsMethod) console.log('     - smsMethod (should be POST)');
    if (needsSidBackfill) console.log('     - metadata.twilio_sid (Supabase backfill)');

    if (!APPLY) continue;

    // Patch Twilio
    await twilioClient.incomingPhoneNumbers(twNumber.sid).update({
      smsUrl: expectedSmsUrl,
      smsMethod: 'POST',
      statusCallback: expectedStatusUrl,
      statusCallbackMethod: 'POST',
    });
    // Backfill metadata
    const newMeta = { ...(ch.metadata as any || {}), twilio_sid: twNumber.sid };
    await admin
      .from('communication_channels')
      .update({ metadata: newMeta })
      .eq('id', ch.id);
    console.log('  ✅ Patched.');
    fixed++;
  }

  console.log('');
  console.log('─────────────────────────────────────');
  console.log(`Already OK: ${alreadyOk}`);
  console.log(`Fixed:      ${fixed}`);
  console.log(`Missing on Twilio: ${missing}`);
  if (!APPLY && (fixed === 0 && alreadyOk === (channels?.length || 0))) {
    console.log('Nothing to do.');
  } else if (!APPLY) {
    console.log('\nRe-run with --apply to push these changes to Twilio.');
  }
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
