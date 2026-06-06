import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../lib/validation';
import { requireAuthedClient, getServiceClient, isOrgAdminOrOwner } from '../lib/supabase';

const router = Router();

// ─── Validation ──────────────────────────────────────────────────

const createOfficeSchema = z.object({
  name: z.string().trim().min(1, 'Office name is required.').max(120),
});

// ─── POST /orgs/create-office ────────────────────────────────────
// Crée un nouvel office (= org) dans la même compagnie (company_group_id)
// que l'org courant. Réservé au propriétaire. Le créateur devient owner
// du nouvel office.
router.post('/orgs/create-office', validate(createOfficeSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();

    // Seul le propriétaire de la compagnie peut créer un office.
    const { data: callerMembership } = await admin
      .from('memberships')
      .select('role')
      .eq('user_id', auth.user.id)
      .eq('org_id', auth.orgId)
      .maybeSingle();

    if (callerMembership?.role !== 'owner') {
      return res.status(403).json({ error: 'Only the company owner can create an office.' });
    }

    const { name } = req.body;

    // Hérite du company_group_id de l'org courant (le trigger DB le ferait
    // aussi, mais on le passe explicitement pour être robuste).
    const { data: currentOrg } = await admin
      .from('orgs')
      .select('company_group_id')
      .eq('id', auth.orgId)
      .maybeSingle();

    const insertPayload: Record<string, any> = {
      name,
      owner_id: auth.user.id,
    };
    if (currentOrg?.company_group_id) {
      insertPayload.company_group_id = currentOrg.company_group_id;
    }

    const { data: newOrg, error: orgError } = await admin
      .from('orgs')
      .insert(insertPayload)
      .select('id, name, company_group_id')
      .single();

    if (orgError || !newOrg) {
      console.error('[orgs/create-office] org insert error:', orgError?.message);
      return res.status(500).json({ error: 'Failed to create office.' });
    }

    // Le créateur devient owner du nouvel office.
    const { error: memError } = await admin
      .from('memberships')
      .insert({
        user_id: auth.user.id,
        org_id: newOrg.id,
        role: 'owner',
        status: 'active',
      });

    if (memError) {
      console.error('[orgs/create-office] membership insert error:', memError.message);
      return res.status(500).json({ error: 'Office created but failed to attach owner.' });
    }

    // Seed company_settings.company_name pour que le nom s'affiche partout
    // (switcher, emails d'invitation) — sinon « office sans nom ».
    await admin
      .from('company_settings')
      .insert({ org_id: newOrg.id, created_by: auth.user.id, company_name: name });

    return res.json({ office: newOrg });
  } catch (err: any) {
    console.error('[orgs/create-office]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
