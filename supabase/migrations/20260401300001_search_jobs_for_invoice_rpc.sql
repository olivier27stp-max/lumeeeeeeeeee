/* ═══════════════════════════════════════════════════════════════
   RPC — search_jobs_for_invoice
   Returns jobs eligible for invoicing, with optional text search.
   Avoids the "column id is ambiguous" issue from PostgREST + RLS.
   ═══════════════════════════════════════════════════════════════ */

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
