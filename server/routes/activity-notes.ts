import { Router } from 'express';
import { eventBus } from '../lib/eventBus';
import { z } from 'zod';
import { requireAuthedClient, getServiceClient, isOrgMember, isOrgAdminOrOwner } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';

const router = Router();

const entityTypeSchema = z.enum(['client', 'job']);

const createNoteSchema = z.object({
  entityType: entityTypeSchema,
  entityId: z.string().uuid('Invalid entityId.'),
  body: z.string().trim().min(1, 'Note cannot be empty.').max(5000),
});

// ── List notes for an entity ──
router.get('/activity-notes', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const parsed = entityTypeSchema.safeParse(String(req.query.entityType || ''));
    const entityId = String(req.query.entityId || '').trim();
    if (!parsed.success || !entityId) {
      return res.status(400).json({ error: 'entityType (client|job) and entityId are required.' });
    }

    const admin = getServiceClient();
    const { data, error } = await admin
      .from('activity_notes')
      .select('id, entity_type, entity_id, body, actor_id, created_at, updated_at')
      .eq('org_id', auth.orgId)
      .eq('entity_type', parsed.data)
      .eq('entity_id', entityId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.json({ notes: data || [] });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to fetch notes.', '[activity-notes/list]');
  }
});

// ── Create a note ──
router.post('/activity-notes', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const parsed = createNoteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body.', issues: parsed.error.issues.map((i) => i.message) });
    }
    const { entityType, entityId, body } = parsed.data;

    const member = await isOrgMember(auth.client, auth.user.id, auth.orgId);
    if (!member) return res.status(403).json({ error: 'You are not a member of this organization.' });

    const admin = getServiceClient();
    const { data, error } = await admin
      .from('activity_notes')
      .insert({
        org_id: auth.orgId,
        entity_type: entityType,
        entity_id: entityId,
        body,
        actor_id: auth.user.id,
      })
      .select('id, entity_type, entity_id, body, actor_id, created_at, updated_at')
      .single();

    if (error) throw error;

    /*
     * « Note ajoutée » — le déclencheur d'automatisation.
     *
     * PAS DE BOUCLE POSSIBLE. Cette route est le chemin HUMAIN : elle exige
     * une session (`requireAuthedClient`) et un membre de l'organisation.
     * L'action « ajouter une note » du moteur, elle, écrit directement dans
     * `notes` avec le client service_role — elle ne passe jamais ici. Une
     * règle « note ajoutée → ajouter une note » ne peut donc pas s'auto-
     * déclencher, ce qui est le piège n°1 de ce déclencheur chez GHL.
     *
     * L'entité émise est le CLIENT quand la note porte sur un client ; sur
     * un job, on remonte à son client, parce que c'est lui que les messages
     * décrivent. Un job sans client n'émet rien.
     */
    void (async () => {
      try {
        let clientId: string | null = entityType === 'client' ? entityId : null;
        if (entityType === 'job') {
          const { data: job } = await admin
            .from('jobs').select('client_id').eq('id', entityId).eq('org_id', auth.orgId).maybeSingle();
          clientId = job?.client_id ?? null;
        }
        if (!clientId) return; // rien à qui écrire

        await eventBus.emit('note.added', {
          orgId: auth.orgId,
          entityType: 'client',
          entityId: clientId,
          actorId: auth.user.id,
          metadata: {
            note_sur: entityType,
            // Le texte sert aux conditions ; borné pour ne pas recopier une
            // note de 4 000 caractères dans `activity_log` à chaque écriture.
            texte: String(body).slice(0, 500),
          },
        });
      } catch (e: any) {
        // Un échec d'émission ne doit jamais faire échouer l'ajout de note :
        // la note est déjà enregistrée et affichée.
        console.error('[activity-notes] note.added non émis:', e?.message || e);
      }
    })();

    return res.json({ note: data });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to add note.', '[activity-notes/create]');
  }
});

// ── Soft-delete a note (author or org admin/owner) ──
router.delete('/activity-notes/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Missing note id.' });

    const admin = getServiceClient();
    const { data: note, error: fetchErr } = await admin
      .from('activity_notes')
      .select('id, org_id, actor_id')
      .eq('id', id)
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!note) return res.status(404).json({ error: 'Note not found.' });

    const isAuthor = note.actor_id === auth.user.id;
    const canManage = isAuthor || (await isOrgAdminOrOwner(auth.client, auth.user.id, auth.orgId));
    if (!canManage) return res.status(403).json({ error: 'Only the author or an admin can delete this note.' });

    const { error } = await admin
      .from('activity_notes')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;
    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to delete note.', '[activity-notes/delete]');
  }
});

export default router;
