// Creator Space — journal d'accès et révélation de noms (Loi 25, imputabilité).
//
// Deux responsabilités, volontairement HORS de creator-space.ts pour préserver
// son invariant « lecture seule, aucune écriture » (verrouillé par
// tests/creator-space/route-guards.test.ts) :
//
//   1. creatorSpaceViewLogger — middleware monté sur /api/creator-space :
//      chaque consultation réussie est consignée dans security_events
//      (event_type creator_space_view : qui, quel onglet, quelle compagnie,
//      quand). Sans ce journal, impossible de prouver quels accès la
//      plateforme a faits aux données des tenants.
//
//   2. POST /creator-space/reveal-actor — les journaux du Creator Space
//      n'exposent plus de noms de personnes d'autres tenants (identifiants
//      seulement). Révéler un nom exige une raison, journalisée AVANT la
//      réponse (creator_space_reveal, écrit en direct : si la journalisation
//      échoue, la révélation est refusée).
//
// Seule table écrite ici : security_events. Rien d'autre, jamais.

import { Router } from 'express';
import type express from 'express';
import { requireCreatorSpace } from './creator-space';
import { getServiceClient } from '../lib/supabase';
import { logSecurityEvent } from '../lib/security';
import { sendSafeError } from '../lib/error-handler';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Onglet + compagnie consultée, dérivés du chemin relatif au point de
 *  montage (/api/creator-space). Retourne null pour les chemins à ne pas
 *  journaliser (sonde /check, chemins inconnus). */
export function parseCreatorSpacePath(path: string): { tab: string; orgId: string | null } | null {
  const company = path.match(/^\/companies\/([0-9a-f-]{36})(?:\/([a-z-]+))?$/i);
  if (company) {
    if (!UUID_RE.test(company[1])) return null;
    return { tab: company[2] ? `company:${company[2]}` : 'company', orgId: company[1] };
  }
  const flat = path.match(/^\/(overview|logs|engagement|companies)$/);
  if (flat) return { tab: flat[1], orgId: null };
  return null;
}

/** Journalise chaque lecture réussie du Creator Space. Fire-and-forget via le
 *  buffer de logSecurityEvent : ne bloque ni ne fait échouer la consultation.
 *  L'identité vient de res.locals.creatorSpaceUserId, posé par
 *  requireCreatorSpace UNIQUEMENT après vérification platformAdminIds. */
export function creatorSpaceViewLogger(): express.RequestHandler {
  return (req, res, next) => {
    res.on('finish', () => {
      const userId = res.locals.creatorSpaceUserId as string | undefined;
      if (!userId || req.method !== 'GET' || res.statusCode >= 400) return;
      const parsed = parseCreatorSpacePath(req.path);
      if (!parsed) return;
      const source = typeof req.query.source === 'string' ? req.query.source : undefined;
      const orgFilter = typeof req.query.org === 'string' && UUID_RE.test(req.query.org) ? req.query.org : undefined;
      logSecurityEvent({
        event_type: 'creator_space_view',
        severity: 'info',
        source: 'creator-space',
        user_id: userId,
        org_id: parsed.orgId ?? orgFilter,
        details: {
          tab: parsed.tab,
          ...(source ? { log_source: source } : {}),
          ...(parsed.orgId || orgFilter ? { consulted_org: parsed.orgId ?? orgFilter } : {}),
        },
      });
    });
    next();
  };
}

const router = Router();

// ── Révéler le nom derrière un identifiant (journalisé, raison requise) ────
router.post('/creator-space/reveal-actor', async (req, res) => {
  try {
    const auth = await requireCreatorSpace(req, res);
    if (!auth) return;
    const targetId = typeof req.body?.user_id === 'string' ? req.body.user_id : '';
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
    if (!UUID_RE.test(targetId)) return res.status(400).json({ error: 'Identifiant invalide.' });
    if (reason.length < 5) return res.status(400).json({ error: 'Une raison d’au moins 5 caractères est requise — elle est journalisée.' });

    const admin = getServiceClient();

    // Journalisation AVANT la réponse, en écriture directe (pas via le buffer) :
    // pas de trace = pas de révélation.
    const { error: logErr } = await admin.from('security_events').insert({
      event_type: 'creator_space_reveal',
      severity: 'medium',
      source: 'creator-space',
      user_id: auth.user.id,
      details: { target_user_id: targetId, reason },
    });
    if (logErr) {
      console.error('[creator-space/reveal] journalisation refusée:', logErr.message);
      return res.status(500).json({ error: 'Journalisation impossible — révélation refusée.' });
    }

    const [{ data: profile }, { data: members }] = await Promise.all([
      admin.from('profiles').select('full_name').eq('id', targetId).maybeSingle(),
      admin.from('memberships').select('full_name').eq('user_id', targetId).not('full_name', 'is', null).limit(1),
    ]);
    const name = profile?.full_name || members?.[0]?.full_name || null;
    return res.json({ user_id: targetId, name });
  } catch (err) {
    return sendSafeError(res, err, 'Impossible de révéler ce nom.', '[creator-space/reveal]');
  }
});

export default router;
