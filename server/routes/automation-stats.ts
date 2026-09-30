/* ═══════════════════════════════════════════════════════════════
   Route — statistiques des automatisations (UNE route agrégée)

   GET /api/automations/rules/stats            → par automatisation
   GET /api/automations/rules/stats?rule_id=…  → + par étape de CE parcours

   Audit du 2026-09-28 : « Total déclenché » et « En cours » affichaient
   toujours « — », et l'onglet « Statistiques » d'une étape toujours
   « Aucun passage encore » (`stats={null}`). Les données existaient dans
   `automation_scheduled_tasks` et `automation_execution_logs` ; personne
   ne les comptait.

   CE QUI EST COMPTÉ (fenêtre de 60 jours, comme l'Historique) :
   · declenches — fiches distinctes (client, devis, job…) pour lesquelles
                  l'automatisation s'est déclenchée ;
   · en_cours   — fiches distinctes qui ont encore une étape en attente
                  (sans limite de date : elles sont en cours MAINTENANT) ;
   · envoyes / sautes / echecs — exécutions d'action. Une étape SAUTÉE
     (`result_data.saute` : pas de numéro texto, pas de courriel, déjà
     envoyé…) n'est ni un envoi ni un échec : elle est comptée à part.

   Client de l'UTILISATEUR (RLS), jamais service_role.
   ═══════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAuthedClient } from '../lib/supabase';
import { logger } from '../lib/logger';
import { twilioClient } from '../lib/config';
import { getOrgSmsChannel } from '../lib/twilioProvisioning';

const router = Router();

const FENETRE_JOURS = 60;
/** PostgREST plafonne une réponse à 1 000 lignes : on pagine. */
const PAGE = 1000;
const MAX_LIGNES = 20_000;

export interface StatsRegle {
  declenches: number;
  en_cours: number;
  envoyes: number;
  sautes: number;
  echecs: number;
  /** Le motif (en français, prêt à afficher) de la dernière étape sautée. */
  dernier_saut: string | null;
}

export interface StatsEtape {
  envoyes: number;
  sautes: number;
  echecs: number;
  en_attente: number;
}

interface LigneTache {
  id: string;
  automation_rule_id: string;
  entity_id: string;
  status: string;
  step_id: string | null;
}

interface LigneJournal {
  automation_rule_id: string | null;
  entity_id: string;
  scheduled_task_id: string | null;
  result_success: boolean;
  result_error: string | null;
  saute: string | null;
  created_at?: string;
}

