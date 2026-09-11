/**
 * Briefing du matin — Lumi vient à toi.
 * ─────────────────────────────────────
 * Chaque matin (HEURE_BRIEFING, heure locale de l'org), pour chaque
 * propriétaire ou admin d'une org qui a Lumi et qui ne l'a pas coupé
 * (memberships.lumi_briefing) : une conversation Lumi pré-écrite — visites
 * du jour, factures en retard, tâches à faire, nouvelles demandes, textos non
 * lus — et une notification qui y mène. La personne répond dedans
 * (« relance Sophie ») et Lumi enchaîne avec tout le contexte.
 *
 * Le texte est composé ICI, sans appel au modèle : zéro coût, zéro chiffre
 * inventé. Les données viennent du même outil que « mon survol du jour »
 * (get_morning_briefing). Rien n'est envoyé quand il n'y a rien à dire.
 *
 * Idempotent : lumi_briefings garantit un briefing par (org, personne, jour),
 * même si le serveur redémarre ou tourne en double.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { TOOLS_BY_NAME } from '../agent/tools';
import { logger } from '../logger';

/** Heure locale (de l'org) à laquelle le briefing part. */
export const HEURE_BRIEFING = 6;
const FUSEAU_DEFAUT = 'America/Toronto';

export interface DonneesBriefing {
  date: string;
  overdue_invoices: { total_matching: number; total_cents: number; worst: Array<{ client: string; balance_cents: number; due_date: string | null }> };
  todays_visits: { total_matching: number; visits: Array<{ start_at: string; end_at?: string; job_number?: number | string | null; title?: string | null; client?: string | null; address?: string | null }> };
  tasks_due: { total_matching: number; tasks: Array<{ title: string; priorite?: string; echeance?: string | null }> };
  new_requests_48h: { total_matching: number; requests: Array<{ nom: string; ville: string | null; quand: string }> };
  unread_sms: { total_matching: number; conversations: Array<{ client: string; dernier_message?: string | null; non_lus: number }> };
}

