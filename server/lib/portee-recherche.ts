/**
 * Recherche globale et portée de visibilité (self / team / company).
 *
 * search_global est SECURITY DEFINER et appelée avec la clé de service : elle
 * voit tout le bureau. Pour une personne à portée restreinte, chaque résultat
 * est revérifié avec SON client (RLS, policies « portee_membre ») : ce qu'elle
 * ne peut pas ouvrir disparaît, et les compteurs se recalculent sur ce qui
 * reste — sinon la recherche révélerait noms et totaux de tout le bureau.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserContext } from './rbac';

/** Propriétaire/admin et portée « company » : aucun filtre. */
export function estRestreint(ctx: UserContext | null | undefined): boolean {
  return !!ctx && ctx.role !== 'owner' && ctx.role !== 'admin' && ['self', 'assigned', 'team'].includes(ctx.scope);
}

const TABLE_PAR_TYPE: Record<string, string> = {
  client: 'clients',
  lead: 'clients',
  job: 'jobs',
  quote: 'quotes',
  invoice: 'invoices',
  event: 'schedule_events',
};
/** Types sans donnée client (noms d'équipes) : gardés tels quels. */
const TYPES_NEUTRES = new Set(['team']);

/**
 * Garde les résultats que la personne peut ouvrir. Un type sans table vérifiable
 * (propriété, paiement, entente, demande) n'est gardé que si son client est visible.
 */
export async function filtrerVisibles<T extends { type: string; id: string; clientId?: string | null }>(
  client: SupabaseClient, items: T[],
): Promise<T[]> {
  if (!items.length) return items;
  const parTable = new Map<string, Set<string>>();
  const ajouter = (table: string, id: string | null | undefined) => {
    if (!id) return;
    const ens = parTable.get(table) || new Set<string>();
    ens.add(id);
    parTable.set(table, ens);
  };
  for (const it of items) {
    const table = TABLE_PAR_TYPE[it.type];
    if (table) ajouter(table, it.id);
    else if (!TYPES_NEUTRES.has(it.type)) ajouter('clients', it.clientId);
  }
  const visibles = new Map<string, Set<string>>();
  await Promise.all([...parTable.entries()].map(async ([table, ids]) => {
    const { data, error } = await client.from(table).select('id').in('id', [...ids]);
    if (error) throw error;
    visibles.set(table, new Set((data || []).map((r: { id: string }) => r.id)));
  }));
  return items.filter((it) => {
    if (TYPES_NEUTRES.has(it.type)) return true;
    const table = TABLE_PAR_TYPE[it.type];
    if (table) return visibles.get(table)?.has(it.id) ?? false;
    return !!it.clientId && (visibles.get('clients')?.has(it.clientId) ?? false);
  });
}
