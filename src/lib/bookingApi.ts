import { supabase } from './supabase';

const API_BASE = '/api';

export type AvailabilityWindow = { start: string; end: string };
export type WeekKey = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';
export type Availability = Partial<Record<WeekKey, AvailabilityWindow[]>>;

export type BookingPage = {
  id: string;
  org_id: string;
  slug: string;
  title: string;
  description: string | null;
  service_type: string | null;
  duration_minutes: number;
  buffer_minutes: number;
  availability: Availability;
  advance_notice_hours: number;
  max_days_ahead: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type PublicBookingPage = {
  slug: string;
  title: string;
  description: string | null;
  service_type: string | null;
  duration_minutes: number;
  availability: Availability;
  advance_notice_hours: number;
  max_days_ahead: number;
};

export type Booking = {
  id: string;
  org_id: string;
  booking_page_id: string | null;
  customer_first_name: string;
  customer_last_name: string;
  customer_email: string;
  customer_phone: string | null;
  service_address: string | null;
  notes: string | null;
  scheduled_at: string;
  duration_minutes: number;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  lead_id: string | null;
  job_id: string | null;
  created_at: string;
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    Authorization: `Bearer ${session.access_token}`,
  };
}

async function publicHeaders(): Promise<Record<string, string>> {
  return {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  };
}

// ── Public ─────────────────────────────────────────────────

export async function fetchPublicBookingPage(slug: string): Promise<{
  page: PublicBookingPage;
  business: { name: string | null; logo_url: string | null };
}> {
  const res = await fetch(`${API_BASE}/booking/${encodeURIComponent(slug)}`, {
    headers: await publicHeaders(),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load booking page');
  return res.json();
}

export async function fetchSlots(slug: string, dateYmd: string): Promise<{ start: string; end: string }[]> {
  const res = await fetch(`${API_BASE}/booking/${encodeURIComponent(slug)}/slots?date=${encodeURIComponent(dateYmd)}`, {
    headers: await publicHeaders(),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load slots');
  const { slots } = await res.json();
  return slots || [];
}

export async function submitBooking(slug: string, payload: {
  customer_first_name: string;
  customer_last_name: string;
  customer_email: string;
  customer_phone?: string | null;
  service_address?: string | null;
  notes?: string | null;
  scheduled_at: string;
}): Promise<{ ok: true; booking: { id: string; scheduled_at: string; duration_minutes: number }; lead_id: string | null }> {
  const res = await fetch(`${API_BASE}/booking/${encodeURIComponent(slug)}`, {
    method: 'POST',
    headers: await publicHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to submit booking');
  return res.json();
}

// ── Admin ──────────────────────────────────────────────────

export async function fetchBookingPages(): Promise<BookingPage[]> {
  const res = await fetch(`${API_BASE}/booking-pages`, { headers: await authHeaders() });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load pages');
  const { pages } = await res.json();
  return pages || [];
}

export async function upsertBookingPage(payload: Partial<BookingPage> & {
  slug: string; title: string; duration_minutes: number; buffer_minutes: number;
  advance_notice_hours: number; max_days_ahead: number; availability: Availability;
}): Promise<BookingPage> {
  const res = await fetch(`${API_BASE}/booking-pages`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to save page');
  const { page } = await res.json();
  return page;
}

export async function deleteBookingPage(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/booking-pages/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to delete page');
}

export async function fetchBookings(status?: string): Promise<Booking[]> {
  const url = status ? `${API_BASE}/bookings?status=${encodeURIComponent(status)}` : `${API_BASE}/bookings`;
  const res = await fetch(url, { headers: await authHeaders() });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load bookings');
  const { bookings } = await res.json();
  return bookings || [];
}

export async function updateBookingStatus(id: string, status: Booking['status']): Promise<Booking> {
  const res = await fetch(`${API_BASE}/bookings/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to update booking');
  const { booking } = await res.json();
  return booking;
}
