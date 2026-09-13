// Helpers purs du formulaire « Nouveau bureau » (POST /orgs/create-office).
// Séparés de la route pour être testés sans Express ni Supabase.

export interface OfficeAddress {
  street1?: string | null;
  street2?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
  country?: string | null;
}

export interface CreateOfficeInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address?: OfficeAddress | null;
}

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Adresse sur une ligne pour orgs.address (colonne texte libre). */
export function formatAddressLine(a: OfficeAddress | null | undefined): string {
  if (!a) return '';
  const parts = [clean(a.street1), clean(a.street2), clean(a.city), clean(a.province), clean(a.postal_code)]
    .filter(Boolean);
  return parts.join(', ');
}

/** Ligne orgs : le nom est obligatoire, le reste n'est écrit que si fourni. */
export function buildOrgInsert(input: CreateOfficeInput, createdBy: string, companyGroupId?: string | null) {
  const row: Record<string, any> = { name: clean(input.name), created_by: createdBy };
  if (companyGroupId) row.company_group_id = companyGroupId;
  if (clean(input.phone)) row.phone = clean(input.phone);
  if (clean(input.email)) row.email = clean(input.email).toLowerCase();
  const a = input.address;
  if (a) {
    const line = formatAddressLine(a);
    if (line) row.address = line;
    if (clean(a.city)) row.city = clean(a.city);
    if (clean(a.province)) row.region = clean(a.province);
    if (clean(a.postal_code)) row.postal_code = clean(a.postal_code);
    if (clean(a.country)) row.country = clean(a.country);
  }
  return row;
}

/**
 * Ligne company_settings (source d'affichage du nom/adresse partout dans le
 * CRM). Les colonnes texte sont NOT NULL DEFAULT '' : on n'écrit que ce qui
 * est renseigné pour rester compatible avec un schéma prod en retard.
 */
export function buildCompanySettingsInsert(input: CreateOfficeInput, orgId: string, createdBy: string) {
  const row: Record<string, any> = { org_id: orgId, created_by: createdBy, company_name: clean(input.name) };
  if (clean(input.phone)) row.phone = clean(input.phone);
  if (clean(input.email)) row.email = clean(input.email).toLowerCase();
  if (clean(input.website)) row.website = clean(input.website);
  const a = input.address;
  if (a) {
    if (clean(a.street1)) row.street1 = clean(a.street1);
    if (clean(a.street2)) row.street2 = clean(a.street2);
    if (clean(a.city)) row.city = clean(a.city);
    if (clean(a.province)) row.province = clean(a.province);
    if (clean(a.postal_code)) row.postal_code = clean(a.postal_code);
    if (clean(a.country)) row.country = clean(a.country);
  }
  return row;
}

export interface MembershipRow {
  user_id: string;
  role: string;
  status: string;
}

/**
 * Ne retient, parmi les ids demandés, que les owners/admins ACTIFS du bureau
 * source (jamais le créateur : il est déjà owner du nouveau bureau). Le rôle
 * est reporté tel quel — un admin du bureau A devient admin du bureau B.
 */
export function filterGrantable(
  requestedIds: string[],
  sourceMembers: MembershipRow[],
  creatorId: string,
): Array<{ user_id: string; role: 'owner' | 'admin' }> {
  const wanted = new Set(requestedIds.filter((id) => id && id !== creatorId));
  const out: Array<{ user_id: string; role: 'owner' | 'admin' }> = [];
  const seen = new Set<string>();
  for (const m of sourceMembers) {
    if (!wanted.has(m.user_id) || seen.has(m.user_id)) continue;
    if (m.status !== 'active') continue;
    if (m.role !== 'owner' && m.role !== 'admin') continue;
    seen.add(m.user_id);
    out.push({ user_id: m.user_id, role: m.role });
  }
  return out;
}
