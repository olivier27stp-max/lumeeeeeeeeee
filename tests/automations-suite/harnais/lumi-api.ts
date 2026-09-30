/**
 * Lumi par son VRAI chemin HTTP, dans le processus de test.
 *
 * Une petite application Express monte les mêmes pièces que server/index.ts
 * devant /api/lumi : express.json, rbacMiddleware, subscriptionGuard,
 * featureGuard, puis le routeur Lumi réel (orchestrateur, vrai modèle, garde
 * des outils, cartes de confirmation, /lumi/execute). Elle écoute sur
 * 127.0.0.1 (permis par le piège fetch du harnais). L'identité est un VRAI
 * JWT d'un compte de test (sessionDe) : RLS et permissions s'appliquent.
 *
 * Réglages fixés ICI (la CI n'a que les clés Supabase staging et
 * ANTHROPIC_API_KEY) :
 *  · pas de Redis (Upstash) : limiteurs et caches en mémoire ;
 *  · pas d'embeddings Gemini : le cache sémantique est éteint ;
 *  · pas de préchauffage ni de maintien du cache de prompt : aucun appel au
 *    modèle en dehors des demandes du test (coût borné) ;
 *  · routeur ACTIF, comme en production (LUMI_ROUTEUR=actif).
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { SupabaseClient } from '@supabase/supabase-js';

process.env.LUMI_TOURS_PAR_HEURE = '0';
process.env.UPSTASH_REDIS_REST_URL = '';
process.env.UPSTASH_REDIS_REST_TOKEN = '';
process.env.GEMINI_API_KEY = '';
process.env.LUMI_PRECHAUFFER = '0';
process.env.LUMI_CACHE_CHAUD_MINUTES = '0';
process.env.LUMI_ROUTEUR = 'actif';
process.env.LUMI_MODEL = '';
process.env.SUBSCRIPTION_GUARD = 'enforce';

export interface ReponseLumi {
  statut: number;
  texte: string;
  outils: string[];
  proposition: { tool_use_id: string; tool: string; args: Record<string, unknown> } | null;
  executes: Array<{ tool_use_id: string; ok: boolean; auto?: boolean }>;
  conversation_id: string | null;
  cout: number;
  erreur: unknown;
}

let serveur: Promise<{ url: string; server: Server }> | null = null;

export function demarrerApiLumi(): Promise<{ url: string; server: Server }> {
  serveur ??= (async () => {
    const express = (await import('express')).default;
    const { rbacMiddleware } = await import('../../../server/lib/route-permissions');
    const { subscriptionGuard, resoudreUtilisateur } = await import('../../../server/lib/subscription-guard');
    const { featureGuard } = await import('../../../server/lib/feature-guard');
    const lumiRouter = (await import('../../../server/routes/lumi')).default;
    const app = express();
    app.use(express.json({ limit: '512kb' }));
    app.use(rbacMiddleware());
    app.use(subscriptionGuard());
    app.use(featureGuard({ resoudreOrg: (req) => resoudreUtilisateur(req) }));
    app.use('/api', lumiRouter);
    return new Promise((resolve) => {
      const server = app.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        resolve({ url: `http://127.0.0.1:${port}`, server });
      });
    });
  })();
  return serveur;
}

export async function arreterApiLumi(): Promise<void> {
  if (!serveur) return;
  const { server } = await serveur;
  serveur = null;
  await new Promise<void>((r) => server.close(() => r()));
}

function lire(statut: number, brut: string, ok: boolean): ReponseLumi {
  const r: ReponseLumi = { statut, texte: '', outils: [], proposition: null, executes: [], conversation_id: null, cout: 0, erreur: null };
  if (!ok) {
    try { r.erreur = JSON.parse(brut); } catch { r.erreur = brut; }
    return r;
  }
  for (const ev of brut.split('\n\n')) {
    const type = /event: (\w+)/.exec(ev)?.[1];
    const donnees = /data: (.*)/.exec(ev)?.[1];
    if (!type || !donnees) continue;
    let j: Record<string, any>;
    try { j = JSON.parse(donnees); } catch { continue; }
    if (type === 'text') r.texte += String(j.delta ?? '');
    else if (type === 'tool' && j.statut === 'debut') r.outils.push(String(j.name));
    else if (type === 'proposal' && !j.auto) r.proposition = { tool_use_id: j.tool_use_id, tool: j.tool, args: j.args ?? {} };
    else if (type === 'executed') r.executes.push({ tool_use_id: j.tool_use_id, ok: !!j.ok, auto: !!j.auto });
    else if (type === 'error') r.erreur = j;
    else if (type === 'done') {
      r.conversation_id = j.conversation_id ?? null;
      r.cout += Number(j.cost_cents ?? 0);
      if (j.proposal && !r.proposition) r.proposition = j.proposal;
    }
  }
  return r;
}

export interface SessionLumi { jeton: string; orgId: string; langue?: 'fr' | 'en' }

async function poster(s: SessionLumi, chemin: string, corps: Record<string, unknown>): Promise<ReponseLumi> {
  const { url } = await demarrerApiLumi();
  const res = await fetch(`${url}${chemin}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.jeton}`, 'x-org-id': s.orgId },
    body: JSON.stringify(corps),
  });
  return lire(res.status, await res.text(), res.ok);
}

/** Un message à Lumi (nouvelle conversation si `conversationId` est nul). */
export function demanderALumi(s: SessionLumi, message: string, conversationId: string | null = null): Promise<ReponseLumi> {
  return poster(s, '/api/lumi/chat', { message, conversation_id: conversationId, language: s.langue ?? 'fr' });
}

/** Confirmer ou annuler la carte en attente (le bouton de l'interface). */
export function deciderCarte(s: SessionLumi, conversationId: string, toolUseId: string, decision: 'confirm' | 'cancel'): Promise<ReponseLumi> {
  return poster(s, '/api/lumi/execute', { conversation_id: conversationId, tool_use_id: toolUseId, decision, language: s.langue ?? 'fr' });
}

/** Ce que Lumi a coûté à l'entreprise depuis un instant (ai_usage, toutes sources), en cents. */
export async function depenseDepuis(admin: SupabaseClient, orgId: string, depuis: string): Promise<number> {
  const { data, error } = await admin.from('ai_usage').select('cost_cents').eq('org_id', orgId).gte('created_at', depuis);
  if (error) throw new Error(`ai_usage : ${error.message}`);
  return (data ?? []).reduce((s, l: { cost_cents: number | string | null }) => s + Number(l.cost_cents ?? 0), 0);
}
