import { twilioClient } from './config';
import { getServiceClient } from './supabase';

/**
 * Twilio A2P 10DLC registration pipeline for US orgs.
 *
 * Flow:
 *   1. Create Trust Hub Customer Profile (KYB data)
 *   2. Create A2P Brand → submit for vetting (1-5 business days)
 *   3. Once brand is VERIFIED: create Messaging Service
 *   4. Create A2P Campaign → submit for review (1-7 business days)
 *   5. Attach the purchased phone number to the Messaging Service
 *
 * Messaging to US numbers is gated server-side until campaign_status === 'verified'.
 */

export interface A2PBrandInput {
  legal_business_name: string;
  ein: string;
  business_type: string;          // PRIVATE_PROFIT | PUBLIC_PROFIT | NON_PROFIT | SOLE_PROPRIETOR
  vertical: string;
  street: string;
  city: string;
  region: string;                 // state code (e.g. 'NY')
  postal_code: string;
  country: string;                // 'US'
  website: string;
  support_email: string;
  support_phone: string;
}

export interface A2PCampaignInput {
  use_case: string;               // CUSTOMER_CARE | MARKETING | MIXED | LOW_VOLUME
  description: string;
  message_samples: string[];      // 2-5 real examples
  opt_in_keywords: string[];
  opt_in_message: string;
  opt_out_message: string;
  has_embedded_links: boolean;
  has_embedded_phone: boolean;
}

/**
 * Submit the Brand (step 1 + 2). Idempotent: reuses existing SIDs if present.
 * Called when the user completes the A2P wizard in Settings → Messaging.
 */
export async function submitA2PBrand(orgId: string, input: A2PBrandInput): Promise<{
  brandSid: string;
  brandStatus: string;
}> {
  if (!twilioClient) throw new Error('Twilio is not configured.');
  const admin = getServiceClient();

  const { data: existing } = await admin
    .from('a2p_registrations')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle();

  // 1. Ensure customer profile exists (KYB)
  let customerProfileSid = existing?.twilio_customer_profile_sid as string | null;
  if (!customerProfileSid) {
    const profile = await twilioClient.trusthub.v1.customerProfiles.create({
      friendlyName: `Lume A2P - ${orgId.slice(0, 8)}`,
      email: input.support_email,
      policySid: 'RNdfbf3fae0e1107f8aded0e7cead80bf5', // Twilio's standard A2P policy
    });
    customerProfileSid = profile.sid;
  }

  // 2. Create Brand (or reuse)
  let brandSid = existing?.twilio_brand_sid as string | null;
  let brandStatus: string = existing?.brand_status || 'submitted';

  if (!brandSid) {
    // Twilio's messaging brand registration API
    const brand = await (twilioClient.messaging.v1 as any).brandRegistrations.create({
      customerProfileBundleSid: customerProfileSid,
      a2PProfileBundleSid: customerProfileSid,
      brandType: 'STANDARD',
    });
    brandSid = brand.sid;
    brandStatus = String(brand.status || 'PENDING').toLowerCase();
  }

  // 3. Persist in DB
  await admin.from('a2p_registrations').upsert(
    {
      org_id: orgId,
      legal_business_name: input.legal_business_name,
      ein: input.ein,
      business_type: input.business_type,
      vertical: input.vertical,
      street: input.street,
      city: input.city,
      region: input.region,
      postal_code: input.postal_code,
      country: input.country,
      website: input.website,
      support_email: input.support_email,
      support_phone: input.support_phone,
      twilio_customer_profile_sid: customerProfileSid,
      twilio_brand_sid: brandSid,
      brand_status: mapBrandStatus(brandStatus),
      last_checked_at: new Date().toISOString(),
    },
    { onConflict: 'org_id' },
  );

  return { brandSid: brandSid!, brandStatus: mapBrandStatus(brandStatus) };
}

/**
 * Submit the Campaign (step 3 + 4 + 5).
 * Requires Brand to be VERIFIED first — call refreshA2PStatus() to check.
 */
export async function submitA2PCampaign(orgId: string, input: A2PCampaignInput): Promise<{
  campaignSid: string;
  campaignStatus: string;
}> {
  if (!twilioClient) throw new Error('Twilio is not configured.');
  const admin = getServiceClient();

  const { data: reg } = await admin
    .from('a2p_registrations')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle();

  if (!reg) throw new Error('Brand registration not found. Submit brand first.');
  if (reg.brand_status !== 'verified') {
    throw new Error(`Brand is not yet verified (current: ${reg.brand_status}). Wait for approval before submitting the campaign.`);
  }

  // 3. Create Messaging Service if absent
  let messagingServiceSid = reg.twilio_messaging_service_sid as string | null;
  if (!messagingServiceSid) {
    const svc = await twilioClient.messaging.v1.services.create({
      friendlyName: `Lume-${orgId.slice(0, 8)}`,
      inboundRequestUrl: `${process.env.PUBLIC_URL || ''}/api/messages/inbound`,
      statusCallback: `${process.env.PUBLIC_URL || ''}/api/messages/status`,
    });
    messagingServiceSid = svc.sid;
  }

  // 4. Create US A2P Campaign attached to the Messaging Service + Brand
  let campaignSid = reg.twilio_campaign_sid as string | null;
  let campaignStatus: string = reg.campaign_status || 'submitted';

  if (!campaignSid) {
    const campaign = await (twilioClient.messaging.v1 as any)
      .services(messagingServiceSid)
      .usAppToPerson.create({
        brandRegistrationSid: reg.twilio_brand_sid,
        description: input.description,
        messageSamples: input.message_samples.slice(0, 5),
        usAppToPersonUsecase: input.use_case,
        hasEmbeddedLinks: input.has_embedded_links,
        hasEmbeddedPhone: input.has_embedded_phone,
        optInKeywords: input.opt_in_keywords,
        optInMessage: input.opt_in_message,
        optOutKeywords: ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'],
        optOutMessage: input.opt_out_message,
        helpKeywords: ['HELP', 'INFO'],
        helpMessage: 'Reply STOP to unsubscribe. Msg&Data rates may apply.',
      });
    campaignSid = campaign.sid;
    campaignStatus = String(campaign.campaignStatus || 'PENDING').toLowerCase();
  }

  // 5. Attach the org's purchased phone number to the Messaging Service
  await attachOrgNumberToMessagingService(orgId, messagingServiceSid!);

  await admin
    .from('a2p_registrations')
    .update({
      use_case: input.use_case,
      campaign_description: input.description,
      message_samples: input.message_samples,
      opt_in_keywords: input.opt_in_keywords,
      opt_in_message: input.opt_in_message,
      opt_out_message: input.opt_out_message,
      has_embedded_links: input.has_embedded_links,
      has_embedded_phone: input.has_embedded_phone,
      twilio_messaging_service_sid: messagingServiceSid,
      twilio_campaign_sid: campaignSid,
      campaign_status: mapCampaignStatus(campaignStatus),
      last_checked_at: new Date().toISOString(),
    })
    .eq('org_id', orgId);

  return { campaignSid: campaignSid!, campaignStatus: mapCampaignStatus(campaignStatus) };
}

