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
import { logger } from '../lib/logger';

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

  logger.info(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  logger.info(`Expected smsUrl:    ${expectedSmsUrl}`);
  logger.info(`Expected statusUrl: ${expectedStatusUrl}`);
  logger.info('');

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
    logger.info(`\norg=${ch.org_id}`, { phone });

    // Find the number on Twilio
    const matches = await twilioClient.incomingPhoneNumbers.list({ phoneNumber: phone, limit: 1 });
    const twNumber = matches[0];
    if (!twNumber) {
      logger.info('  ❌ Not found on Twilio account.');
      missing++;
      continue;
    }
    logger.info(`  Twilio SID: ${twNumber.sid}`);
    logger.info(`  Current smsUrl:    ${twNumber.smsUrl || '(empty)'}`);
    logger.info(`  Current statusCb:  ${twNumber.statusCallback || '(empty)'}`);

    const needsSmsUrl = twNumber.smsUrl !== expectedSmsUrl;
    const needsStatusCb = twNumber.statusCallback !== expectedStatusUrl;
    const needsMethod = twNumber.smsMethod !== 'POST';
    const needsSidBackfill = !ch.metadata || (ch.metadata as any).twilio_sid !== twNumber.sid;

    if (!needsSmsUrl && !needsStatusCb && !needsMethod && !needsSidBackfill) {
      logger.info('  ✅ Already configured correctly.');
      alreadyOk++;
      continue;
    }

    logger.info('  ⚠️  Needs update:');
    if (needsSmsUrl) logger.info('     - smsUrl');
    if (needsStatusCb) logger.info('     - statusCallback');
    if (needsMethod) logger.info('     - smsMethod (should be POST)');
    if (needsSidBackfill) logger.info('     - metadata.twilio_sid (Supabase backfill)');

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
    logger.info('  ✅ Patched.');
    fixed++;
  }

  logger.info('');
  logger.info('─────────────────────────────────────');
  logger.info(`Already OK: ${alreadyOk}`);
  logger.info(`Fixed:      ${fixed}`);
  logger.info(`Missing on Twilio: ${missing}`);
  if (!APPLY && (fixed === 0 && alreadyOk === (channels?.length || 0))) {
    logger.info('Nothing to do.');
  } else if (!APPLY) {
    logger.info('\nRe-run with --apply to push these changes to Twilio.');
  }
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
