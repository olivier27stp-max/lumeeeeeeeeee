/**
 * « Optimiser la journée » dans Lumi (audit Agenda, 2026-09-30) — zéro LLM.
 *
 * Deux portes, une seule réponse :
 *  - le bouton du Calendrier → POST /lumi/action (action « optimiser-journee ») ;
 *  - le texte « optimise ma journée de demain » → reconnu par motif ici, avant le modèle.
 *
 * Réponse rendue par gabarit : le résumé (avant/après par équipe, visites
 * déplacées, fixes et pourquoi, contraintes impossibles), puis — seulement s'il
 * y a quelque chose à gagner — la carte de confirmation standard de
 * apply_day_optimization. Rien ne bouge avant le clic « Confirmer ».
 */
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { executerOutilGarde, PERMISSION_PAR_OUTIL } from '../agent/garde';
import { getServiceClient } from '../supabase';
import { getUserContext, hasPermission } from '../rbac';
import { masquerIds } from '../agent/refs';
import type { PropositionJournee } from '../trajets/propositionJournee';

export interface CtxOptimisation { client: SupabaseClient; orgId: string; userId: string; accessToken?: string; language: 'fr' | 'en'; fuseau: string; maintenant?: Date }

export interface ReponseOptimisation {
  texte: string;
  carte: { tool_use_id: string; tool: 'apply_day_optimization'; args: Record<string, any>; capacite: string | null; apercu: ApercuOptimisation } | null;
  messages: Array<Record<string, any>>;
}

export interface ApercuOptimisation {
  genre: 'optimisation';
  date: string;
  fuseau: string;
  gain_minutes: number;
  lignes: Array<{ titre: string; equipe: string; avant: string; apres: string }>;
  clients: PropositionJournee['clients'];
}

const RAISONS: Record<string, { fr: string; en: string }> = {
  terminee: { fr: 'terminée', en: 'completed' },
  en_cours: { fr: 'en cours', en: 'in progress' },
  confirmee_client: { fr: 'heure déjà confirmée au client', en: 'time already confirmed to the client' },
  passee: { fr: 'heure passée', en: 'time already passed' },
};

/** « optimise ma journée », « optimise ma journée de demain », « optimize my day tomorrow »… */
export function detecterOptimisation(message: string): { quand: 'aujourdhui' | 'demain' | string } | null {
  // Minuscules, sans accents ni ponctuation ; les dates AAAA-MM-JJ restent entières.
  const t = message.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9-]+/g, ' ').trim();
  if (t.split(' ').length > 12) return null;
  const fr = /\b(optimise|optimiser|optimize|optimise moi|reorganise|reorganiser)\b.*\b(journee|tournee|trajets?|route|day|routes?)\b/.test(t);
  if (!fr) return null;
  const date = t.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  if (date) return { quand: date };
  if (/\b(demain|tomorrow)\b/.test(t)) return { quand: 'demain' };
  return { quand: 'aujourdhui' };
}

function jourLocal(d: Date, fuseau: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export function dateVisee(quand: string, fuseau: string, maintenant = new Date()): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(quand)) return quand;
  const auj = jourLocal(maintenant, fuseau);
  if (quand !== 'demain') return auj;
  const [a, m, j] = auj.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, j + 1)).toISOString().slice(0, 10);
}

