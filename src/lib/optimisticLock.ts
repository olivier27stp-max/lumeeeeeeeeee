import { supabase } from './supabase';

/**
 * Optimistic locking helper — wraps a Supabase update with version check.
 * If `expectedVersion` is provided, adds `.eq('version', expectedVersion)` to the query.
 * If no rows are updated (version mismatch), throws a ConflictError.
 *
 * The DB trigger auto-increments `version` on every UPDATE, so callers
 * don't need to manage version values — just pass the version they loaded.
 */
export class ConflictError extends Error {
  constructor(entity: string) {
    super(`This ${entity} was modified by another user. Please refresh and try again.`);
    this.name = 'ConflictError';
  }
}

export async function optimisticUpdate<T = any>(
  table: string,
  id: string,
  payload: Record<string, any>,
  expectedVersion?: number,
): Promise<T> {
  let query = supabase
    .from(table)
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (expectedVersion != null) {
    query = query.eq('version', expectedVersion);
  }

  const { data, error, count } = await query.select('*').single();

  if (error) {
    // PGRST116 = "JSON object requested, multiple (or no) rows returned"
    // This happens when version doesn't match (0 rows updated)
    if (error.code === 'PGRST116' && expectedVersion != null) {
      throw new ConflictError(table);
    }
    throw error;
  }

  return data as T;
}
