export const DEMO_INDUSTRY_VALUES = [
  'landscaping',
  'snow_removal',
  'residential_cleaning',
  'commercial_cleaning',
  'plumbing',
  'electrical',
  'roofing',
  'hvac',
  'window_cleaning',
  'other',
] as const;
export type DemoIndustry = typeof DEMO_INDUSTRY_VALUES[number];

export interface SubmitDemoRequestPayload {
  full_name: string;
  company_name: string;
  email: string;
  phone: string;
  industry: DemoIndustry;
  employee_count?: string | null;
  source?: string | null;
  availability?: string | null;
  message?: string | null;
}

/** Public — no auth required. Just sends an email to the platform owner. */
export async function submitDemoRequest(payload: SubmitDemoRequestPayload): Promise<{ ok: true; message: string }> {
  const res = await fetch('/api/public/book-demo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || 'Submission failed.');
  return body;
}
