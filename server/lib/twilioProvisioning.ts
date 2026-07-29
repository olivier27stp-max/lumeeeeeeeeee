import { twilioClient, twilioAccountSid } from './config';
import { getServiceClient } from './supabase';

/**
 * Purchase a Twilio phone number and provision it as the org's SMS channel.
 * Called server-side only — never from client.
 *
 * Auto-picks an area code from the org's address (city/region/postal) when possible.
 * Falls back from area code → country if no numbers are available locally.
 */
export async function provisionSmsNumber(orgId: string, options?: {
  areaCode?: string;
  country?: string;
}): Promise<{ channelId: string; phoneNumber: string }> {
  if (!twilioClient) {
    throw new Error('Twilio is not configured.');
  }

  const publicUrl = (process.env.PUBLIC_URL || process.env.TWILIO_WEBHOOK_BASE_URL || '').trim().replace(/\/$/, '');
  if (!publicUrl || !/^https?:\/\//.test(publicUrl) || publicUrl.includes('localhost')) {
    throw new Error('PUBLIC_URL must be set to a publicly reachable https:// URL before provisioning a Twilio number (got: ' + (publicUrl || 'empty') + ').');
  }

  // Resolve country + area code from org profile when not explicitly passed.
  const resolved = await resolveRegionForOrg(orgId);
  const country = (options?.country || resolved.country || 'CA').toUpperCase();
  const areaCode = options?.areaCode || resolved.areaCode || undefined;

  // Try with area code first, then without if nothing available
  let candidate = await findAvailableNumber(country, areaCode);
  if (!candidate && areaCode) {
    candidate = await findAvailableNumber(country, undefined);
  }
  if (!candidate) {
    throw new Error(`No SMS-capable numbers available for country=${country}${areaCode ? ` (tried area=${areaCode})` : ''}.`);
  }

  // Purchase the number with webhooks pre-wired
  const purchased = await twilioClient.incomingPhoneNumbers.create({
    phoneNumber: candidate.phoneNumber,
    smsUrl: `${publicUrl}/api/messages/inbound`,
    smsMethod: 'POST',
    statusCallback: `${publicUrl}/api/messages/status`,
    statusCallbackMethod: 'POST',
    friendlyName: `Lume-${orgId.slice(0, 8)}`,
  });

  // Save to DB via RPC
  const serviceClient = getServiceClient();
  const { data: channelId, error } = await serviceClient.rpc('provision_sms_channel', {
    p_org_id: orgId,
    p_phone_number: purchased.phoneNumber,
    p_provider: 'twilio',
    p_metadata: {
      twilio_sid: purchased.sid,
      friendly_name: purchased.friendlyName,
      country,
      area_code: areaCode || null,
    },
  });

  if (error) throw error;

  return { channelId: channelId as string, phoneNumber: purchased.phoneNumber };
}

async function findAvailableNumber(country: string, areaCode?: string) {
  const params: Record<string, any> = { limit: 1, smsEnabled: true };
  if (areaCode) params.areaCode = areaCode;
  const list = await twilioClient!.availablePhoneNumbers(country).local.list(params);
  return list[0] || null;
}

/**
 * Get the active SMS channel for an org.
 */
export async function getOrgSmsChannel(orgId: string) {
  const serviceClient = getServiceClient();
  const { data } = await serviceClient
    .from('communication_channels')
    .select('id, phone_number, status, metadata')
    .eq('org_id', orgId)
    .eq('channel_type', 'sms')
    .eq('is_default', true)
    .eq('status', 'active')
    .maybeSingle();
  return data;
}

/**
 * Return the org's E.164 sending number, or throw a typed error if missing.
 * Multi-tenant model: every org has its OWN Twilio number — no shared fallback.
 * Callers should catch SmsNumberNotProvisionedError and return HTTP 409 with code.
 */
export class SmsNumberNotProvisionedError extends Error {
  code = 'sms_not_provisioned' as const;
  constructor(orgId: string) {
    super(`Organization ${orgId} has no active Twilio SMS number. Provision one before sending.`);
    this.name = 'SmsNumberNotProvisionedError';
  }
}

export async function getOrgSmsFromNumber(orgId: string): Promise<string> {
  const channel = await getOrgSmsChannel(orgId);
  if (!channel?.phone_number) throw new SmsNumberNotProvisionedError(orgId);
  return channel.phone_number;
}

