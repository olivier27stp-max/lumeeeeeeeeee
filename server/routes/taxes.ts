import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';

const router = Router();

// ── Canadian tax presets ──
const PRESETS: Record<string, { name: string; region: string; country: string; taxes: Array<{ name: string; rate: number; is_compound: boolean; sort_order: number }> }> = {
  // ── Canada ──
  QC: { name: 'Quebec (TPS + TVQ)', region: 'QC', country: 'CA', taxes: [
    { name: 'TPS', rate: 5, is_compound: false, sort_order: 0 },
    { name: 'TVQ', rate: 9.975, is_compound: false, sort_order: 1 },
  ]},
  ON: { name: 'Ontario (HST)', region: 'ON', country: 'CA', taxes: [
    { name: 'HST', rate: 13, is_compound: false, sort_order: 0 },
  ]},
  BC: { name: 'British Columbia (GST + PST)', region: 'BC', country: 'CA', taxes: [
    { name: 'GST', rate: 5, is_compound: false, sort_order: 0 },
    { name: 'PST', rate: 7, is_compound: false, sort_order: 1 },
  ]},

  // ── USA ──
  'US-CA': { name: 'California', region: 'US-CA', country: 'US', taxes: [
    { name: 'Sales Tax', rate: 7.25, is_compound: false, sort_order: 0 },
  ]},
  'US-TX': { name: 'Texas', region: 'US-TX', country: 'US', taxes: [
    { name: 'Sales Tax', rate: 6.25, is_compound: false, sort_order: 0 },
  ]},
  'US-FL': { name: 'Florida', region: 'US-FL', country: 'US', taxes: [
    { name: 'Sales Tax', rate: 6, is_compound: false, sort_order: 0 },
  ]},

  // ── International ──
  'UK': { name: 'United Kingdom (VAT)', region: 'UK', country: 'GB', taxes: [
    { name: 'VAT', rate: 20, is_compound: false, sort_order: 0 },
  ]},
  'FR': { name: 'France (TVA)', region: 'FR', country: 'FR', taxes: [
    { name: 'TVA', rate: 20, is_compound: false, sort_order: 0 },
  ]},
  'DE': { name: 'Germany (MwSt)', region: 'DE', country: 'DE', taxes: [
    { name: 'MwSt', rate: 19, is_compound: false, sort_order: 0 },
  ]},
  'AU': { name: 'Australia (GST)', region: 'AU', country: 'AU', taxes: [
    { name: 'GST', rate: 10, is_compound: false, sort_order: 0 },
  ]},
  'MX': { name: 'Mexico (IVA)', region: 'MX', country: 'MX', taxes: [
    { name: 'IVA', rate: 16, is_compound: false, sort_order: 0 },
  ]},

  // ── No Tax ──
  NONE: { name: 'No Tax', region: 'NONE', country: '', taxes: [] },
};

