/* ═══════════════════════════════════════════════════════════════
   Routes — Email Templates
   CRUD for email_templates (org-scoped, auth required).
   ═══════════════════════════════════════════════════════════════ */

/**
 * Modèles de courriel d'une entreprise — CRUD.
 *
 * HISTORIQUE (à ne pas réintroduire) : de 2026-03 à 2026-09, ce CRUD était
 * complet mais INERTE. `is_default` n'était jamais lu à l'envoi ; un modèle ne
 * servait que si le front passait un `emailTemplateId` explicite, ce qu'aucune
 * page ne faisait. Les modèles semés en prod n'ont donc jamais rien changé aux
 * courriels reçus par les clients.
 *
 * Depuis 2026-09-18, `server/lib/courriels/modeles.ts` (`texteDuCourriel`)
 * résout le modèle AUTOMATIQUEMENT par (org_id, type, is_active), et les envois
 * de facture, de soumission et les rappels l'utilisent. Deux règles que ce
 * fichier doit préserver :
 *
 *   - UN SEUL modèle actif par (org_id, type) : l'index unique partiel
 *     `uniq_email_templates_actif_par_type` l'impose en base. Toute route qui
 *     active un modèle doit d'abord désactiver l'autre, sinon elle échoue en
 *     23505 (et supabase-js ne lève pas : la faute passerait inaperçue).
 *   - `type` doit rester aligné sur `TYPES_MODELE_COURRIEL`
 *     (server/lib/validation.ts) ET sur le CHECK de la base.
 */

import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { validate, emailTemplateSchema } from '../lib/validation';
import { sendSafeError } from '../lib/error-handler';

const router = Router();

// GET /api/email-templates — list all for org, optional ?type= filter
router.get('/email-templates', async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId } = authed;
    const serviceClient = getServiceClient();

    let query = serviceClient
      .from('email_templates')
      .select('*')
      .eq('org_id', orgId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });

    const typeFilter = req.query.type as string | undefined;
    if (typeFilter) {
      query = query.eq('type', typeFilter);
    }

    const { data, error } = await query;

    if (error) throw error;
    return res.json(data || []);
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to load email templates.', '[email-templates/list]');
  }
});

// GET /api/email-templates/:id — get single template
router.get('/email-templates/:id', async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId } = authed;
    const { id } = req.params;
    const serviceClient = getServiceClient();

    const { data, error } = await serviceClient
      .from('email_templates')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Email template not found' });

    return res.json(data);
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to load email template.', '[email-templates/get]');
  }
});

// POST /api/email-templates — create template
router.post('/email-templates', validate(emailTemplateSchema), async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId, user } = authed;
    const serviceClient = getServiceClient();

    const { name, type, subject, body, variables, is_active, is_default, source } = req.body;

    /* Un seul modèle ACTIF par (org_id, type) — c'est l'index unique partiel
       `uniq_email_templates_actif_par_type` qui l'impose en base, et c'est ce
       qui rend `texteDuCourriel` déterministe. Le nouveau modèle actif chasse
       donc le précédent, qui passe en brouillon (rien n'est supprimé : le
       texte écrit par l'entreprise lui appartient). */
    if (is_active ?? true) {
      await serviceClient
        .from('email_templates')
        .update({ is_active: false, is_default: false })
        .eq('org_id', orgId)
        .eq('type', type)
        .eq('is_active', true);
    } else if (is_default) {
      await serviceClient
        .from('email_templates')
        .update({ is_default: false })
        .eq('org_id', orgId)
        .eq('type', type);
    }

    const { data, error } = await serviceClient
      .from('email_templates')
      .insert({
        org_id: orgId,
        created_by: user.id,
        name,
        type,
        subject,
        body,
        // colonne NOT NULL DEFAULT '[]' — jamais null
        variables: variables ?? [],
        is_active: is_active ?? true,
        is_default: is_default || false,
        source: source || 'editeur',
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json(data);
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to create email template.', '[email-templates/create]');
  }
});