// ─── Region resolution ─────────────────────────────────────────────────
// Map the org's address (city/region/postal) to a Twilio country + area code.
// Conservative: if we can't confidently pick an area code, return country only.

async function resolveRegionForOrg(orgId: string): Promise<{ country: string | null; areaCode: string | null }> {
  const serviceClient = getServiceClient();
  // The org address lives in company_settings — `orgs` has no address columns.
  // Note the column is `province` (not `region`).
  const { data: settings, error } = await serviceClient
    .from('company_settings')
    .select('country, province, city, postal_code')
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) {
    console.error(`[provisioning] Failed to read company_settings for org ${orgId}:`, error.message);
    return { country: null, areaCode: null };
  }
  if (!settings) return { country: null, areaCode: null };

  const country = normalizeCountry(settings.country);
  const areaCode = pickAreaCode({
    country,
    region: settings.province || null,
    city: settings.city || null,
    postal: settings.postal_code || null,
  });

  return { country, areaCode };
}

function normalizeCountry(raw: string | null | undefined): string {
  const v = String(raw || '').trim().toUpperCase();
  if (v === 'CA' || v === 'CAN' || v === 'CANADA') return 'CA';
  if (v === 'US' || v === 'USA' || v === 'UNITED STATES') return 'US';
  return v || 'CA';
}

/** Strip accents + collapse whitespace so "Montréal" and "Montreal" both match. */
function foldKey(raw: string | null): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickAreaCode(input: {
  country: string;
  region: string | null;
  city: string | null;
  postal: string | null;
}): string | null {
  const { country, city, region, postal } = input;

  if (country === 'CA') {
    // Canadian postal codes start with a letter-digit-letter triplet; first 3 chars = FSA
    const fsa = (postal || '').replace(/\s+/g, '').toUpperCase().slice(0, 3);
    if (fsa && CA_FSA_TO_AREA[fsa]) return CA_FSA_TO_AREA[fsa];

    const cityKey = foldKey(city).toLowerCase();
    if (cityKey && CA_CITY_TO_AREA[cityKey]) return CA_CITY_TO_AREA[cityKey];

    const regionKey = foldKey(region).toUpperCase();
    if (regionKey && CA_REGION_TO_AREA[regionKey]) return CA_REGION_TO_AREA[regionKey];
    return null;
  }

  if (country === 'US') {
    const zip3 = (postal || '').replace(/\D/g, '').slice(0, 3);
    if (zip3 && US_ZIP3_TO_AREA[zip3]) return US_ZIP3_TO_AREA[zip3];

    const cityKey = foldKey(city).toLowerCase();
    if (cityKey && US_CITY_TO_AREA[cityKey]) return US_CITY_TO_AREA[cityKey];

    const regionKey = foldKey(region).toUpperCase();
    if (regionKey && US_REGION_TO_AREA[regionKey]) return US_REGION_TO_AREA[regionKey];
    return null;
  }

  return null;
}

// ─── Canada area-code maps ─────────────────────────────────────────────
// Not exhaustive: covers major metro postal prefixes, cities, and province fallbacks.
// Twilio will fall back to country-wide search if the chosen area code has no inventory.

