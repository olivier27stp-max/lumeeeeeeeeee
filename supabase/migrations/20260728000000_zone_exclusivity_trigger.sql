-- ============================================================
-- Zone exclusivity — DB-level guarantee
-- A field_territories row with assigned_user_id only accepts pins (rows in
-- field_house_profiles) created by that user. Owner/admin bypass.
--
-- Scope: DIRECT client inserts (the mobile app writes to PostgREST with the
-- user's JWT). Service-role inserts (the web API) have auth.uid() = null and
-- are skipped here — the Express route enforces the same rule itself
-- (server/routes/field-sales.ts POST /houses).
-- ============================================================
begin;

-- Ray-casting point-in-polygon on the first ring of a GeoJSON Polygon.
create or replace function public._point_in_zone_ring(
  p_lng double precision,
  p_lat double precision,
  geo jsonb
) returns boolean
language plpgsql immutable
as $$
declare
  ring jsonb;
  n int;
  i int;
  j int;
  xi float8; yi float8; xj float8; yj float8;
  inside boolean := false;
begin
  ring := geo->'coordinates'->0;
  if ring is null or jsonb_typeof(ring) <> 'array' then
    return false;
  end if;
  n := jsonb_array_length(ring);
  if n < 3 then
    return false;
  end if;
  j := n - 1;
  for i in 0..n-1 loop
    xi := (ring->i->>0)::float8; yi := (ring->i->>1)::float8;
    xj := (ring->j->>0)::float8; yj := (ring->j->>1)::float8;
    if ((yi > p_lat) <> (yj > p_lat))
       and (p_lng < (xj - xi) * (p_lat - yi) / (yj - yi) + xi) then
      inside := not inside;
    end if;
    j := i;
  end loop;
  return inside;
end $$;

create or replace function public.enforce_zone_exclusivity()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_role text;
  z record;
begin
  v_uid := auth.uid();
  -- Service-role / server inserts: the API enforces the rule itself.
  if v_uid is null then
    return new;
  end if;
  if new.lat is null or new.lng is null then
    return new;
  end if;
  select role into v_role
    from public.memberships
   where org_id = new.org_id and user_id = v_uid
   limit 1;
  if v_role in ('owner', 'admin') then
    return new;
  end if;
  for z in
    select name, polygon_geojson
      from public.field_territories
     where org_id = new.org_id
       and deleted_at is null
       and assigned_user_id is not null
       and assigned_user_id <> v_uid
  loop
    if public._point_in_zone_ring(new.lng, new.lat, z.polygon_geojson) then
      raise exception 'Zone « % » réservée — assignée à un autre représentant.', z.name
        using errcode = 'P0001';
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists trg_zone_exclusivity on public.field_house_profiles;
create trigger trg_zone_exclusivity
  before insert on public.field_house_profiles
  for each row execute function public.enforce_zone_exclusivity();

commit;
