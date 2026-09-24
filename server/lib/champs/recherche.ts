/**
 * Recherche globale × champs personnalisés « cherchables ».
 *
 * cf_rechercher (SQL, index trigramme sur la forme normalisée) trouve les
 * valeurs ; on les rattache ici à la fiche que la recherche sait ouvrir :
 * client/prospect, job, devis, facture. Une valeur trouvée sur une
 * OPPORTUNITÉ mène à son client — c'est lui que la barre de recherche ouvre.
 *
 * Appelé avec le client À L'IDENTITÉ de l'utilisateur : la RLS décide de ce
 * qu'il voit (montants masqués, pipelines non partagés…).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { rechercher } from './service';
import { logger } from '../logger';

export interface ResultatRechercheChamp {
  type: 'client' | 'lead' | 'job' | 'quote' | 'invoice';
  id: string;
  title: string;
  subtitle: string;
  status: string | null;
  amountCents: null;
  currency: null;
  date: null;
  clientId: string | null;
  clientName: string | null;
  refId: null;
  createdAt: string;
  rank: number;
}

const nomClient = (c: { first_name?: string | null; last_name?: string | null; company?: string | null } | null | undefined) =>
  [c?.first_name, c?.last_name].filter(Boolean).join(' ').trim() || c?.company || '—';

export async function rechercherDansChamps(db: SupabaseClient, orgId: string, q: string, dejaVus: Set<string>): Promise<ResultatRechercheChamp[]> {
  try {
    const trouves = await rechercher(db, orgId, q, 20);
    if (trouves.length === 0) return [];
    const ids = (o: string) => [...new Set(trouves.filter((t) => t.object_type === o).map((t) => t.entity_id))];

    // Opportunité → son client.
    const clientDuDeal = new Map<string, string>();
    if (ids('deal').length) {
      const { data } = await db.from('deals').select('id, client_id').eq('org_id', orgId).in('id', ids('deal'));
      for (const d of data ?? []) clientDuDeal.set(d.id as string, d.client_id as string);
    }
    const idsClients = [...new Set([...ids('client'), ...clientDuDeal.values()])];
    const [clients, jobs, devis, factures] = await Promise.all([
      idsClients.length ? db.from('clients').select('id, first_name, last_name, company, status, created_at').eq('org_id', orgId).in('id', idsClients).is('deleted_at', null) : { data: [] },
      ids('job').length ? db.from('jobs').select('id, title, job_number, client_id, created_at').eq('org_id', orgId).in('id', ids('job')).is('deleted_at', null) : { data: [] },
      ids('quote').length ? db.from('quotes').select('id, title, quote_number, client_id, created_at').eq('org_id', orgId).in('id', ids('quote')).is('deleted_at', null) : { data: [] },
      ids('invoice').length ? db.from('invoices').select('id, invoice_number, client_id, created_at').eq('org_id', orgId).in('id', ids('invoice')).is('deleted_at', null) : { data: [] },
    ]);
    const parId = <T extends { id: string }>(rows: T[] | null | undefined) => new Map((rows ?? []).map((r) => [r.id, r]));
    const mc = parId(clients.data as { id: string; first_name: string | null; last_name: string | null; company: string | null; status: string | null; created_at: string }[]);
    const mj = parId(jobs.data as { id: string; title: string | null; job_number: string | null; client_id: string | null; created_at: string }[]);
    const mq = parId(devis.data as { id: string; title: string | null; quote_number: string | null; client_id: string | null; created_at: string }[]);
    const mi = parId(factures.data as { id: string; invoice_number: string | null; client_id: string | null; created_at: string }[]);

    const res: ResultatRechercheChamp[] = [];
    const base = { amountCents: null, currency: null, date: null, refId: null, rank: 0.4 } as const;
    for (const t of trouves) {
      const sousTitre = `${t.field_label} : ${t.value_text}`;
      if (t.object_type === 'client' || t.object_type === 'deal') {
        const cid = t.object_type === 'deal' ? clientDuDeal.get(t.entity_id) : t.entity_id;
        const c = cid ? mc.get(cid) : undefined;
        if (!c || dejaVus.has(c.id)) continue;
        dejaVus.add(c.id);
        res.push({ ...base, type: c.status === 'lead' ? 'lead' : 'client', id: c.id, title: nomClient(c), subtitle: sousTitre,
          status: c.status, clientId: c.id, clientName: nomClient(c), createdAt: c.created_at });
      } else if (t.object_type === 'job') {
        const j = mj.get(t.entity_id);
        if (!j || dejaVus.has(j.id)) continue;
        dejaVus.add(j.id);
        res.push({ ...base, type: 'job', id: j.id, title: j.title || `#${j.job_number ?? ''}`, subtitle: sousTitre,
          status: null, clientId: j.client_id, clientName: null, createdAt: j.created_at });
      } else if (t.object_type === 'quote') {
        const d = mq.get(t.entity_id);
        if (!d || dejaVus.has(d.id)) continue;
        dejaVus.add(d.id);
        res.push({ ...base, type: 'quote', id: d.id, title: d.title || `#${d.quote_number ?? ''}`, subtitle: sousTitre,
          status: null, clientId: d.client_id, clientName: null, createdAt: d.created_at });
      } else if (t.object_type === 'invoice') {
        const f = mi.get(t.entity_id);
        if (!f || dejaVus.has(f.id)) continue;
        dejaVus.add(f.id);
        res.push({ ...base, type: 'invoice', id: f.id, title: `#${f.invoice_number ?? ''}`, subtitle: sousTitre,
          status: null, clientId: f.client_id, clientName: null, createdAt: f.created_at });
      }
    }
    return res;
  } catch (err) {
    // La recherche principale ne doit jamais tomber à cause des champs.
    logger.error('[champs] recherche dans les champs personnalisés', { message: String(err) });
    return [];
  }
}
