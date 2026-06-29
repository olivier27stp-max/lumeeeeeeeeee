export type JobDbStatus = 'draft' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

/**
 * One photo/file on a job. Mirrors the web's `jobs.attachments` jsonb shape
 * ({ url, path }) so photos taken on mobile show up on desktop and vice-versa.
 * Extra fields (thumb_path, uploaded_by, created_at, kind) are additive and
 * ignored by the web.
 */
export interface JobAttachment {
  url: string;
  path: string;
  name?: string;
  thumb_path?: string;
  uploaded_by?: string;
  created_at?: string;
  kind?: 'photo' | 'signature' | 'file';
}

export interface Job {
  id: string;
  org_id: string;
  job_number: string;
  title: string;
  description: string | null;
  client_id: string | null;
  client_name: string | null;
  team_id: string | null;
  property_address: string | null;
  scheduled_at: string | null;
  start_at: string | null;
  end_at: string | null;
  status: JobDbStatus | string;
  job_type: string | null;
  total_cents: number;
  currency: string;
  notes: string | null;
  latitude: number | null;
  longitude: number | null;
  completed_at: string | null;
  deleted_at: string | null;
  attachments: JobAttachment[] | null;
  created_at: string;
  updated_at: string;
}

export interface ClientRecord {
  id: string;
  org_id: string;
  first_name: string;
  last_name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Profile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  company_name: string | null;
}

export interface Membership {
  user_id: string;
  org_id: string;
  role: string;
}
