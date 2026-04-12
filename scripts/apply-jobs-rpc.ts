import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function run() {
  const sql = `
    CREATE OR REPLACE FUNCTION public.search_jobs_for_invoice(p_search text DEFAULT '')
    RETURNS TABLE (
      id uuid,
      title text,
      status text,
      total_cents bigint,
      client_id uuid,
      client_name text,
      property_address text,
      scheduled_at timestamptz,
      created_at timestamptz
    )
    LANGUAGE sql
    STABLE
    SECURITY INVOKER
    SET search_path = public
    AS $$
      SELECT
        j.id,
        j.title,
        j.status,
        j.total_cents,
        j.client_id,
        j.client_name,
        j.property_address,
        j.scheduled_at,
        j.created_at
      FROM public.jobs j
      WHERE j.deleted_at IS NULL
        AND j.status IN ('completed', 'in_progress', 'scheduled')
        AND (
          p_search = ''
          OR j.title ILIKE '%' || p_search || '%'
          OR j.client_name ILIKE '%' || p_search || '%'
        )
      ORDER BY j.created_at DESC
      LIMIT 30;
    $$;
  `;

  // Use the Supabase Management API or direct SQL
  // Since we can't run raw SQL via the JS client, we use the REST SQL endpoint
  const res = await fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY!,
    },
    body: JSON.stringify({ sql }),
  });

  if (!res.ok) {
    // exec_sql may not exist, try via the SQL editor proxy
    console.log('exec_sql RPC not available, trying direct pg...');

    // Alternative: use supabase-js to call a helper
    const { error } = await sb.rpc('exec_sql', { sql });
    if (error) {
      console.log('Could not apply via RPC:', error.message);
      console.log('\nPlease run this SQL in the Supabase Dashboard SQL Editor:');
      console.log(sql);
      return;
    }
  }

  // Test the function
  const { data, error } = await sb.rpc('search_jobs_for_invoice', { p_search: '' });
  if (error) {
    console.log('❌ RPC test failed:', error.message);
    console.log('\nPlease run this SQL manually in Supabase Dashboard:');
    console.log(sql);
  } else {
    console.log(`✅ search_jobs_for_invoice works! Found ${(data || []).length} jobs`);
  }
}

run().catch(e => console.error(e));