// ── GET /taxes — list all tax configs for org ──
router.get('/taxes', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const [configsRes, groupsRes, itemsRes] = await Promise.all([
      admin.from('tax_configs').select('*').eq('org_id', auth.orgId).order('sort_order'),
      admin.from('tax_groups').select('*').eq('org_id', auth.orgId).order('created_at'),
      admin.from('tax_group_items').select('*, tax_configs(*)').order('sort_order'),
    ]);

    // Filter items to only include those belonging to this org's groups
    const groupIds = new Set((groupsRes.data || []).map((g: any) => g.id));
    const filteredItems = (itemsRes.data || []).filter((i: any) => groupIds.has(i.tax_group_id));

    return res.json({
      configs: configsRes.data || [],
      groups: groupsRes.data || [],
      group_items: filteredItems,
      presets: Object.entries(PRESETS).map(([key, val]) => ({ key, ...val })),
    });
  } catch (err: any) {
    console.error('[taxes] list failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /taxes/resolve?client_id=X — resolve which taxes apply ──
router.get('/taxes/resolve', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient(); // bypass RLS for cross-table joins

    const clientId = req.query.client_id as string;
    const leadId = req.query.lead_id as string;
    let region = '';

    const PROVINCE_MAP: Record<string, string> = {
      'QUEBEC': 'QC', 'QUÉBEC': 'QC', 'ONTARIO': 'ON', 'BRITISH COLUMBIA': 'BC',
      'ALBERTA': 'AB', 'SASKATCHEWAN': 'SK', 'MANITOBA': 'MB',
      'NEW BRUNSWICK': 'NB', 'NOVA SCOTIA': 'NS', 'PEI': 'PE',
      'PRINCE EDWARD ISLAND': 'PE', 'NEWFOUNDLAND': 'NL',
      'NEWFOUNDLAND AND LABRADOR': 'NL',
      // US state names
      'CALIFORNIA': 'US-CA', 'TEXAS': 'US-TX', 'FLORIDA': 'US-FL',
      'NEW YORK': 'US-NY', 'ILLINOIS': 'US-IL', 'WASHINGTON': 'US-WA',
      'GEORGIA': 'US-GA', 'ARIZONA': 'US-AZ',
    };

    // Try to detect region from client's province
    if (clientId) {
      const { data: client } = await admin.from('clients').select('province').eq('id', clientId).maybeSingle();
      if (client?.province) {
        region = client.province.toUpperCase().trim();
        region = PROVINCE_MAP[region] || region;
      }
    }
    // Fallback: try lead's address
    if (!region && leadId) {
      const { data: lead } = await admin.from('leads').select('address').eq('id', leadId).maybeSingle();
      if (lead?.address) {
        const addr = lead.address.toUpperCase();
        for (const [name, code] of Object.entries(PROVINCE_MAP)) {
          if (addr.includes(name)) { region = code; break; }
        }
      }
    }

    // Find matching group for this region, or fallback to default
    let group = null;
    if (region) {
      const { data } = await admin.from('tax_groups').select('*')
        .eq('org_id', auth.orgId).eq('region', region).eq('is_active', true).maybeSingle();
      group = data;
    }
    if (!group) {
      const { data } = await admin.from('tax_groups').select('*')
        .eq('org_id', auth.orgId).eq('is_default', true).eq('is_active', true).maybeSingle();
      group = data;
    }
    if (!group) {
      return res.json({ taxes: [], group: null, region });
    }

    // Get taxes in this group
    const { data: items } = await admin.from('tax_group_items')
      .select('*, tax_configs(*)')
      .eq('tax_group_id', group.id)
      .order('sort_order');

    const taxes = (items || [])
      .map((i: any) => i.tax_configs)
      .filter((t: any) => t && t.is_active);

    return res.json({ taxes, group, region });
  } catch (err: any) {
    console.error('[taxes] resolve failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /taxes/setup — setup taxes from a preset (e.g. "QC") ──
router.post('/taxes/setup', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const { preset_key, make_default } = req.body;
    const preset = PRESETS[preset_key];
    if (!preset) return res.status(400).json({ error: 'Invalid preset key.' });

    // Create tax configs
    const configRows = preset.taxes.map(t => ({
      org_id: auth.orgId, name: t.name, rate: t.rate, type: 'percentage' as const,
      region: preset.region, country: preset.country,
      is_compound: t.is_compound, sort_order: t.sort_order,
    }));

    let configIds: string[] = [];
    if (configRows.length > 0) {
      const { data: configs, error } = await admin.from('tax_configs').insert(configRows).select('id');
      if (error) throw error;
      configIds = (configs || []).map((c: any) => c.id);
    }

    // Clear existing default if setting new one
    if (make_default) {
      await admin.from('tax_groups').update({ is_default: false })
        .eq('org_id', auth.orgId).eq('is_default', true);
    }

    // Create tax group
    const { data: group, error: gErr } = await admin.from('tax_groups').insert({
      org_id: auth.orgId, name: preset.name, region: preset.region,
      country: preset.country, is_default: !!make_default,
    }).select('*').single();
    if (gErr) throw gErr;

    // Link configs to group
    if (configIds.length > 0) {
      const linkRows = configIds.map((cid, idx) => ({
        tax_group_id: group.id, tax_config_id: cid, sort_order: idx,
      }));
      await admin.from('tax_group_items').insert(linkRows);
    }

    // Set as company default if requested
    if (make_default) {
      await admin.from('company_settings').update({ default_tax_group_id: group.id })
        .eq('org_id', auth.orgId);
    }

    return res.json({ group, config_count: configIds.length });
  } catch (err: any) {
    console.error('[taxes] setup failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /taxes/config — create custom tax and add to default group ──
router.post('/taxes/config', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const { name, rate, type, region, country, is_compound } = req.body;
    if (!name) return res.status(400).json({ error: 'Tax name is required.' });

    // Create the tax config
    const { data: config, error } = await admin.from('tax_configs').insert({
      org_id: auth.orgId, name, rate: rate || 0, type: type || 'percentage',
      region: region || '', country: country || 'CA', is_compound: is_compound || false,
    }).select('*').single();

    if (error) throw error;

    // Find default group or create one
    let { data: defaultGroup } = await admin.from('tax_groups')
      .select('id').eq('org_id', auth.orgId).eq('is_default', true).maybeSingle();

    if (!defaultGroup) {
      // Create a custom group
      const { data: newGroup } = await admin.from('tax_groups').insert({
        org_id: auth.orgId, name: 'Custom Taxes', region: '', country: '', is_default: true,
      }).select('id').single();
      defaultGroup = newGroup;
    }

    // Add tax to the default group
    if (defaultGroup) {
      await admin.from('tax_group_items').insert({
        tax_group_id: defaultGroup.id, tax_config_id: config.id, sort_order: 99,
      });
    }

    return res.json({ config });
  } catch (err: any) {
    console.error('[taxes] create config failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── PUT /taxes/config/:id — update tax config ──
router.put('/taxes/config/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const { name, rate, is_active } = req.body;
    const update: Record<string, any> = { updated_at: new Date().toISOString() };
    if (name !== undefined) update.name = name;
    if (rate !== undefined) update.rate = rate;
    if (is_active !== undefined) update.is_active = is_active;

    const { data, error } = await admin.from('tax_configs').update(update)
      .eq('id', req.params.id).eq('org_id', auth.orgId).select('*').single();

    if (error) throw error;
    return res.json({ config: data });
  } catch (err: any) {
    console.error('[taxes] update config failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── DELETE /taxes/group/:id — delete a tax group ──
router.delete('/taxes/group/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    // Delete group items first (cascade), then group
    await admin.from('tax_group_items').delete().eq('tax_group_id', req.params.id);
    const { error } = await admin.from('tax_groups').delete()
      .eq('id', req.params.id).eq('org_id', auth.orgId);

    if (error) throw error;
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[taxes] delete group failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── PATCH /taxes/group/:id/default — set group as default ──
router.patch('/taxes/group/:id/default', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    await admin.from('tax_groups').update({ is_default: false })
      .eq('org_id', auth.orgId).eq('is_default', true);

    const { data, error } = await admin.from('tax_groups')
      .update({ is_default: true }).eq('id', req.params.id).eq('org_id', auth.orgId)
      .select('*').single();

    if (error) throw error;

    await admin.from('company_settings').update({ default_tax_group_id: data.id })
      .eq('org_id', auth.orgId);

    return res.json({ group: data });
  } catch (err: any) {
    console.error('[taxes] set default failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
