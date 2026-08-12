import { createClient, SupabaseClient } from '@supabase/supabase-js';
import express from 'express';
import { getSupabaseAdminClient } from './supabaseAdmin';
import { supabaseUrl, supabaseAnonKey, supabaseServiceRoleKey } from './config';
import { ORG_UUID_RE, shouldUseRequestedOrg } from './active-org';
import { setSentryRequestOrg } from './sentry';

let adminClientCache: SupabaseClient | null = null;

export function buildSupabaseWithAuth(authorizationHeader: string) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorizationHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function getServiceClient() {
  if (!supabaseServiceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for secure payment secret operations.');
  }
  if (!adminClientCache) {
    adminClientCache = getSupabaseAdminClient(supabaseUrl, supabaseServiceRoleKey);
  }
  return adminClientCache;
}

/**
 * Look up an auth user by email without walking the entire auth.users table.
 * Uses the `get_user_id_by_email` RPC (SECURITY DEFINER, indexed lookup) and
 * falls back to a direct table query via the service-role client.
 *
 * Replaces the old `admin.auth.admin.listUsers()` pattern which is O(N) +
 * default-paginated (≤ 50 rows) + timing-oracle-friendly.
 */
export async function findUserByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<{ id: string; email: string | null; email_confirmed_at: string | null; user_metadata: any } | null> {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();

  // Preferred: RPC returns just the id (cheap, indexed)
  try {
    const { data, error } = await admin.rpc('get_user_id_by_email', { p_email: normalized });
    if (!error && data) {
      const id = typeof data === 'string' ? data : (data as any)?.id || (data as any)?.user_id;
      if (id) {
        try {
          const { data: u } = await (admin.auth.admin as any).getUserById(id);
          if (u?.user) return u.user as any;
        } catch (err) { console.error('[findUserByEmail] getUserById failed:', err); }
        return { id, email: normalized, email_confirmed_at: null, user_metadata: {} };
      }
    }
  } catch (err) { console.error('[findUserByEmail] rpc failed:', err); }

  // Fallback: direct query against auth.users via the service role.
  try {
    const { data } = await (admin as any)
      .schema('auth')
      .from('users')
      .select('id, email, email_confirmed_at, raw_user_meta_data')
      .ilike('email', normalized)
      .limit(1)
      .maybeSingle();
    if (data) {
      return {
        id: data.id,
        email: data.email,
        email_confirmed_at: data.email_confirmed_at,
        user_metadata: data.raw_user_meta_data || {},
      };
    }
  } catch (err) { console.error('[findUserByEmail] direct query failed:', err); }

  return null;
}

export async function resolveOrgId(client: SupabaseClient) {
  const { data, error } = await client.rpc('current_org_id');
  if (!error) return (data as string | null) || null;

  // Fallback when current_org_id() is not installed yet.
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();
  if (userError || !user?.id) return null;

  const { data: membership, error: membershipError } = await client
    .from('memberships')
    .select('org_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();
  if (membershipError) return null;
  return String(membership?.org_id || '') || null;
}

/**
 * Tous les bureaux (orgs) de la compagnie d'un org, via company_group_id.
 * L'abonnement vit sur UN bureau ; toute vérification de droits (plan, sièges,
 * bureaux) doit chercher sur l'ensemble du groupe. Retombe sur [orgId] si le
 * groupe n'existe pas (migration pas posée, org orpheline).
 */
export async function companyOrgIds(admin: SupabaseClient, orgId: string): Promise<string[]> {
  try {
    const { data: org } = await admin
      .from('orgs')
      .select('company_group_id')
      .eq('id', orgId)
      .maybeSingle();
    const gid = (org as any)?.company_group_id;
    if (!gid) return [orgId];
    const { data } = await admin.from('orgs').select('id').eq('company_group_id', gid);
    const ids = (data || []).map((o: any) => String(o.id));
    return ids.length ? ids : [orgId];
  } catch {
    return [orgId];
  }
}

export async function requireAuthedClient(req: express.Request, res: express.Response) {
  const authorizationHeader = req.header('authorization');
  if (!authorizationHeader) {
    res.status(401).json({ error: 'Missing authorization header.' });
    return null;
  }

  const client = buildSupabaseWithAuth(authorizationHeader);
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();

  if (userError || !user) {
    res.status(401).json({ error: 'Invalid auth token.' });
    return null;
  }

  // Office actif : le front transmet l'office réellement sélectionné via le
  // header `x-org-id` (un user peut être membre de plusieurs offices d'une même
  // compagnie). On ne l'honore QUE si l'utilisateur en est bien membre
  // (anti-IDOR) ; sinon on retombe sur current_org_id() (première membership).
  let orgId: string | null = null;
  const headerOrg = req.header('x-org-id');
  if (headerOrg && ORG_UUID_RE.test(headerOrg)) {
    const { data: isMember } = await client.rpc('has_org_membership', { p_user: user.id, p_org: headerOrg });
    if (shouldUseRequestedOrg(headerOrg, isMember === true)) orgId = headerOrg;
  }
  if (!orgId) orgId = await resolveOrgId(client);
  if (!orgId) {
    res.status(403).json({ error: 'No organization context found for user.' });
    return null;
  }

  // Toute erreur levée plus loin dans cette requête portera l'org — sinon
  // l'alerte Sentry ne dit pas chez quel client ça a planté. No-op sans DSN.
  setSentryRequestOrg(orgId, user.id);

  return { client, orgId, user };
}

export async function isOrgMember(client: SupabaseClient, userId: string, orgId: string) {
  if (!userId || !orgId) return false;

  const { data, error } = await client.rpc('has_org_membership', { p_user: userId, p_org: orgId });
  if (!error) return Boolean(data);

  // Fallback when has_org_membership() is not installed yet.
  const { data: row, error: membershipError } = await client
    .from('memberships')
    .select('org_id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (membershipError) return false;
  return Boolean(row?.org_id);
}

export async function isOrgAdminOrOwner(client: SupabaseClient, userId: string, orgId: string) {
  if (!userId || !orgId) return false;

  const { data: roleRow, error: roleError } = await client
    .from('memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!roleError && roleRow?.role) {
    const role = String(roleRow.role).toLowerCase();
    return role === 'owner' || role === 'admin';
  }

  const { data, error } = await client.rpc('has_org_admin_role', { p_user: userId, p_org: orgId });
  if (error) return false;
  return Boolean(data);
}
