export type LeadStatus = 'Lead' | 'Qualified' | 'Proposal' | 'Negotiation' | 'Closed';

export interface Lead {
  id: string;
  org_id?: string;
  created_by?: string;
  created_at: string;
  updated_at?: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  address?: string | null;
  company?: string;
  title?: string;
  source?: string;
  value?: number;
  status: LeadStatus | string;
  tags?: string[];
  user_id?: string;
  assigned_to?: string | null;
  notes?: string | null;
  converted_to_client_id?: string | null;
  deleted_at?: string | null;
  schedule?: {
    start_date: string;
    start_time: string;
    end_time: string;
  } | null;
  assigned_team?: string | null;
  line_items?: Array<Record<string, any>> | null;
  description?: string | null;
}

export interface Task {
  id: string;
  created_at: string;
  title: string;
  description?: string;
  due_date: string;
  completed: boolean;
  lead_id?: string;
  user_id: string;
}

export interface Profile {
  id: string;
  full_name: string;
  avatar_url?: string;
  company_name?: string;
}

export type JobStatus =
  | 'Late'
  | 'Unscheduled'
  | 'Requires Invoicing'
  | 'Action Required'
  | 'Ending within 30 days'
  | 'Scheduled'
  | 'Completed';

export interface Job {
  id: string;
  org_id: string;
  lead_id?: string | null;
  job_number: string;
  title: string;
  client_id?: string | null;
  team_id?: string | null;
  client_name?: string | null;
  property_address: string;
  scheduled_at?: string | null;
  end_at?: string | null;
  status: JobStatus | string;
  total_cents: number;
  currency: string;
  subtotal?: number;
  tax_total?: number;
  total?: number;
  tax_lines?: Array<{ code: string; label: string; rate: number; enabled: boolean }>;
  job_type?: string | null;
  salesperson_id?: string | null;
  requires_invoicing?: boolean;
  billing_split?: boolean;
  notes?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geocode_status?: 'ok' | 'failed' | 'pending' | string | null;
  geocoded_at?: string | null;
  invoice_url?: string | null;
  attachments?: Array<{ name: string; url: string }> | null;
  created_at: string;
  updated_at: string;
}

export type PaymentProvider = 'stripe' | 'paypal' | 'manual';

export type PaymentStatus = 'succeeded' | 'pending' | 'failed' | 'refunded';

export type PaymentMethod = 'card' | 'e-transfer' | 'cash' | 'check';

export interface Payment {
  id: string;
  org_id: string;
  client_id: string | null;
  invoice_id: string | null;
  job_id: string | null;
  provider: PaymentProvider;
  provider_payment_id?: string | null;
  provider_order_id?: string | null;
  provider_event_id?: string | null;
  amount_cents: number;
  currency: string;
  method: PaymentMethod | null;
  status: PaymentStatus;
  payment_date: string;
  payout_date: string | null;
  created_at: string;
  updated_at?: string;
  deleted_at: string | null;
}
