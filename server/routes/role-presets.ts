import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../lib/validation';
import { requireAuthedClient, getServiceClient, isOrgAdminOrOwner } from '../lib/supabase';

const router = Router();

// Financial keys that must never be true for technicians (hard security boundary).
const FINANCIAL_KEYS = new Set<string>([
  'financial.view_pricing',
  'financial.view_invoices',
  'financial.view_payments',
  'financial.view_reports',
  'financial.view_analytics',
  'financial.view_margins',
  'financial.export_data',
  'invoices.create', 'invoices.read', 'invoices.update', 'invoices.delete', 'invoices.send',
  'payments.read', 'payments.create', 'payments.refund',
  'reports.read', 'analytics.view',
]);

const DEFAULT_SCOPE: Record<string, string> = {
  owner: 'company',
  admin: 'company',
  sales_rep: 'self',
  technician: 'assigned',
};

const updatePresetSchema = z.object({
  role: z.enum(['admin', 'sales_rep', 'technician']),
  permissions: z.record(z.string(), z.boolean()),
});

// ─── POST /api/roles/update-preset ──────────────────────────────
// Updates the role template AND propagates the new permissions map to every
// active member of that role in the current org. This is what makes checking
// or unchecking a permission in the Roles page take effect in real time.
router.post('/roles/update-preset', validate(updatePresetSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(admin, auth.user.id, auth.orgId);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Only admins or owners can update role presets.' });
    }

    const { role, permissions } = req.body as { role: 'admin' | 'sales_rep' | 'technician'; permissions: Record<string, boolean> };

    // Sanitize: technician cannot gain financial permissions, ever.
    const sanitized: Record<string, boolean> = { ...permissions };
    if (role === 'technician') {
      for (const key of Object.keys(sanitized)) {
        if (FINANCIAL_KEYS.has(key) && sanitized[key] === true) {
          sanitized[key] = false;
        }
      }
    }

    // 1) Upsert role_templates row for this org+role
    const { error: tmplErr } = await admin
      .from('role_templates')
      .upsert({
        org_id: auth.orgId,
        slug: role,
        name: role,
        is_system: true,
        default_scope: DEFAULT_SCOPE[role] ?? 'self',
        permissions: sanitized,
        is_active: true,
      }, { onConflict: 'org_id,slug' });

    if (tmplErr) {
      console.error('[roles/update-preset] template upsert failed', tmplErr);
      return res.status(500).json({ error: 'Failed to save role preset.' });
    }

    // 2) Propagate to every active membership with this role in the org.
    // We overwrite `permissions` so the preset is the source of truth.
    const { data: members, error: membersErr } = await admin
      .from('memberships')
      .update({ permissions: sanitized })
      .eq('org_id', auth.orgId)
      .eq('role', role)
      .in('status', ['active', 'pending'])
      .select('user_id');

    if (membersErr) {
      console.error('[roles/update-preset] membership propagation failed', membersErr);
      return res.status(500).json({ error: 'Preset saved, but failed to propagate to members.' });
    }

    return res.json({
      message: 'Role preset updated.',
      affected_members: members?.length ?? 0,
    });
  } catch (err: any) {
    console.error('[roles/update-preset]', err?.message || err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── GET /api/roles/presets ────────────────────────────────────
// Returns the current overrides from role_templates for this org.
router.get('/roles/presets', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const { data, error } = await admin
      .from('role_templates')
      .select('slug, permissions, default_scope')
      .eq('org_id', auth.orgId);

    if (error) {
      return res.status(500).json({ error: 'Failed to load presets.' });
    }

    return res.json({ presets: data ?? [] });
  } catch (err: any) {
    console.error('[roles/presets]', err?.message || err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