/**
 * Poll Twilio for current brand + campaign status and update DB.
 * Called from the UI poller and from a periodic job.
 */
export async function refreshA2PStatus(orgId: string): Promise<{
  brand_status: string;
  campaign_status: string;
}> {
  if (!twilioClient) throw new Error('Twilio is not configured.');
  const admin = getServiceClient();

  const { data: reg } = await admin
    .from('a2p_registrations')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle();

  if (!reg) {
    return { brand_status: 'not_started', campaign_status: 'not_started' };
  }

  let brandStatus = reg.brand_status;
  let brandError: string | null = reg.brand_error;
  if (reg.twilio_brand_sid) {
    try {
      const brand = await (twilioClient.messaging.v1 as any)
        .brandRegistrations(reg.twilio_brand_sid)
        .fetch();
      brandStatus = mapBrandStatus(String(brand.status || ''));
      brandError = brand.failureReason || null;
    } catch (err: any) {
      brandError = err?.message || 'Failed to fetch brand status';
    }
  }

  let campaignStatus = reg.campaign_status;
  let campaignError: string | null = reg.campaign_error;
  if (reg.twilio_messaging_service_sid && reg.twilio_campaign_sid) {
    try {
      const campaign = await (twilioClient.messaging.v1 as any)
        .services(reg.twilio_messaging_service_sid)
        .usAppToPerson(reg.twilio_campaign_sid)
        .fetch();
      campaignStatus = mapCampaignStatus(String(campaign.campaignStatus || ''));
    } catch (err: any) {
      campaignError = err?.message || 'Failed to fetch campaign status';
    }
  }

  await admin
    .from('a2p_registrations')
    .update({
      brand_status: brandStatus,
      campaign_status: campaignStatus,
      brand_error: brandError,
      campaign_error: campaignError,
      last_checked_at: new Date().toISOString(),
    })
    .eq('org_id', orgId);

  return { brand_status: brandStatus, campaign_status: campaignStatus };
}

/**
 * Returns true if this org is allowed to send SMS to US numbers right now.
 * - Canadian orgs: always true (no A2P requirement)
 * - US orgs: only when both brand and campaign are verified
 */
export async function canSendToUS(orgId: string): Promise<boolean> {
  const admin = getServiceClient();
  const { data } = await admin
    .from('a2p_registrations')
    .select('brand_status, campaign_status')
    .eq('org_id', orgId)
    .maybeSingle();

  if (!data) return false;
  return data.brand_status === 'verified' && data.campaign_status === 'verified';
}

async function attachOrgNumberToMessagingService(orgId: string, messagingServiceSid: string) {
  const admin = getServiceClient();
  const { data: channel } = await admin
    .from('communication_channels')
    .select('metadata, phone_number')
    .eq('org_id', orgId)
    .eq('channel_type', 'sms')
    .eq('is_default', true)
    .eq('status', 'active')
    .maybeSingle();

  const twilioSid = (channel?.metadata as any)?.twilio_sid as string | undefined;
  if (!twilioSid) return;

  try {
    await twilioClient!.messaging.v1
      .services(messagingServiceSid)
      .phoneNumbers.create({ phoneNumberSid: twilioSid });
  } catch (err: any) {
    // 409 = already attached — safe to ignore
    if (err?.status !== 409) throw err;
  }
}

function mapBrandStatus(raw: string): string {
  const v = String(raw || '').toUpperCase();
  if (v === 'APPROVED' || v === 'VERIFIED') return 'verified';
  if (v === 'FAILED' || v === 'REJECTED') return 'failed';
  if (v === 'PENDING' || v === 'IN_REVIEW' || v === 'PENDING_REVIEW') return 'in_review';
  if (v === 'SUBMITTED') return 'submitted';
  return raw.toLowerCase() || 'submitted';
}

function mapCampaignStatus(raw: string): string {
  const v = String(raw || '').toUpperCase();
  if (v === 'VERIFIED' || v === 'APPROVED') return 'verified';
  if (v === 'FAILED' || v === 'REJECTED') return 'failed';
  if (v === 'PENDING' || v === 'IN_PROGRESS' || v === 'IN_REVIEW') return 'in_review';
  if (v === 'SUBMITTED') return 'submitted';
  return raw.toLowerCase() || 'submitted';
}
