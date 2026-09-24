/**
 * Le Reçu — lecture des données.
 * ──────────────────────────────
 * Le seul fichier du reçu qui parle à la base. `attribution.ts` et
 * `argent-qui-dort.ts` restent des fonctions pures : ils reçoivent ce que
 * celui-ci a lu. C'est ce qui permet de les tester au cas limite près sans
 * base de données.
 *
 * Tout est lu avec le client service (le briefing tourne dans un cron, hors
 * session), donc chaque requête porte son `org_id` explicitement : sans
 * session, la RLS ne cloisonne rien.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { trouverArgentQuiDort, type ArgentQuiDort, type EntreeDevis, type EntreeFacture } from './argent-qui-dort';

/** Ce qu'on affiche au plus dans le briefing : au-delà, ça devient une liste. */
export const TOP_BRIEFING = 3;

function nomClient(c: any): string | null {
  if (!c) return null;
  if (c.display_as_company && c.company) return String(c.company);
  const n = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
  return n || (c.company ? String(c.company) : null);
}

/**
 * L'argent qui dort d'une org : devis envoyés sans suivi récent + factures
 * échues impayées.
 *
 * Ne lève jamais : le briefing doit partir même si cette section échoue. En
 * cas de problème de lecture, on renvoie un résultat vide plutôt que de
 * bloquer le reste du message.
 */
export async function lireArgentQuiDort(
  admin: SupabaseClient,
  orgId: string,
  opts: { maintenant?: Date; top?: number } = {},
): Promise<ArgentQuiDort> {
  const vide: ArgentQuiDort = { totalCents: 0, devisTotalCents: 0, facturesTotalCents: 0, devis: [], factures: [] };

  const [qRes, iRes] = await Promise.all([
    admin
      .from('quotes')
      .select('id, status, total_cents, client_id, sent_via_email_at, sent_via_sms_at, approved_at')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      // Seuls les devis encore en jeu ; `draft` n'est pas de l'argent qui dort.
      .in('status', ['awaiting_response', 'changes_requested']),
    admin
      .from('invoices')
      .select('id, status, balance_cents, due_date, client_id')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .in('status', ['sent', 'partial']),
  ]);

  if (qRes.error || iRes.error) return vide;

  const quotes = qRes.data ?? [];
  const invoices = iRes.data ?? [];
  if (!quotes.length && !invoices.length) return vide;

  // Les relances déjà parties, pour ne pas réveiller un devis relancé hier.
  // `automation_execution_logs` est la seule table qui relie une relance à un
  // devis précis (`quote_send_log` ne couvre que les envois manuels).
  const derniereRelance = new Map<string, Date>();
  if (quotes.length) {
    const { data: logs } = await admin
      .from('automation_execution_logs')
      .select('entity_id, created_at')
      .eq('org_id', orgId)
      .eq('entity_type', 'quote')
      .eq('result_success', true)
      .in('action_type', ['send_email', 'send_sms'])
      .in('entity_id', quotes.map((q: any) => q.id));
    for (const l of logs ?? []) {
      const d = new Date((l as any).created_at);
      const vu = derniereRelance.get((l as any).entity_id);
      if (!vu || d > vu) derniereRelance.set((l as any).entity_id, d);
    }
  }

  // Les noms, en une seule requête : le briefing nomme les gens, pas des ids.
  const clientIds = [...new Set([...quotes, ...invoices].map((x: any) => x.client_id).filter(Boolean))];
  const noms = new Map<string, string | null>();
  if (clientIds.length) {
    const { data: cs } = await admin
      .from('clients')
      .select('id, first_name, last_name, company, display_as_company')
      .eq('org_id', orgId)
      .in('id', clientIds);
    for (const c of cs ?? []) noms.set((c as any).id, nomClient(c));
  }

  const premier = (a: string | null, b: string | null): Date | null => {
    const d = [a, b].filter(Boolean).map((x) => new Date(x as string)).sort((x, y) => x.getTime() - y.getTime());
    return d[0] ?? null;
  };

  const entreesDevis: EntreeDevis[] = quotes.map((q: any) => ({
    devisId: q.id,
    montantCents: q.total_cents ?? 0,
    client: q.client_id ? noms.get(q.client_id) ?? null : null,
    statut: q.status,
    envoyeA: premier(q.sent_via_email_at, q.sent_via_sms_at),
    derniereRelanceA: derniereRelance.get(q.id) ?? null,
    signeA: q.approved_at ? new Date(q.approved_at) : null,
  }));

  const entreesFactures: EntreeFacture[] = invoices.map((i: any) => ({
    factureId: i.id,
    soldeCents: i.balance_cents ?? 0,
    client: i.client_id ? noms.get(i.client_id) ?? null : null,
    statut: i.status,
    echeanceLe: i.due_date,
  }));

  return trouverArgentQuiDort(
    { devis: entreesDevis, factures: entreesFactures },
    { maintenant: opts.maintenant, top: opts.top ?? TOP_BRIEFING },
  );
}
