// Propriétés d'un client — les adresses où le travail se fait.
//
// Un client peut en avoir plusieurs (un duplex, deux commerces…). Le web laisse
// rattacher un job à l'une d'elles (jobs.property_id); le mobile ne le
// permettait pas, donc un job créé au téléphone perdait cette information.

import { supabase } from '../supabase';

export interface Property {
  id: string;
  client_id: string | null;
  name: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  is_primary: boolean | null;
}

const COLS =
  'id, client_id, name, address, city, province, postal_code, latitude, longitude, is_primary';

/** Les propriétés d'un client, la principale en tête. */
export async function listClientProperties(clientId: string): Promise<Property[]> {
  if (!clientId) return [];
  const { data, error } = await supabase
    .from('properties')
    .select(COLS)
    .eq('client_id', clientId)
    .is('deleted_at', null)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Property[];
}

/** Adresse lisible d'une propriété, pour une liste. */
export function libelleProperty(p: Property): string {
  const lieu = [p.address, p.city].filter(Boolean).join(', ');
  if (p.name && lieu) return `${p.name} — ${lieu}`;
  return p.name || lieu || '—';
}