const CA_FSA_TO_AREA: Record<string, string> = {
  // Montréal (514/438)
  H1A: '514', H1B: '514', H1C: '514', H1E: '514', H1G: '514', H1H: '514', H1J: '514',
  H1K: '514', H1L: '514', H1M: '514', H1N: '514', H1P: '514', H1R: '514', H1S: '514',
  H1T: '514', H1V: '514', H1W: '514', H1X: '514', H1Y: '514', H1Z: '514',
  H2A: '514', H2B: '514', H2C: '514', H2E: '514', H2G: '514', H2H: '514', H2J: '514',
  H2K: '514', H2L: '514', H2M: '514', H2N: '514', H2P: '514', H2R: '514', H2S: '514',
  H2T: '514', H2V: '514', H2W: '514', H2X: '514', H2Y: '514', H2Z: '514',
  H3A: '514', H3B: '514', H3C: '514', H3E: '514', H3G: '514', H3H: '514', H3J: '514',
  H3K: '514', H3L: '514', H3M: '514', H3N: '514', H3P: '514', H3R: '514', H3S: '514',
  H3T: '514', H3V: '514', H3W: '514', H3X: '514', H3Y: '514', H3Z: '514',
  H4A: '514', H4B: '514', H4C: '514', H4E: '514', H4G: '514', H4H: '514', H4J: '514',
  // Laval (450/579)
  H7A: '450', H7B: '450', H7C: '450', H7E: '450', H7G: '450', H7H: '450', H7J: '450',
  // Montérégie / couronne sud — Longueuil, Brossard, Saint-Hubert, Saint-Bruno,
  // Mont-Saint-Hilaire, Beloeil, Saint-Hyacinthe, Granby, Sorel (450/579)
  J3A: '450', J3B: '450', J3E: '450', J3G: '450', J3H: '450', J3L: '450',
  J3M: '450', J3N: '450', J3P: '450', J3R: '450', J3V: '450', J3X: '450', J3Y: '450', J3Z: '450',
  J2A: '450', J2B: '450', J2C: '450', J2E: '450', J2G: '450', J2H: '450',
  J2J: '450', J2K: '450', J2L: '450', J2M: '450', J2N: '450', J2R: '450', J2S: '450', J2T: '450', J2W: '450', J2X: '450', J2Y: '450',
  J4B: '450', J4G: '450', J4H: '450', J4J: '450', J4K: '450', J4L: '450', J4M: '450',
  J4N: '450', J4P: '450', J4R: '450', J4S: '450', J4T: '450', J4V: '450', J4W: '450',
  J4X: '450', J4Y: '450', J4Z: '450',
  J5A: '450', J5B: '450', J5C: '450', J5J: '450', J5K: '450', J5L: '450', J5M: '450',
  J5R: '450', J5T: '450', J5V: '450', J5W: '450', J5X: '450', J5Y: '450', J5Z: '450',
  J6A: '450', J6E: '450', J6J: '450', J6K: '450', J6N: '450', J6R: '450', J6S: '450',
  J6T: '450', J6V: '450', J6W: '450', J6X: '450', J6Y: '450', J6Z: '450',
  J7A: '450', J7B: '450', J7C: '450', J7E: '450', J7G: '450', J7H: '450', J7J: '450',
  J7K: '450', J7L: '450', J7M: '450', J7N: '450', J7P: '450', J7R: '450', J7T: '450',
  J7V: '450', J7W: '450', J7X: '450', J7Y: '450', J7Z: '450',
  J0L: '450', J0J: '450',
  // Québec City (418/581)
  G1A: '418', G1B: '418', G1C: '418', G1E: '418', G1G: '418', G1H: '418', G1J: '418',
  G1K: '418', G1L: '418', G1M: '418', G1N: '418', G1P: '418', G1R: '418', G1S: '418',
  G1T: '418', G1V: '418', G1W: '418', G1X: '418', G1Y: '418',
  G2A: '418', G2B: '418', G2C: '418', G2E: '418', G2G: '418', G2J: '418', G2K: '418',
  G2L: '418', G2M: '418', G2N: '418',
  // Gatineau (819/873)
  J8P: '819', J8R: '819', J8T: '819', J8V: '819', J8X: '819', J8Y: '819', J8Z: '819',
  J9A: '819', J9B: '819', J9H: '819', J9J: '819',
  // Sherbrooke (819)
  J1E: '819', J1G: '819', J1H: '819', J1J: '819', J1K: '819', J1L: '819', J1M: '819', J1N: '819',
  // Toronto (416/647/437)
  M4A: '416', M4B: '416', M4C: '416', M4E: '416', M4G: '416', M4H: '416', M4J: '416',
  M4K: '416', M4L: '416', M4M: '416', M4N: '416', M4P: '416', M4R: '416', M4S: '416',
  M4T: '416', M4V: '416', M4W: '416', M4X: '416', M4Y: '416',
  M5A: '416', M5B: '416', M5C: '416', M5E: '416', M5G: '416', M5H: '416', M5J: '416',
  M5K: '416', M5L: '416', M5M: '416', M5N: '416', M5P: '416', M5R: '416', M5S: '416',
  M5T: '416', M5V: '416', M5W: '416', M5X: '416',
  // Vancouver (604/778/236)
  V5K: '604', V5L: '604', V5M: '604', V5N: '604', V5P: '604', V5R: '604', V5S: '604',
  V5T: '604', V5V: '604', V5W: '604', V5X: '604', V5Y: '604', V5Z: '604',
  V6A: '604', V6B: '604', V6C: '604', V6E: '604', V6G: '604', V6H: '604', V6J: '604',
  V6K: '604', V6L: '604', V6M: '604', V6N: '604', V6P: '604', V6R: '604', V6S: '604',
  V6T: '604', V6V: '604', V6W: '604', V6X: '604', V6Y: '604', V6Z: '604',
  // Calgary (403/587)
  T2A: '403', T2B: '403', T2C: '403', T2E: '403', T2G: '403', T2H: '403', T2J: '403',
  T2K: '403', T2L: '403', T2M: '403', T2N: '403', T2P: '403', T2R: '403', T2S: '403',
  T2T: '403', T2V: '403', T2W: '403', T2X: '403', T2Y: '403', T2Z: '403',
  T3A: '403', T3B: '403', T3C: '403', T3E: '403', T3G: '403', T3H: '403', T3J: '403',
  T3K: '403', T3L: '403', T3M: '403', T3N: '403', T3P: '403', T3R: '403',
};

