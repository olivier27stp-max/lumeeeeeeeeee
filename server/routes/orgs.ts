import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../lib/validation';
import { requireAuthedClient, getServiceClient, companyOrgIds } from '../lib/supabase';

const router = Router();

// ─── Validation ──────────────────────────────────────────────────

const createOfficeSchema = z.object({
  name: z.string().trim().min(1, 'Office name is required.').max(120),
});

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Capacité de bureaux de la compagnie : included_offices du plan actif +
 * extra_offices achetés. La sub est cherchée sur N'IMPORTE QUEL bureau de
 * la compagnie (les bureaux secondaires n'ont pas de ligne subscriptions).
 * Sans abonnement actif : 1 bureau, comme le gate de sièges.
 */
export async function getOfficeCapacity(admin: ReturnType<typeof getServiceClient>, officeIds: string[]): Promise<number> {
  if (officeIds.length === 0) return 1;
  const { data: sub } = await admin
    .from('subscriptions')
    .select('plan_id, extra_offices')
    .in('org_id', officeIds)
    .in('status', ['active', 'trialing'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: plan } = sub?.plan_id
    ? await admin.from('plans').select('included_offices').eq('id', sub.plan_id).maybeSingle()
    : { data: null };
  return (plan?.included_offices ?? 1) + (sub?.extra_offices ?? 0);
}

// ─── POST /orgs/create-office ────────────────────────────────────
// Crée un nouvel office (= org) dans la même compagnie que l'org courant.
// Réservé au propriétaire. Le créateur devient owner du nouvel office.
// Bloqué quand la compagnie a déjà atteint included_offices + extra_offices.
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

    // ── Limite de bureaux (miroir du gate de sièges d'invitations.ts) ──
    // Compagnie = les orgs du company_group du bureau actif.
    const officeIds = await companyOrgIds(admin, auth.orgId);
    const used = Math.max(1, officeIds.length);
    const capacity = await getOfficeCapacity(admin, officeIds);

    if (used >= capacity) {
      return res.status(403).json({
        error: `Office limit reached (${capacity} included in your plan). Add extra offices from Billing settings to create more.`,
        code: 'office_limit_reached',
        capacity,
        used,
      });
    }

    // Hérite explicitement du groupe du bureau actif (le trigger DB le ferait
    // par created_by, mais passer le groupe couvre le cas d'un org dont le
    // créateur n'est pas l'owner actuel). NOTE : orgs n'a pas de owner_id —
    // le propriétaire effectif est created_by + memberships.role='owner'.
    const { data: currentOrg } = await admin
      .from('orgs')
      .select('company_group_id')
      .eq('id', auth.orgId)
      .maybeSingle();

    const insertPayload: Record<string, any> = { name, created_by: auth.user.id };
    if (currentOrg?.company_group_id) insertPayload.company_group_id = currentOrg.company_group_id;

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