// PUT /api/email-templates/:id — update template
router.put('/email-templates/:id', validate(emailTemplateSchema), async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId } = authed;
    const { id } = req.params;
    const serviceClient = getServiceClient();

    const { name, type, subject, body, variables, is_active, is_default, source } = req.body;

    /* Même règle qu'à la création : un seul modèle actif par (org_id, type).
       On écarte les AUTRES lignes actives de ce type (`.neq('id', id)`) avant
       d'écrire celle-ci, sinon l'index unique partiel rejette la mise à jour. */
    if (is_active ?? true) {
      await serviceClient
        .from('email_templates')
        .update({ is_active: false, is_default: false })
        .eq('org_id', orgId)
        .eq('type', type)
        .eq('is_active', true)
        .neq('id', id);
    } else if (is_default) {
      await serviceClient
        .from('email_templates')
        .update({ is_default: false })
        .eq('org_id', orgId)
        .eq('type', type)
        .neq('id', id);
    }

    const { data, error } = await serviceClient
      .from('email_templates')
      .update({
        name,
        type,
        subject,
        body,
        // colonne NOT NULL DEFAULT '[]' — jamais null
        variables: variables ?? [],
        is_active: is_active ?? undefined,
        is_default: is_default ?? undefined,
        source: source ?? undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('org_id', orgId)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Email template not found' });

    return res.json(data);
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to update email template.', '[email-templates/update]');
  }
});

// POST /api/email-templates/:id/duplicate — duplicate template
router.post('/email-templates/:id/duplicate', async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId, user } = authed;
    const { id } = req.params;
    const serviceClient = getServiceClient();

    // Fetch original
    const { data: original, error: fetchError } = await serviceClient
      .from('email_templates')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (fetchError || !original) {
      return res.status(404).json({ error: 'Email template not found' });
    }

    // Create duplicate
    const { data, error } = await serviceClient
      .from('email_templates')
      .insert({
        org_id: orgId,
        created_by: user.id,
        name: `${original.name} (Copy)`,
        type: original.type,
        subject: original.subject,
        body: original.body,
        variables: original.variables,
        // Une copie naît TOUJOURS inactive : sinon elle entrerait en collision
        // avec l'original sur l'index unique (org_id, type) where is_active.
        // On duplique pour retoucher, pas pour publier d'un clic.
        is_active: false,
        is_default: false,
        source: original.source || 'editeur',
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json(data);
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to duplicate email template.', '[email-templates/duplicate]');
  }
});

// POST /api/email-templates/:id/set-default — set as default for its type (unset others of same type)
router.post('/email-templates/:id/set-default', async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId } = authed;
    const { id } = req.params;
    const serviceClient = getServiceClient();

    // Fetch template to get its type
    const { data: template, error: fetchError } = await serviceClient
      .from('email_templates')
      .select('id, type')
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (fetchError || !template) {
      return res.status(404).json({ error: 'Email template not found' });
    }

    /* « Rendre par défaut » = « c'est CE texte qu'on envoie ». On désactive donc
       les autres du même type en même temps qu'on leur retire le drapeau : la
       résolution serveur cherche par `is_active`, et l'index unique partiel
       n'admet qu'un seul actif par (org_id, type). */
    await serviceClient
      .from('email_templates')
      .update({ is_default: false, is_active: false })
      .eq('org_id', orgId)
      .eq('type', template.type)
      .neq('id', id);

    // Set this template as default
    const { data, error } = await serviceClient
      .from('email_templates')
      .update({ is_default: true, is_active: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('org_id', orgId)
      .select()
      .single();

    if (error) throw error;

    return res.json(data);
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to set default email template.', '[email-templates/set-default]');
  }
});

// DELETE /api/email-templates/:id — hard delete
router.delete('/email-templates/:id', async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId } = authed;
    const { id } = req.params;
    const serviceClient = getServiceClient();

    const { error } = await serviceClient
      .from('email_templates')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId);

    if (error) throw error;

    return res.json({ ok: true });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to delete email template.', '[email-templates/delete]');
  }
});

export default router;