/** Le résumé, par gabarit (jamais rédigé par un modèle). */
export function texteProposition(p: PropositionJournee, fr: boolean): string {
  const h = (iso: string) => new Intl.DateTimeFormat(fr ? 'fr-CA' : 'en-CA', { timeZone: p.fuseau, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  const jour = new Intl.DateTimeFormat(fr ? 'fr-CA' : 'en-CA', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${p.date}T12:00:00Z`));
  const km = (n: number) => `${new Intl.NumberFormat(fr ? 'fr-CA' : 'en-CA', { maximumFractionDigits: 1 }).format(n)} km`;
  const l: string[] = [];
  if (p.deja_optimisee) {
    l.push(fr ? `Ta journée du ${jour} est déjà optimisée : rien à gagner d’au moins 10 minutes.` : `Your day (${jour}) is already optimized: nothing to gain of at least 10 minutes.`);
  } else {
    l.push(fr ? `Proposition pour le ${jour} : ${p.gain_total_minutes} min de route en moins. Rien n’a bougé — confirme ci-dessous pour appliquer.` : `Proposal for ${jour}: ${p.gain_total_minutes} fewer minutes of driving. Nothing has moved — confirm below to apply.`);
  }
  for (const e of p.equipes) {
    if (!e.avant.ordre.length) continue;
    l.push('');
    l.push(`**${e.nom}** — ${fr ? 'avant' : 'before'} ${km(e.avant.km)} · ${e.avant.minutes_route} min, ${fr ? 'après' : 'after'} ${km(e.apres.km)} · ${e.apres.minutes_route} min${e.gain_minutes ? ` (−${e.gain_minutes} min)` : ''}`);
    for (const f of e.fixes) l.push(`- ${f.titre} : ${fr ? 'fixe' : 'fixed'} (${(RAISONS[f.raison] ?? RAISONS.passee)[fr ? 'fr' : 'en']})`);
    for (const i of e.impossibles) l.push(`- ⚠ ${i}`);
  }
  if (p.changements.length) {
    l.push('');
    l.push(fr ? '**Visites déplacées**' : '**Moved visits**');
    for (const c of p.changements) l.push(`- ${c.titre} : ${h(c.avant_debut)} → ${h(c.apres_debut)}`);
  }
  if (p.sans_adresse.length) {
    l.push('');
    l.push(fr ? `Sans adresse utilisable (non optimisées) : ${p.sans_adresse.map((s) => s.titre).join(', ')}.` : `No usable address (not optimized): ${p.sans_adresse.map((s) => s.titre).join(', ')}.`);
  }
  return l.join('\n');
}

export async function repondreOptimisation(ctx: CtxOptimisation, date: string, teamId: string | null): Promise<ReponseOptimisation | { refus: string }> {
  const fr = ctx.language === 'fr';
  const r = await executerOutilGarde({ name: 'propose_day_optimization', args: { date, ...(teamId ? { team_id: teamId } : {}) }, userId: ctx.userId, orgId: ctx.orgId, client: ctx.client, accessToken: ctx.accessToken });
  if ('refus' in r) return { refus: r.refus };
  const p = r.result as PropositionJournee & { a_appliquer?: Record<string, any> };
  const texte = texteProposition(p, fr);
  const espace = `${ctx.orgId}:${ctx.userId}`;
  const proposeId = `direct_${randomUUID()}`;
  const messages: Array<Record<string, any>> = [
    { role: 'assistant', content: [{ type: 'tool_use', id: proposeId, name: 'propose_day_optimization', input: masquerIds(espace, { date, ...(teamId ? { team_id: teamId } : {}) }) }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: proposeId, content: JSON.stringify(masquerIds(espace, { ...p, texte_affiche: texte })).slice(0, 60_000) }] },
  ];
  // Pas de carte qu'on ne pourrait pas confirmer : appliquer exige le droit
  // de replanifier (page Rôles), comme reschedule_job.
  const role = p.a_appliquer ? await getUserContext(getServiceClient(), ctx.userId, ctx.orgId) : null;
  const peutAppliquer = !!role && hasPermission(role, PERMISSION_PAR_OUTIL.apply_day_optimization.cle);
  if (!p.a_appliquer || !peutAppliquer) {
    const t = p.a_appliquer && !peutAppliquer
      ? `${texte}

${fr ? 'Tes accès permettent de voir cette proposition, pas de replanifier le calendrier : demande à un responsable de l’appliquer.' : 'Your access lets you see this proposal, not reschedule the calendar: ask a manager to apply it.'}`
      : texte;
    messages.push({ role: 'assistant', content: [{ type: 'text', text: t }] });
    return { texte: t, carte: null, messages };
  }
  const h = (iso: string) => new Intl.DateTimeFormat(fr ? 'fr-CA' : 'en-CA', { timeZone: p.fuseau, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  const nomEquipe = new Map(p.equipes.map((e) => [e.team_id ?? '', e.nom]));
  const apercu: ApercuOptimisation = {
    genre: 'optimisation', date: p.date, fuseau: p.fuseau, gain_minutes: p.gain_total_minutes, clients: p.clients,
    lignes: p.changements.map((c) => ({ titre: c.titre, equipe: nomEquipe.get(c.team_id ?? '') || '', avant: h(c.avant_debut), apres: h(c.apres_debut) })),
  };
  const toolUseId = `direct_${randomUUID()}`;
  const args = masquerIds(espace, p.a_appliquer);
  messages.push({ role: 'assistant', content: [{ type: 'text', text: texte }, { type: 'tool_use', id: toolUseId, name: 'apply_day_optimization', input: args }] });
  return {
    texte,
    carte: { tool_use_id: toolUseId, tool: 'apply_day_optimization', args, capacite: PERMISSION_PAR_OUTIL.apply_day_optimization?.capacite ?? null, apercu },
    messages,
  };
}
