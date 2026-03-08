import { supabase } from './supabase';

export async function geocodeJob(jobId: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return;

  try {
    const res = await fetch('/api/geocode-job', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jobId }),
    });
    if (!res.ok) {
      console.warn(`[geocode] failed for job ${jobId}: ${res.status}`);
    }
  } catch (err) {
    console.warn(`[geocode] network error for job ${jobId}`, err);
  }
}
