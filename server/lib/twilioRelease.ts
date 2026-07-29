import { twilioClient } from './config';
import { getServiceClient } from './supabase';

/**
 * Releasing a Twilio number back to the pool.
 *
 * Why a grace period: releasing is IRREVERSIBLE — Twilio can hand the number to
 * anyone else within minutes, and every conversation the org had on it breaks
 * (inbound routing keys off the `To` number). A cancellation is often a mistake,
 * a failed payment, or a downgrade the customer will reverse. So a lost-SMS plan
 * marks the channel `inactive` and stamps a release date; a separate sweep does
 * the actual, irreversible delete only once that date has passed.
 *
 * Sending is already blocked the moment the plan lapses (orgPlanIncludesSms),
 * so the grace period costs only the Twilio rental (~$1/mo), never leaked service.
 */

export const SMS_RELEASE_GRACE_DAYS = 30;

/**
 * Called when an org loses SMS entitlement (cancellation or downgrade).
 * Deactivates the channel and schedules the release. Idempotent.
 */
export async function scheduleSmsNumberRelease(orgId: string, reason: string): Promise<void> {
  const admin = getServiceClient();

  const { data: channels } = await admin
    .from('communication_channels')
    .select('id, phone_number, metadata, status')
    .eq('org_id', orgId)
    .eq('channel_type', 'sms')
    .eq('status', 'active');

  if (!channels?.length) return;

  const releaseAt = new Date(Date.now() + SMS_RELEASE_GRACE_DAYS * 86400_000).toISOString();

  for (const ch of channels) {
    const meta = (ch.metadata as any) || {};
    if (meta.release_scheduled_at) continue; // already scheduled — don't extend the deadline

    await admin
      .from('communication_channels')
      .update({
        status: 'inactive',
        metadata: { ...meta, release_scheduled_at: releaseAt, release_reason: reason },
      })
      .eq('id', ch.id);

    console.log(
      `[sms-release] Org ${orgId} lost SMS (${reason}) — ${ch.phone_number} deactivated, release on ${releaseAt}`,
    );
  }
}

/**
 * Called when an org regains SMS entitlement during the grace period.
 * Reactivates the existing number instead of buying a new one.
 * Returns true if a number was restored.
 */
export async function cancelSmsNumberRelease(orgId: string): Promise<boolean> {
  const admin = getServiceClient();

  const { data: channels } = await admin
    .from('communication_channels')
    .select('id, phone_number, metadata')
    .eq('org_id', orgId)
    .eq('channel_type', 'sms')
    .eq('status', 'inactive');

  const pending = (channels || []).filter((c) => (c.metadata as any)?.release_scheduled_at);
  if (!pending.length) return false;

  for (const ch of pending) {
    const meta = { ...((ch.metadata as any) || {}) };
    delete meta.release_scheduled_at;
    delete meta.release_reason;

    await admin
      .from('communication_channels')
      .update({ status: 'active', metadata: meta })
      .eq('id', ch.id);

    console.log(`[sms-release] Org ${orgId} regained SMS — ${ch.phone_number} reactivated`);
  }
  return true;
}

/**
 * Sweep: irreversibly release numbers whose grace period has elapsed.
 * Run from the scheduled-jobs cron. Returns a summary for logging.
 */
export async function releaseExpiredSmsNumbers(): Promise<{
  released: number;
  failed: number;
  skipped: number;
}> {
  const admin = getServiceClient();
  let released = 0;
  let failed = 0;
  let skipped = 0;

  const { data: channels } = await admin
    .from('communication_channels')
    .select('id, org_id, phone_number, metadata')
    .eq('channel_type', 'sms')
    .eq('status', 'inactive');

  const now = Date.now();

  for (const ch of channels || []) {
    const meta = (ch.metadata as any) || {};
    const releaseAt = meta.release_scheduled_at;
    if (!releaseAt || new Date(releaseAt).getTime() > now) {
      skipped++;
      continue;
    }

    // Safety net: never release a number for an org that has regained SMS.
    const { orgPlanIncludesSms } = await import('./twilioProvisioning');
    if (await orgPlanIncludesSms(ch.org_id)) {
      console.log(`[sms-release] Org ${ch.org_id} pays for SMS again — cancelling release`);
      await cancelSmsNumberRelease(ch.org_id);
      skipped++;
      continue;
    }

    const twilioSid = meta.twilio_sid as string | undefined;
    if (!twilioClient || !twilioSid) {
      console.warn(`[sms-release] Cannot release ${ch.phone_number}: missing client or twilio_sid`);
      failed++;
      continue;
    }

    try {
      await twilioClient.incomingPhoneNumbers(twilioSid).remove();
      await admin
        .from('communication_channels')
        .update({
          status: 'failed', // terminal: the number is gone from the account
          metadata: { ...meta, released_at: new Date().toISOString() },
        })
        .eq('id', ch.id);
      console.log(`[sms-release] Released ${ch.phone_number} (org ${ch.org_id})`);
      released++;
    } catch (err: any) {
      // 404 = already gone on Twilio's side; treat as released so we stop retrying.
      if (err?.status === 404) {
        await admin
          .from('communication_channels')
          .update({ status: 'failed', metadata: { ...meta, released_at: new Date().toISOString() } })
          .eq('id', ch.id);
        released++;
      } else {
        console.error(`[sms-release] Failed to release ${ch.phone_number}:`, err?.message);
        failed++;
      }
    }
  }

  return { released, failed, skipped };
}
