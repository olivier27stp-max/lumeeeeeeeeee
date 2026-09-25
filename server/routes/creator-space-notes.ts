// Creator Space — notes internes par workspace.
//
// Volontairement HORS de creator-space.ts pour préserver son invariant
// « lecture seule » (verrouillé par tests/creator-space/route-guards.test.ts),
// même discipline que creator-space-features.ts et creator-space-audit.ts.
//
// Table dédiée `creator_space_notes` (RLS activée, aucune policy — seul le
// service_role y accède) : une note interne à la plateforme sur un client ne
// doit JAMAIS être visible par ce client, contrairement à la table tenant
// `notes`. Pas de « raison journalisée avant écriture » ici (contrairement
// aux overrides de features/quota, qui changent ce qu'un compte peut faire) :
// une note est une communication d'équipe, pas un changement d'état pour le
// tenant — elle est journalisée en direct (fire-and-forget) pour la trace,
// sans bloquer l'écriture si la journalisation échoue.
//
// L'auteur d'une note est un des ~2 comptes platformAdminIds : afficher son
// nom n'est PAS un enjeu Loi 25 (ce n'est pas l'acteur d'un tenant).

import { Router } from 'express';
import { requireCreatorSpace, loadActorNames } from './creator-space';
import { getServiceClient, companyOrgIds } from '../lib/supabase';
import { logSecurityEvent } from '../lib/security';
import { sendSafeError } from '../lib/error-handler';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_LEN = 4000;

const router = Router();

// ── Lire les notes du workspace (tous les bureaux du groupe) ─────────────
router.get('/creator-space/companies/:orgId/notes', async (req, res) => {
  try {
    const auth = await requireCreatorSpace(req, res);
    if (!auth) return;
    const { orgId } = req.params;
    if (!UUID_RE.test(orgId)) return res.status(400).json({ error: 'Identifiant invalide.' });
    const admin = getServiceClient();

    const officeIds = await companyOrgIds(admin, orgId);
    const { data: rows, error } = await admin
      .from('creator_space_notes')
      .select('id, org_id, author_id, body, created_at')
      .in('org_id', officeIds)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;

    const names = await loadActorNames(admin, (rows ?? []).map((r: any) => r.author_id));
    return res.json({
      data: (rows ?? []).map((r: any) => ({
        id: r.id,
        org_id: r.org_id,
        author_id: r.author_id,
        author_name: names.get(r.author_id) ?? null,
        body: r.body,
        created_at: r.created_at,
        can_delete: r.author_id === auth.user.id,
      })),
    });
  } catch (err) {
    return sendSafeError(res, err, 'Impossible de charger les notes.', '[creator-space/notes]');
  }
});

// ── Ajouter une note ───────────────────────────────────────────────────────
router.post('/creator-space/companies/:orgId/notes', async (req, res) => {
  try {
    const auth = await requireCreatorSpace(req, res);
    if (!auth) return;
    const { orgId } = req.params;
    if (!UUID_RE.test(orgId)) return res.status(400).json({ error: 'Identifiant invalide.' });
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body) return res.status(400).json({ error: 'Le texte de la note est requis.' });
    if (body.length > MAX_BODY_LEN) return res.status(400).json({ error: `La note dépasse ${MAX_BODY_LEN} caractères.` });

    const admin = getServiceClient();
    const { data: row, error } = await admin
      .from('creator_space_notes')
      .insert({ org_id: orgId, author_id: auth.user.id, body })
      .select('id, org_id, author_id, body, created_at')
      .single();
    if (error) throw error;

    logSecurityEvent({
      event_type: 'creator_space_note_added',
      severity: 'info',
      source: 'creator-space',
      user_id: auth.user.id,
      org_id: orgId,
      details: { note_id: row.id },
    });

    return res.status(201).json({
      id: row.id,
      org_id: row.org_id,
      author_id: row.author_id,
      author_name: null,
      body: row.body,
      created_at: row.created_at,
      can_delete: true,
    });
  } catch (err) {
    return sendSafeError(res, err, 'Impossible d’ajouter la note.', '[creator-space/notes]');
  }
});

// ── Retirer sa propre note ─────────────────────────────────────────────────
router.delete('/creator-space/companies/:orgId/notes/:noteId', async (req, res) => {
  try {
    const auth = await requireCreatorSpace(req, res);
    if (!auth) return;
    const { orgId, noteId } = req.params;
    if (!UUID_RE.test(orgId) || !UUID_RE.test(noteId)) return res.status(400).json({ error: 'Identifiant invalide.' });

    const admin = getServiceClient();
    // On ne retire jamais la note d'un autre admin plateforme, même en étant
    // admin soi-même : chacun reste responsable de ses propres notes.
    const { data: deleted, error } = await admin
      .from('creator_space_notes')
      .delete()
      .eq('id', noteId)
      .eq('org_id', orgId)
      .eq('author_id', auth.user.id)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!deleted) return res.status(404).json({ error: 'Note introuvable, ou ce n’est pas la vôtre.' });

    logSecurityEvent({
      event_type: 'creator_space_note_deleted',
      severity: 'info',
      source: 'creator-space',
      user_id: auth.user.id,
      org_id: orgId,
      details: { note_id: noteId },
    });

    return res.json({ ok: true });
  } catch (err) {
    return sendSafeError(res, err, 'Impossible de retirer la note.', '[creator-space/notes]');
  }
});

export default router;
