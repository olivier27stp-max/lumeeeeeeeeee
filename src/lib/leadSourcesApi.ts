import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

export interface LeadSourceRecord {
  id: string;
  org_id: string;
  name: string;
}

/**
 * Built-in lead sources shown to every org. Custom ones created via
 * "Create new lead source" live in the lead_sources table and are merged
 * with these in the UI. Stored on clients as plain text (clients.lead_source).
 */
export const DEFAULT_LEAD_SOURCES = [
  'Existing client',
  'Facebook',
  'Flyer',
  'Google',
  'Instagram',
  'Other',
  'Referral',
  'Vehicle wrap',
];

/**
 * French display labels for the built-in sources. Display-only: the value
 * stored in the DB (clients.lead_source) stays the English name above.
 */
export const DEFAULT_LEAD_SOURCE_LABELS_FR: Record<string, string> = {
  'Existing client': 'Client existant',
  'Facebook': 'Facebook',
  'Flyer': 'Dépliant',
  'Google': 'Google',
  'Instagram': 'Instagram',
  'Other': 'Autre',
  'Referral': 'Référence',
  'Vehicle wrap': 'Lettrage de véhicule',
};

export async function listLeadSources(): Promise<LeadSourceRecord[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('lead_sources')
    .select('id, org_id, name')
    .eq('org_id', orgId)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data || []) as LeadSourceRecord[];
}

export async function createLeadSource(name: string): Promise<LeadSourceRecord> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Lead source name is required.');
  const orgId = await getCurrentOrgIdOrThrow();
  // Upsert: re-creating an existing source just returns it.
  const { data, error } = await supabase
    .from('lead_sources')
    .upsert({ org_id: orgId, name: trimmed }, { onConflict: 'org_id,name' })
    .select('id, org_id, name')
    .single();
  if (error) throw error;
  return data as LeadSourceRecord;
}
