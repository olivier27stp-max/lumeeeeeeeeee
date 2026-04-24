import { createClient, SupabaseClient } from '@supabase/supabase-js';
import express from 'express';
import { getSupabaseAdminClient } from './supabaseAdmin';
import { supabaseUrl, supabaseAnonKey, supabaseServiceRoleKey } from './config';

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

  const orgId = await resolveOrgId(client);
  if (!orgId) {
    res.status(403).json({ error: 'No organization context found for user.' });
    return null;
  }

  return { client, orgId, user };
}

export async function isOrgMember(client: SupabaseClient, userId: string, orgId: string) {
  if (!userId || !orgId) return false;
  if (userId === orgId) return true;

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
  if (userId === orgId) return true;

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