const CA_CITY_TO_AREA: Record<string, string> = {
  'montreal': '514', 'montréal': '514',
  'laval': '450',
  'longueuil': '450',
  'brossard': '450',
  'saint-hubert': '450',
  'saint-bruno-de-montarville': '450',
  'mont-saint-hilaire': '450',
  'beloeil': '450',
  'chambly': '450',
  'saint-jean-sur-richelieu': '450',
  'saint-hyacinthe': '450',
  'granby': '450',
  'sorel-tracy': '450',
  'terrebonne': '450',
  'repentigny': '450',
  'blainville': '450',
  'mirabel': '450',
  'saint-jerome': '450',
  'salaberry-de-valleyfield': '450',
  'vaudreuil-dorion': '450',
  'quebec': '418', 'québec': '418', 'quebec city': '418',
  'gatineau': '819',
  'sherbrooke': '819',
  'trois-rivieres': '819', 'trois-rivières': '819',
  'saguenay': '418',
  'toronto': '416',
  'ottawa': '613',
  'mississauga': '905',
  'brampton': '905',
  'hamilton': '905',
  'london': '519',
  'kitchener': '519',
  'windsor': '519',
  'vancouver': '604',
  'surrey': '604',
  'burnaby': '604',
  'victoria': '250',
  'calgary': '403',
  'edmonton': '780',
  'winnipeg': '204',
  'regina': '306',
  'saskatoon': '306',
  'halifax': '902',
  'st. john\'s': '709',
};

const CA_REGION_TO_AREA: Record<string, string> = {
  QC: '514', QUEBEC: '514', 'QUÉBEC': '514',
  ON: '416', ONTARIO: '416',
  BC: '604', 'BRITISH COLUMBIA': '604',
  AB: '403', ALBERTA: '403',
  MB: '204', MANITOBA: '204',
  SK: '306', SASKATCHEWAN: '306',
  NS: '902', 'NOVA SCOTIA': '902',
  NB: '506', 'NEW BRUNSWICK': '506',
  NL: '709', 'NEWFOUNDLAND AND LABRADOR': '709',
  PE: '902', 'PRINCE EDWARD ISLAND': '902',
  YT: '867', YUKON: '867',
  NT: '867', 'NORTHWEST TERRITORIES': '867',
  NU: '867', NUNAVUT: '867',
};

// ─── US area-code maps ─────────────────────────────────────────────────
// ZIP3 prefix → major metro area code. Covers top US metros only.

const US_ZIP3_TO_AREA: Record<string, string> = {
  // NYC (212/646/917/718)
  '100': '212', '101': '212', '102': '212', '103': '212', '104': '212',
  // Brooklyn / Queens / Bronx
  '112': '718', '113': '718', '114': '718', '110': '718',
  // Los Angeles (213/323/310)
  '900': '213', '901': '213', '902': '310', '903': '310', '904': '310',
  // Chicago (312/773/872)
  '606': '312', '607': '312', '608': '312',
  // Houston (713/281/832)
  '770': '713', '771': '713', '772': '713',
  // Phoenix (602)
  '850': '602', '851': '602', '852': '602', '853': '602',
  // San Francisco (415)
  '941': '415', '940': '415',
  // Boston (617)
  '021': '617', '022': '617',
  // Miami (305/786)
  '331': '305', '332': '305', '333': '305',
  // Seattle (206)
  '980': '206', '981': '206', '982': '206',
  // Atlanta (404)
  '303': '404', '301': '404',
  // Dallas (214/469/972)
  '752': '214', '753': '214',
};

