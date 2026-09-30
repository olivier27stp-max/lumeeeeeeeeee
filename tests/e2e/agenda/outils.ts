/**
 * Outils des tests de l'Agenda : lecture de la base LOCALE (clé service), et
 * repères du jeu de données (visites nommées par leur clé : e<équipe>-<jour>-<n>).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { URL_SUPABASE, CLE_ANON } from './session';

let admin: SupabaseClient | null = null;
export function base(): SupabaseClient {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_SUPABASE)) throw new Error('Base locale seulement.');
  admin ??= createClient(URL_SUPABASE, process.env.AGENDA_LOCAL_SERVICE_KEY || '', { auth: { persistSession: false } });
  return admin;
}

export async function clientConnecte(email: string): Promise<SupabaseClient> {
  const c = createClient(URL_SUPABASE, CLE_ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: 'DevLocal1234!' });
  if (error) throw error;
  return c;
}

export interface VisiteDb { id: string; job_id: string; team_id: string | null; start_at: string; end_at: string; status: string; notes: string | null }

/** La visite dont la job porte « Lavage — <cle> ». */
export async function visite(cle: string): Promise<VisiteDb> {
  const { data, error } = await base().from('schedule_events').select('id, job_id, team_id, start_at, end_at, status, notes').eq('title', `Lavage — ${cle}`).is('deleted_at', null).limit(1).single();
  if (error || !data) throw new Error(`visite ${cle} : ${error?.message}`);
  return data as VisiteDb;
}

export async function orgTest(): Promise<string> {
  const { data } = await base().from('orgs').select('id').eq('name', 'Agenda — entreprise de test').single();
  return (data as { id: string }).id;
}

export async function equipeParNom(nom: string): Promise<string> {
  const org = await orgTest();
  const { data } = await base().from('teams').select('id').eq('org_id', org).eq('name', nom).single();
  return (data as { id: string }).id;
}

/** Heure affichée « 8 h 00 » (fr-CA) d'un instant, au fuseau de l'entreprise. */
export function heureFr(iso: string): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Toronto', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}
