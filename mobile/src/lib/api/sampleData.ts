// One-tap sample data for testing the mobile experience. Creates a few real
// clients (full profiles) + jobs scheduled TODAY, linked to them, so the Home
// and Schedule screens show real, tappable records in real time.
//
// Idempotent: re-running finds the existing sample client (by company) and the
// existing job (by title) and just reschedules it to today — it does NOT create
// duplicates. Runs through the authenticated session, so RLS scopes everything
// to the caller's org (no service-role key needed).

import { ClientInput, createClient, listClients } from './clients';
import { createJob, listJobsForClient, updateJob, JobInput } from './jobs';

type SampleClient = ClientInput & {
  latitude: number;
  longitude: number;
  jobs: Array<{
    title: string;
    description?: string;
    hour: number; // today, at this hour (local)
    items: NonNullable<JobInput['items']>;
  }>;
};

// A small, realistic book of business around Montréal — all jobs land today.
const SAMPLE_CLIENTS: SampleClient[] = [
  {
    first_name: 'David',
    last_name: 'Tremblay',
    company: 'Acme Corp HQ',
    email: 'david@acmecorp.ca',
    phone: '+15145550123',
    address: '1250 René-Lévesque Blvd W',
    city: 'Montréal',
    province: 'QC',
    postal_code: 'H3B 4W8',
    notes: 'Main office — ask for David at reception.',
    latitude: 45.5048,
    longitude: -73.5772,
    jobs: [
      {
        title: 'Network Diagnostic',
        description: 'Investigate intermittent Wi-Fi drops on the 12th floor.',
        hour: 8,
        items: [{ name: 'On-site diagnostic (2h)', qty: 2, unit_price_cents: 12000 }],
      },
    ],
  },
  {
    first_name: 'Sophie',
    last_name: 'Nguyen',
    company: 'TechGlobal Inc.',
    email: 'sophie@techglobal.com',
    phone: '+15145550148',
    address: '800 De La Gauchetière St W',
    city: 'Montréal',
    province: 'QC',
    postal_code: 'H5A 1K3',
    notes: 'Loading dock access in the back.',
    latitude: 45.5135,
    longitude: -73.567,
    jobs: [
      {
        title: 'Server Maintenance',
        description: 'Quarterly rack maintenance and firmware updates.',
        hour: 11,
        items: [{ name: 'Maintenance plan', qty: 1, unit_price_cents: 45000 }],
      },
    ],
  },
  {
    first_name: 'Marc',
    last_name: 'Lefebvre',
    company: 'Apex Solutions',
    email: 'marc@apexsolutions.ca',
    phone: '+15145550177',
    address: '2000 McGill College Ave',
    city: 'Montréal',
    province: 'QC',
    postal_code: 'H3A 3H3',
    latitude: 45.497,
    longitude: -73.579,
    jobs: [
      {
        title: 'On-site Support',
        description: 'Workstation setup for 5 new hires.',
        hour: 14,
        items: [{ name: 'Workstation setup', qty: 5, unit_price_cents: 8000 }],
      },
    ],
  },
  {
    first_name: 'Emma',
    last_name: 'Roy',
    company: 'Beta Systems',
    email: 'emma@betasystems.io',
    phone: '+15145550192',
    address: '405 Ogilvy Ave',
    city: 'Montréal',
    province: 'QC',
    postal_code: 'H3N 1M3',
    latitude: 45.52,
    longitude: -73.56,
    jobs: [
      {
        title: 'Cabling',
        description: 'Run Cat6 to the new meeting rooms.',
        hour: 16,
        items: [{ name: 'Structured cabling (per drop)', qty: 8, unit_price_cents: 9500 }],
      },
    ],
  },
];

function todayAt(hour: number): { start: string; end: string } {
  const start = new Date();
  start.setHours(hour, 0, 0, 0);
  const end = new Date(start);
  end.setHours(hour + 1, 30, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * Ensure the sample clients exist and their jobs are scheduled for TODAY.
 * Reuses existing records (matched by company / job title) and reschedules them
 * rather than creating duplicates. Returns counts of what changed.
 */
export async function loadTodaySampleClients(
  orgId: string,
): Promise<{ created: number; rescheduled: number }> {
  let created = 0;
  let rescheduled = 0;

  for (const sc of SAMPLE_CLIENTS) {
    const { latitude, longitude, jobs, ...clientInput } = sc;

    // Find an existing client with this company (search by company name), else create.
    const matches = await listClients(sc.company ?? sc.last_name);
    let client = matches.find(
      (c) => (c.company ?? '').toLowerCase() === (sc.company ?? '').toLowerCase(),
    );
    if (!client) {
      client = await createClient(orgId, clientInput);
    }

    const fullName = [client.first_name, client.last_name].filter(Boolean).join(' ').trim();
    const propertyAddress = [sc.address, sc.city, sc.province, sc.postal_code]
      .filter(Boolean)
      .join(', ');
    const existingJobs = await listJobsForClient(client.id);

    for (const j of jobs) {
      const { start, end } = todayAt(j.hour);
      const existing = existingJobs.find((e) => e.title === j.title);
      if (existing) {
        // Reschedule to today and make sure it's active again.
        await updateJob(existing.id, {
          scheduled_at: start,
          end_at: end,
        });
        rescheduled += 1;
      } else {
        await createJob(orgId, {
          title: j.title,
          description: j.description ?? null,
          client_id: client.id,
          client_name: sc.company || fullName || null,
          property_address: propertyAddress,
          scheduled_at: start,
          end_at: end,
          latitude,
          longitude,
          items: j.items,
          requires_invoicing: true,
        });
        created += 1;
      }
    }
  }

  return { created, rescheduled };
}