const US_CITY_TO_AREA: Record<string, string> = {
  'new york': '212', 'nyc': '212', 'manhattan': '212',
  'brooklyn': '718', 'queens': '718', 'bronx': '718',
  'los angeles': '213', 'la': '213',
  'chicago': '312',
  'houston': '713',
  'phoenix': '602',
  'philadelphia': '215',
  'san antonio': '210',
  'san diego': '619',
  'dallas': '214',
  'san jose': '408',
  'austin': '512',
  'jacksonville': '904',
  'fort worth': '817',
  'columbus': '614',
  'san francisco': '415', 'sf': '415',
  'indianapolis': '317',
  'seattle': '206',
  'denver': '303',
  'washington': '202', 'dc': '202',
  'boston': '617',
  'nashville': '615',
  'detroit': '313',
  'portland': '503',
  'memphis': '901',
  'oklahoma city': '405',
  'las vegas': '702',
  'louisville': '502',
  'baltimore': '410',
  'milwaukee': '414',
  'albuquerque': '505',
  'tucson': '520',
  'fresno': '559',
  'sacramento': '916',
  'atlanta': '404',
  'miami': '305',
  'minneapolis': '612',
  'kansas city': '816',
  'st louis': '314', 'saint louis': '314',
  'pittsburgh': '412',
  'cincinnati': '513',
  'cleveland': '216',
  'tampa': '813',
  'orlando': '407',
  'new orleans': '504',
};

const US_REGION_TO_AREA: Record<string, string> = {
  NY: '212', 'NEW YORK': '212',
  CA: '213', CALIFORNIA: '213',
  TX: '713', TEXAS: '713',
  FL: '305', FLORIDA: '305',
  IL: '312', ILLINOIS: '312',
  PA: '215', PENNSYLVANIA: '215',
  OH: '216', OHIO: '216',
  GA: '404', GEORGIA: '404',
  NC: '704', 'NORTH CAROLINA': '704',
  MI: '313', MICHIGAN: '313',
  NJ: '201', 'NEW JERSEY': '201',
  VA: '703', VIRGINIA: '703',
  WA: '206', WASHINGTON: '206',
  AZ: '602', ARIZONA: '602',
  MA: '617', MASSACHUSETTS: '617',
  TN: '615', TENNESSEE: '615',
  IN: '317', INDIANA: '317',
  MO: '314', MISSOURI: '314',
  MD: '410', MARYLAND: '410',
  WI: '414', WISCONSIN: '414',
  CO: '303', COLORADO: '303',
  MN: '612', MINNESOTA: '612',
  SC: '803', 'SOUTH CAROLINA': '803',
  AL: '205', ALABAMA: '205',
  LA: '504', LOUISIANA: '504',
  KY: '502', KENTUCKY: '502',
  OR: '503', OREGON: '503',
  OK: '405', OKLAHOMA: '405',
  CT: '203', CONNECTICUT: '203',
  IA: '515', IOWA: '515',
  MS: '601', MISSISSIPPI: '601',
  AR: '501', ARKANSAS: '501',
  KS: '316', KANSAS: '316',
  NV: '702', NEVADA: '702',
  UT: '801', UTAH: '801',
  NM: '505', 'NEW MEXICO': '505',
  NE: '402', NEBRASKA: '402',
  WV: '304', 'WEST VIRGINIA': '304',
  ID: '208', IDAHO: '208',
  HI: '808', HAWAII: '808',
  NH: '603', 'NEW HAMPSHIRE': '603',
  ME: '207', MAINE: '207',
  MT: '406', MONTANA: '406',
  RI: '401', 'RHODE ISLAND': '401',
  DE: '302', DELAWARE: '302',
  SD: '605', 'SOUTH DAKOTA': '605',
  ND: '701', 'NORTH DAKOTA': '701',
  AK: '907', ALASKA: '907',
  VT: '802', VERMONT: '802',
  WY: '307', WYOMING: '307',
  DC: '202',
};