// Espaces insécables d'Intl (U+202F, U+00A0) ramenées à une espace ordinaire : « 1 971,82 $ », comme partout dans Lume.
const fmtDollars = (cents: number, fr: boolean) => (fr
  ? `${(cents / 100).toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`
  : `$${(cents / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).replace(/[  ]/g, ' ');

function heureLocale(iso: string, fuseau: string, fr: boolean): string {
  try {
    const d = new Date(iso);
    // fr-CA donne « 9 h 00 » / « 14 h 30 » : on écrit « 9 h » quand les minutes sont nulles.
    const h = new Intl.DateTimeFormat(fr ? 'fr-CA' : 'en-CA', { hour: 'numeric', minute: '2-digit', hour12: !fr, timeZone: fuseau }).format(d);
    return fr ? h.replace(/ h 00$/, ' h') : h;
  } catch { return ''; }
}

function joursDeRetard(dueDate: string | null, jour: Date): number | null {
  if (!dueDate) return null;
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((jour.getTime() - d.getTime()) / 86_400_000));
}

function prenom(nomComplet: string | null | undefined): string {
  return (nomComplet || '').trim().split(/\s+/)[0] || '';
}

/**
 * Le texte du briefing. Exporté pour être testé : chaque phrase ne dit
 * que ce que les données contiennent, et une section vide disparaît.
 * Renvoie null quand il n'y a rien à dire (pas de briefing envoyé).
 */
export function composerBriefing(d: DonneesBriefing, opts: { prenom: string | null; fr: boolean; fuseau: string; maintenant: Date }): string | null {
  const { fr, fuseau } = opts;
  const parts: string[] = [];
  const v = d.todays_visits;
  if (v.total_matching > 0) {
    const liste = v.visits.slice(0, 4).map((x) => {
      const h = heureLocale(x.start_at, fuseau, fr);
      const qui = x.client || x.title || (x.job_number ? `#${x.job_number}` : '');
      return [h, qui].filter(Boolean).join(' ');
    }).filter(Boolean);
    const reste = v.total_matching - Math.min(4, v.visits.length);
    parts.push(fr
      ? `${v.total_matching} ${v.total_matching > 1 ? 'visites' : 'visite'} aujourd'hui${liste.length ? ` : ${liste.join(', ')}` : ''}${reste > 0 ? ` et ${reste} autre${reste > 1 ? 's' : ''}` : ''}.`
      : `${v.total_matching} ${v.total_matching > 1 ? 'visits' : 'visit'} today${liste.length ? `: ${liste.join(', ')}` : ''}${reste > 0 ? ` and ${reste} more` : ''}.`);
  } else {
    parts.push(fr ? 'Rien au calendrier aujourd’hui.' : 'Nothing on the calendar today.');
  }
  const o = d.overdue_invoices;
  if (o.total_matching > 0) {
    const pire = [...o.worst].sort((a, b) => (joursDeRetard(b.due_date, opts.maintenant) ?? 0) - (joursDeRetard(a.due_date, opts.maintenant) ?? 0))[0];
    const jours = pire ? joursDeRetard(pire.due_date, opts.maintenant) : null;
    parts.push(fr
      ? `${o.total_matching} ${o.total_matching > 1 ? 'factures' : 'facture'} en retard pour ${fmtDollars(o.total_cents, fr)}${pire ? `, la plus vieille chez ${pire.client}${jours != null ? ` (${jours} jours)` : ''}` : ''}.`
      : `${o.total_matching} overdue ${o.total_matching > 1 ? 'invoices' : 'invoice'} for ${fmtDollars(o.total_cents, fr)}${pire ? `, the oldest at ${pire.client}${jours != null ? ` (${jours} days)` : ''}` : ''}.`);
  }
  const t = d.tasks_due;
  if (t.total_matching > 0) {
    const liste = t.tasks.slice(0, 3).map((x) => x.title).filter(Boolean);
    parts.push(fr
      ? `${t.total_matching} ${t.total_matching > 1 ? 'tâches' : 'tâche'} à faire d’ici demain${liste.length ? ` : ${liste.join(', ')}` : ''}.`
      : `${t.total_matching} ${t.total_matching > 1 ? 'tasks' : 'task'} due by tomorrow${liste.length ? `: ${liste.join(', ')}` : ''}.`);
  }
  const r = d.new_requests_48h;
  if (r.total_matching > 0) {
    const liste = r.requests.slice(0, 3).map((x) => x.nom + (x.ville ? ` (${x.ville})` : '')).filter(Boolean);
    parts.push(fr
      ? `${r.total_matching} ${r.total_matching > 1 ? 'nouvelles demandes' : 'nouvelle demande'} depuis 48 h${liste.length ? ` : ${liste.join(', ')}` : ''}.`
      : `${r.total_matching} new ${r.total_matching > 1 ? 'requests' : 'request'} in the last 48 h${liste.length ? `: ${liste.join(', ')}` : ''}.`);
  }
  const s = d.unread_sms;
  if (s.total_matching > 0) {
    const liste = s.conversations.slice(0, 3).map((x) => x.client).filter(Boolean);
    parts.push(fr
      ? `${s.total_matching} ${s.total_matching > 1 ? 'textos non lus' : 'texto non lu'}${liste.length ? ` (${liste.join(', ')})` : ''}.`
      : `${s.total_matching} unread ${s.total_matching > 1 ? 'texts' : 'text'}${liste.length ? ` (${liste.join(', ')})` : ''}.`);
  }
  const rienASignaler = v.total_matching === 0 && o.total_matching === 0 && t.total_matching === 0 && r.total_matching === 0 && s.total_matching === 0;
  if (rienASignaler) return null;

  const salut = fr ? `Bonjour${opts.prenom ? ` ${opts.prenom}` : ''}.` : `Good morning${opts.prenom ? ` ${opts.prenom}` : ''}.`;
  const suites: string[] = [];
  if (o.total_matching > 0) suites.push(fr ? '« relance les retards »' : '“chase the overdue ones”');
  if (v.total_matching > 1) suites.push(fr ? '« prépare la tournée »' : '“plan the route”');
  if (r.total_matching > 0) suites.push(fr ? '« montre-moi les demandes »' : '“show me the requests”');
  const cloture = suites.length
    ? (fr ? `Dis-moi ${suites.join(' ou ')} et je m’en occupe.` : `Say ${suites.join(' or ')} and I’ll take care of it.`)
    : (fr ? 'Dis-moi si tu veux que je m’occupe de quelque chose.' : 'Tell me if you want me to handle anything.');
  return `${salut} ${parts.join(' ')} ${cloture}`;
}

/** Heure locale courante d'un fuseau, sans dépendance. */
export function heureDansFuseau(fuseau: string, maintenant = new Date()): { heure: number; jour: string } {
  try {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, hour: 'numeric', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' });
    const p = Object.fromEntries(f.formatToParts(maintenant).map((x) => [x.type, x.value]));
    return { heure: Number(p.hour) % 24, jour: `${p.year}-${p.month}-${p.day}` };
  } catch {
    return heureDansFuseau(FUSEAU_DEFAUT, maintenant);
  }
}

function titreBriefing(jour: string, fr: boolean): string {
  const d = new Date(`${jour}T12:00:00Z`);
  const s = d.toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return fr ? `Ton matin du ${s}` : `Your morning, ${s}`;
}

/**
 * Passe du cron (toutes les heures) : pour chaque org qui a Lumi et dont
 * l'heure locale est HEURE_BRIEFING, un briefing par propriétaire/admin
 * qui ne l'a pas coupé et ne l'a pas encore reçu aujourd'hui.
 * Renvoie le nombre de briefings créés.
 */
