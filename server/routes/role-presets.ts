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

    // 2) Propagate to every active membership with this role in the org —
    // EXCEPT members whose permissions were customized per-user: the preset
    // must not overwrite them. Falls back to the legacy overwrite-all
    // behaviour while the permissions_custom migration isn't applied.
    let propagate = await admin
      .from('memberships')
      .update({ permissions: sanitized })
      .eq('org_id', auth.orgId)
      .eq('role', role)
      .in('status', ['active', 'pending'])
      .eq('permissions_custom', false)
      .select('user_id');
    if (propagate.error) {
      propagate = await admin
        .from('memberships')
        .update({ permissions: sanitized })
        .eq('org_id', auth.orgId)
        .eq('role', role)
        .in('status', ['active', 'pending'])
        .select('user_id');
    }

    if (propagate.error) {
      console.error('[roles/update-preset] membership propagation failed', propagate.error);
      return res.status(500).json({ error: 'Preset saved, but failed to propagate to members.' });
    }

    return res.json({
      message: 'Role preset updated.',
      affected_members: propagate.data?.length ?? 0,
    });
  } catch (err: any) {
    console.error('[roles/update-preset]', err?.message || err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── Per-user permission overrides ──────────────────────────────
// Effective permissions live on memberships.permissions (what the RBAC
// resolver reads). These routes edit ONE member's map and flag it custom so
// role-preset saves stop overwriting it.

const memberPermissionsSchema = z.object({
  user_id: z.string().uuid(),
  permissions: z.record(z.string(), z.boolean()),
});

async function loadTargetMembership(admin: any, orgId: string, userId: string) {
  let r = await admin
    .from('memberships')
    .select('role, permissions, permissions_custom')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (r.error) {
    // permissions_custom ships behind a migration
    r = await admin
      .from('memberships')
      .select('role, permissions')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .maybeSingle();
    if (r.data) (r.data as any).permissions_custom = false;
  }
  return r;
}

// GET /api/roles/member-permissions?user_id=...
router.get('/roles/member-permissions', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(admin, auth.user.id, auth.orgId);
    if (!isAdmin) return res.status(403).json({ error: 'Only admins or owners can view member permissions.' });

    const userId = String(req.query.user_id || '').trim();
    if (!userId) return res.status(400).json({ error: 'user_id is required.' });

    const { data, error } = await loadTargetMembership(admin, auth.orgId, userId);
    if (error) return res.status(500).json({ error: 'Failed to load member permissions.' });
    if (!data) return res.status(404).json({ error: 'Member not found.' });

    return res.json({
      role: data.role,
      permissions: data.permissions || {},
      custom: Boolean((data as any).permissions_custom),
    });
  } catch (err: any) {
    console.error('[roles/member-permissions]', err?.message || err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /api/roles/member-permissions — save a per-user override.
router.post('/roles/member-permissions', validate(memberPermissionsSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(admin, auth.user.id, auth.orgId);
    if (!isAdmin) return res.status(403).json({ error: 'Only admins or owners can edit member permissions.' });

    const { user_id, permissions } = req.body as { user_id: string; permissions: Record<string, boolean> };

    const { data: target } = await loadTargetMembership(admin, auth.orgId, user_id);
    if (!target) return res.status(404).json({ error: 'Member not found.' });
    if (target.role === 'owner') return res.status(403).json({ error: 'The owner always has full access.' });

    // Same hard boundary as role presets: technicians never gain financial keys.
    const sanitized: Record<string, boolean> = { ...permissions };
    if (target.role === 'technician') {
      for (const key of Object.keys(sanitized)) {
        if (FINANCIAL_KEYS.has(key) && sanitized[key] === true) sanitized[key] = false;
      }
    }

    let upd = await admin
      .from('memberships')
      .update({ permissions: sanitized, permissions_custom: true })
      .eq('org_id', auth.orgId)
      .eq('user_id', user_id)
      .select('user_id');
    if (upd.error) {
      upd = await admin
        .from('memberships')
        .update({ permissions: sanitized })
        .eq('org_id', auth.orgId)
        .eq('user_id', user_id)
        .select('user_id');
    }
    if (upd.error) {
      console.error('[roles/member-permissions] save failed', upd.error);
      return res.status(500).json({ error: 'Failed to save member permissions.' });
    }

    return res.json({ message: 'Member permissions updated.', permissions: sanitized });
  } catch (err: any) {
    console.error('[roles/member-permissions]', err?.message || err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /api/roles/member-permissions/reset — back to the role preset.
router.post('/roles/member-permissions/reset', validate(z.object({ user_id: z.string().uuid() })), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(admin, auth.user.id, auth.orgId);
    if (!isAdmin) return res.status(403).json({ error: 'Only admins or owners can edit member permissions.' });

    const { user_id } = req.body as { user_id: string };
    const { data: target } = await loadTargetMembership(admin, auth.orgId, user_id);
    if (!target) return res.status(404).json({ error: 'Member not found.' });
    if (target.role === 'owner') return res.status(403).json({ error: 'The owner always has full access.' });

    const { data: tmpl } = await admin
      .from('role_templates')
      .select('permissions')
      .eq('org_id', auth.orgId)
      .eq('slug', target.role)
      .maybeSingle();

    const payload: Record<string, any> = { permissions_custom: false };
    // Reapply the role preset when the org has one; otherwise just unflag —
    // the next role-preset save will resync this member.
    if (tmpl?.permissions) payload.permissions = tmpl.permissions;

    let upd = await admin
      .from('memberships')
      .update(payload)
      .eq('org_id', auth.orgId)
      .eq('user_id', user_id)
      .select('user_id');
    if (upd.error && tmpl?.permissions) {
      upd = await admin
        .from('memberships')
        .update({ permissions: tmpl.permissions })
        .eq('org_id', auth.orgId)
        .eq('user_id', user_id)
        .select('user_id');
    }
    if (upd.error) {
      console.error('[roles/member-permissions/reset] failed', upd.error);
      return res.status(500).json({ error: 'Failed to reset member permissions.' });
    }

    return res.json({
      message: 'Member permissions reset to role preset.',
      permissions: tmpl?.permissions || target.permissions || {},
      template_found: Boolean(tmpl?.permissions),
    });
  } catch (err: any) {
    console.error('[roles/member-permissions/reset]', err?.message || err);
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