/** Lit toutes les pages d'une requête (bornée à MAX_LIGNES). */
async function toutLire<T>(
  construire: (de: number, a: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const lignes: T[] = [];
  for (let de = 0; de < MAX_LIGNES; de += PAGE) {
    const { data, error } = await construire(de, de + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as T[];
    lignes.push(...page);
    if (page.length < PAGE) break;
  }
  return lignes;
}

/** Une exécution « en cours » (réservation du moteur) n'est pas encore un résultat. */
function estResultat(l: LigneJournal): boolean {
  return !(l.result_success === false && l.result_error === 'en cours');
}

export function classerJournal(l: LigneJournal): 'envoye' | 'saute' | 'echec' | null {
  if (!estResultat(l)) return null;
  if (!l.result_success) return 'echec';
  return l.saute ? 'saute' : 'envoye';
}

export async function calculerStatistiques(
  client: SupabaseClient,
  orgId: string,
  ruleId: string | null,
  maintenant: Date = new Date(),
): Promise<{ par_regle: Record<string, StatsRegle>; par_etape: Record<string, StatsEtape> | null }> {
  const depuis = new Date(maintenant.getTime() - FENETRE_JOURS * 86400_000).toISOString();

  const taches = await toutLire<LigneTache>((de, a) => {
    let q = client
      .from('automation_scheduled_tasks')
      .select('id, automation_rule_id, entity_id, status, step_id')
      .eq('org_id', orgId)
      .or(`status.in.(pending,running),created_at.gte.${depuis}`)
      .order('id')
      .range(de, a);
    if (ruleId) q = q.eq('automation_rule_id', ruleId);
    return q;
  });

  const journaux = await toutLire<LigneJournal>((de, a) => {
    let q = client
      .from('automation_execution_logs')
      .select('automation_rule_id, entity_id, scheduled_task_id, result_success, result_error, created_at, saute:result_data->>saute')
      .eq('org_id', orgId)
      .gte('created_at', depuis)
      .order('id')
      .range(de, a);
    if (ruleId) q = q.eq('automation_rule_id', ruleId);
    return q;
  });

  const vide = (): StatsRegle => ({ declenches: 0, en_cours: 0, envoyes: 0, sautes: 0, echecs: 0, dernier_saut: null });
  const dateDernierSaut = new Map<string, string>();
  const par_regle: Record<string, StatsRegle> = {};
  const fiches = new Map<string, Set<string>>();
  const enCours = new Map<string, Set<string>>();
  const ajouter = (m: Map<string, Set<string>>, regle: string, entite: string) => {
    if (!m.has(regle)) m.set(regle, new Set());
    m.get(regle)!.add(entite); // `!` : posé juste au-dessus.
  };

  for (const t of taches) {
    ajouter(fiches, t.automation_rule_id, t.entity_id);
    if (t.status === 'pending' || t.status === 'running') ajouter(enCours, t.automation_rule_id, t.entity_id);
  }
  for (const l of journaux) {
    if (!l.automation_rule_id) continue;
    ajouter(fiches, l.automation_rule_id, l.entity_id);
    const s = (par_regle[l.automation_rule_id] ??= vide());
    const c = classerJournal(l);
    if (c === 'envoye') s.envoyes += 1;
    else if (c === 'saute') {
      s.sautes += 1;
      const quand = l.created_at ?? '';
      if (quand >= (dateDernierSaut.get(l.automation_rule_id) ?? '')) {
        dateDernierSaut.set(l.automation_rule_id, quand);
        s.dernier_saut = l.saute;
      }
    } else if (c === 'echec') s.echecs += 1;
  }
  for (const [regle, ens] of fiches) (par_regle[regle] ??= vide()).declenches = ens.size;
  for (const [regle, ens] of enCours) (par_regle[regle] ??= vide()).en_cours = ens.size;

  if (!ruleId) return { par_regle, par_etape: null };

  // Par étape : un journal se rattache à son étape par sa tâche planifiée.
  const etapeDeTache = new Map(taches.filter((t) => t.step_id).map((t) => [t.id, t.step_id as string]));
  const par_etape: Record<string, StatsEtape> = {};
  const etape = (id: string) => (par_etape[id] ??= { envoyes: 0, sautes: 0, echecs: 0, en_attente: 0 });
  for (const t of taches) {
    if (t.step_id && (t.status === 'pending' || t.status === 'running')) etape(t.step_id).en_attente += 1;
  }
  for (const l of journaux) {
    const id = l.scheduled_task_id ? etapeDeTache.get(l.scheduled_task_id) : undefined;
    if (!id) continue;
    const c = classerJournal(l);
    if (c === 'envoye') etape(id).envoyes += 1;
    else if (c === 'saute') etape(id).sautes += 1;
    else if (c === 'echec') etape(id).echecs += 1;
  }
  return { par_regle, par_etape };
}

/**
 * Le bureau peut-il envoyer des textos ? Même source que le moteur : le
 * client Twilio du serveur ET le numéro actif du bureau (`getOrgSmsChannel`,
 * celui que `requireOrgSmsNumber` exige avant chaque envoi). Sans l'un des
 * deux, chaque étape texto est SAUTÉE (M1, code `sms_non_configure`) — la
 * page l'annonce par un bandeau. `null` = inconnu : aucun bandeau plutôt
 * qu'un faux.
 */
async function textoConfigure(orgId: string): Promise<boolean | null> {
  try {
    if (!twilioClient) return false;
    const canal = await getOrgSmsChannel(orgId);
    return Boolean(canal?.phone_number);
  } catch (e: unknown) {
    logger.error('[automation-stats] numéro texto illisible', { message: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

router.get('/automations/rules/stats', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const brut = typeof req.query.rule_id === 'string' ? req.query.rule_id : null;
  if (brut && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(brut)) {
    return res.status(400).json({ error: 'Automatisation invalide.' });
  }

  try {
    const [stats, texto_configure] = await Promise.all([
      calculerStatistiques(auth.client, auth.orgId, brut),
      textoConfigure(auth.orgId),
    ]);
    return res.json({ ...stats, texto_configure });
  } catch (e: unknown) {
    logger.error('[automation-stats] lecture échouée', { message: e instanceof Error ? e.message : String(e) });
    return res.status(500).json({ error: 'Impossible de lire les statistiques des automatisations.' });
  }
});

export default router;
