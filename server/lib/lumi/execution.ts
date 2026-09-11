/**
 * Exécution d'une ÉCRITURE proposée par Lumi — un seul chemin, deux portes :
 * - POST /lumi/execute, quand l'utilisateur clique Confirmer ;
 * - l'orchestrateur, quand l'utilisateur a choisi « toujours confirmer » ce
 *   type d'action (lumi_autorisations) : l'écriture part sans aller-retour.
 *
 * Dans les deux cas, même garde (permission de la page Rôles), même reçu
 * (fiche créée gardée dans le tool_result pour survivre à la relecture),
 * même note au modèle, même distinction succès / erreur métier / refus.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { executerOutilGarde } from '../agent/garde';
import { ficheCreee, type Fiche } from './fiches';
import { logger } from '../logger';

export interface ReçuExecution {
  tool_use_id: string;
  ok: boolean;
  fiche: Fiche | null;
  /** Exécutée sans clic, parce que l'outil est dans lumi_autorisations. */
  auto?: boolean;
}

export async function executerEcriture(opts: {
  tool: string;
  toolUseId: string;
  /** Arguments DÉMASQUÉS (UUID réels). */
  args: Record<string, any>;
  userId: string;
  orgId: string;
  client: SupabaseClient;
  accessToken?: string;
  auto?: boolean;
}): Promise<{ contenu: string; recu: ReçuExecution }> {
  const recu: ReçuExecution = { tool_use_id: opts.toolUseId, ok: false, fiche: null, ...(opts.auto ? { auto: true } : {}) };
  try {
    const r = await executerOutilGarde({ name: opts.tool, args: opts.args, userId: opts.userId, orgId: opts.orgId, client: opts.client, accessToken: opts.accessToken });
    if ('refus' in r) return { contenu: JSON.stringify({ error: r.refus }), recu };
    const echec = r.result && typeof r.result === 'object' && typeof (r.result as any).error === 'string' ? String((r.result as any).error) : null;
    // Une erreur métier (devis pas accepté…) est un échec, pas un reçu : la
    // carte l'affiche comme tel et le modèle ne dit pas « c'est fait ».
    if (echec) return { contenu: JSON.stringify({ error: echec }), recu };
    // La fiche créée (« Devis Q-0043 ») voyage avec le résultat : c'est ce
    // qui permet au reçu de réapparaître quand on rouvre la conversation.
    const fiche = await ficheCreee(opts.tool, opts.args, r.result, { client: opts.client, orgId: opts.orgId, userId: opts.userId });
    recu.ok = true;
    recu.fiche = fiche;
    const contenu = JSON.stringify({
      executed: true,
      ...(opts.auto ? { auto: true } : {}),
      result: r.result ?? null,
      fiche,
      // Sans cette note, le modèle redisait « tu peux le confirmer ci-dessous » alors que c'était fait.
      note: 'DONE: this action has been executed and is complete. Tell the user in one short sentence that it is done (never ask for confirmation again), then offer the natural next step if any (e.g. send it to the client).',
    }).slice(0, 60_000);
    return { contenu, recu };
  } catch (err: any) {
    logger.error('[lumi/execute] écriture échouée', { tool: opts.tool, error: err?.message || String(err), orgId: opts.orgId });
    return { contenu: JSON.stringify({ error: 'Tool execution failed.' }), recu };
  }
}

/* ── Autorisations « toujours confirmer » ─────────────────────────── */

export async function autorisationsDe(admin: SupabaseClient, orgId: string, userId: string): Promise<Set<string>> {
  const { data, error } = await admin.from('lumi_autorisations').select('tool').eq('org_id', orgId).eq('user_id', userId);
  if (error) { logger.error('[lumi] autorisations illisibles', { error: error.message, orgId }); return new Set(); }
  return new Set((data ?? []).map((r: any) => String(r.tool)));
}

export async function definirAutorisation(admin: SupabaseClient, orgId: string, userId: string, tool: string, actif: boolean): Promise<void> {
  if (actif) {
    const { error } = await admin.from('lumi_autorisations').upsert({ org_id: orgId, user_id: userId, tool }, { onConflict: 'org_id,user_id,tool' });
    if (error) throw new Error(error.message);
  } else {
    const { error } = await admin.from('lumi_autorisations').delete().eq('org_id', orgId).eq('user_id', userId).eq('tool', tool);
    if (error) throw new Error(error.message);
  }
}