export async function genererBriefingsDuMatin(admin: SupabaseClient, maintenant = new Date()): Promise<number> {
  const { data: abonnements, error } = await admin
    .from('subscriptions')
    .select('org_id, status, plans:plan_id (includes_ai, ai_monthly_budget_cents)')
    .in('status', ['active', 'trialing', 'past_due']);
  if (error) { logger.error('[lumi/briefing] abonnements illisibles', { error: error.message }); return 0; }
  const orgs = [...new Set((abonnements ?? []).filter((s: any) => s.plans?.includes_ai && Number(s.plans?.ai_monthly_budget_cents) > 0).map((s: any) => String(s.org_id)))];
  let crees = 0;
  for (const orgId of orgs) {
    try {
      crees += await briefingPourOrg(admin, orgId, maintenant);
    } catch (e: any) {
      logger.error('[lumi/briefing] org en échec', { orgId, error: e?.message || String(e) });
    }
  }
  return crees;
}

async function briefingPourOrg(admin: SupabaseClient, orgId: string, maintenant: Date): Promise<number> {
  const { data: cs } = await admin.from('company_settings').select('timezone').eq('org_id', orgId).maybeSingle();
  const fuseau = (cs as any)?.timezone || FUSEAU_DEFAUT;
  const { heure, jour } = heureDansFuseau(fuseau, maintenant);
  if (heure !== HEURE_BRIEFING) return 0;

  const { data: membres } = await admin
    .from('memberships')
    .select('user_id, role, language, full_name, lumi_briefing')
    .eq('org_id', orgId).eq('status', 'active').in('role', ['owner', 'admin']);
  const cibles = (membres ?? []).filter((m: any) => m.lumi_briefing !== false);
  if (!cibles.length) return 0;

  const { data: deja } = await admin.from('lumi_briefings').select('user_id').eq('org_id', orgId).eq('jour', jour);
  const faits = new Set((deja ?? []).map((x: any) => String(x.user_id)));
  const restants = cibles.filter((m: any) => !faits.has(String(m.user_id)));
  if (!restants.length) return 0;

  // Les données : le même outil que « mon survol du jour », avec le client service.
  const outil = TOOLS_BY_NAME.get_morning_briefing;
  if (!outil?.handler) return 0;
  const donnees = await outil.handler({}, { client: admin, orgId, userId: String(restants[0].user_id) }) as DonneesBriefing | { error: string };
  if (!donnees || 'error' in donnees) { logger.error('[lumi/briefing] données indisponibles', { orgId, error: (donnees as any)?.error }); return 0; }

  let crees = 0;
  for (const m of restants) {
    const fr = (m.language || 'fr') !== 'en';
    const texte = composerBriefing(donnees, { prenom: prenom(m.full_name), fr, fuseau, maintenant });
    // Idempotence d'abord : la ligne est posée AVANT la conversation ; si un
    // second serveur passe en même temps, un seul gagne la clé primaire.
    const { error: verrou } = await admin.from('lumi_briefings').insert({ org_id: orgId, user_id: m.user_id, jour });
    if (verrou) continue;
    if (!texte) continue; // rien à dire : la ligne empêche de revérifier toute la journée
    const { data: conv, error: eConv } = await admin.from('lumi_conversations')
      .insert({ org_id: orgId, user_id: m.user_id, title: titreBriefing(jour, fr) })
      .select('id').single();
    if (eConv || !conv) { logger.error('[lumi/briefing] conversation non créée', { orgId, error: eConv?.message }); continue; }
    const { error: eMsg } = await admin.from('lumi_messages').insert({
      conversation_id: conv.id, org_id: orgId, role: 'assistant', content: [{ type: 'text', text: texte }] as any,
    });
    if (eMsg) { logger.error('[lumi/briefing] message non créé', { orgId, error: eMsg.message }); continue; }
    await admin.from('lumi_briefings').update({ conversation_id: conv.id }).eq('org_id', orgId).eq('user_id', m.user_id).eq('jour', jour);
    const { error: eNotif } = await admin.from('notifications').insert({
      org_id: orgId, user_id: m.user_id, type: 'lumi_briefing', category: 'lumi',
      title: fr ? 'Ton matin avec Lumi' : 'Your morning with Lumi',
      body: texte.length > 180 ? `${texte.slice(0, 177)}…` : texte,
      link: `/lumi?c=${conv.id}`,
    });
    if (eNotif) logger.error('[lumi/briefing] notification non créée', { orgId, error: eNotif.message });
    crees += 1;
  }
  if (crees) logger.info('[lumi/briefing] briefings créés', { orgId, crees, jour });
  return crees;
}
