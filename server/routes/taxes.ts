import { Router } from 'express';
import { requireAuthedClient, getServiceClient, isOrgAdminOrOwner } from '../lib/supabase';
import { guardCommonShape, maxBodySize } from '../lib/validation-guards';

const router = Router();
router.use(maxBodySize());
router.use(guardCommonShape);

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

// Canada — remaining provinces/territories (GST / PST / RST / HST).
const CA_MORE: Array<[string, string, Array<[string, number]>]> = [
  ['AB', 'Alberta (GST)', [['GST', 5]]],
  ['MB', 'Manitoba (GST + RST)', [['GST', 5], ['RST', 7]]],
  ['SK', 'Saskatchewan (GST + PST)', [['GST', 5], ['PST', 6]]],
  ['NS', 'Nova Scotia (HST)', [['HST', 14]]],
  ['NB', 'New Brunswick (HST)', [['HST', 15]]],
  ['NL', 'Newfoundland & Labrador (HST)', [['HST', 15]]],
  ['PE', 'Prince Edward Island (HST)', [['HST', 15]]],
  ['CA-TERR', 'Territories (GST)', [['GST', 5]]],
];
for (const [key, name, parts] of CA_MORE) {
  if (PRESETS[key]) continue;
  PRESETS[key] = { name, region: key, country: 'CA', taxes: parts.map(([n, r], i) => ({ name: n, rate: r, is_compound: false, sort_order: i })) };
}

// USA — statewide base sales tax for every state (0 = no state sales tax).
// Local (county/city) taxes may add on top; the pro adjusts in Tax Settings.
const US_STATES: Array<[string, string, number]> = [
  ['AL', 'Alabama', 4], ['AK', 'Alaska', 0], ['AZ', 'Arizona', 5.6], ['AR', 'Arkansas', 6.5],
  ['CO', 'Colorado', 2.9], ['CT', 'Connecticut', 6.35], ['DE', 'Delaware', 0], ['GA', 'Georgia', 4],
  ['HI', 'Hawaii', 4], ['ID', 'Idaho', 6], ['IL', 'Illinois', 6.25], ['IN', 'Indiana', 7], ['IA', 'Iowa', 6],
  ['KS', 'Kansas', 6.5], ['KY', 'Kentucky', 6], ['LA', 'Louisiana', 4.45], ['ME', 'Maine', 5.5],
  ['MD', 'Maryland', 6], ['MA', 'Massachusetts', 6.25], ['MI', 'Michigan', 6], ['MN', 'Minnesota', 6.875],
  ['MS', 'Mississippi', 7], ['MO', 'Missouri', 4.225], ['MT', 'Montana', 0], ['NE', 'Nebraska', 5.5],
  ['NV', 'Nevada', 6.85], ['NH', 'New Hampshire', 0], ['NJ', 'New Jersey', 6.625], ['NM', 'New Mexico', 4.875],
  ['NY', 'New York', 4], ['NC', 'North Carolina', 4.75], ['ND', 'North Dakota', 5], ['OH', 'Ohio', 5.75],
  ['OK', 'Oklahoma', 4.5], ['OR', 'Oregon', 0], ['PA', 'Pennsylvania', 6], ['RI', 'Rhode Island', 7],
  ['SC', 'South Carolina', 6], ['SD', 'South Dakota', 4.2], ['TN', 'Tennessee', 7], ['UT', 'Utah', 6.1],
  ['VT', 'Vermont', 6], ['VA', 'Virginia', 5.3], ['WA', 'Washington', 6.5], ['WV', 'West Virginia', 6],
  ['WI', 'Wisconsin', 5], ['WY', 'Wyoming', 4], ['DC', 'Washington D.C.', 6],
];
for (const [abbr, name, rate] of US_STATES) {
  const key = `US-${abbr}`;
  if (PRESETS[key]) continue; // keep the hand-tuned CA/TX/FL above
  PRESETS[key] = { name, region: key, country: 'US', taxes: rate > 0 ? [{ name: 'Sales Tax', rate, is_compound: false, sort_order: 0 }] : [] };
}

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
    return res.status(500).json({ error: 'Internal server error' });
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

    // Load the client/lead row once (leads live in the clients table too).
    // tax_exempt ships behind a migration — retry without it so resolve keeps
    // working before the column exists.
    const rowId = clientId || leadId;
    let clientRow: { province?: string | null; address?: string | null; tax_exempt?: boolean } | null = null;
    if (rowId) {
      const full = await admin.from('clients').select('province, address, tax_exempt').eq('id', rowId).eq('org_id', auth.orgId).maybeSingle();
      if (full.error) {
        const fallback = await admin.from('clients').select('province, address').eq('id', rowId).eq('org_id', auth.orgId).maybeSingle();
        clientRow = fallback.data;
      } else {
        clientRow = full.data;
      }
    }

    // Tax-exempt client (governments, First Nations, non-profits…): no taxes
    // on their documents, whatever the region.
    if (clientRow?.tax_exempt) {
      return res.json({ taxes: [], group: null, region: 'EXEMPT', exempt: true });
    }

    // Try to detect region from the client's province
    if (clientRow?.province) {
      region = clientRow.province.toUpperCase().trim();
      region = PROVINCE_MAP[region] || region;
    }
    // Fallback: scan the address for a province name
    if (!region && clientRow?.address) {
      const addr = clientRow.address.toUpperCase();
      for (const [name, code] of Object.entries(PROVINCE_MAP)) {
        if (addr.includes(name)) { region = code; break; }
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
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /taxes/collected?from=YYYY-MM-DD&to=YYYY-MM-DD ──
// Taxes collected (to remit) over a period: sums tax_cents on invoices paid in
// the window, then splits the total across the org's default tax config by rate.
// The split is exact when invoices share the default composition (the common
// case, e.g. TPS+TVQ); it is a proportional estimate otherwise.
router.get('/taxes/collected', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const from = (req.query.from as string) || '';
    const to = (req.query.to as string) || '';

    // 1) Default tax group → its active, non-zero taxes (name + rate + reg #)
    const { data: group } = await admin
      .from('tax_groups')
      .select('id')
      .eq('org_id', auth.orgId)
      .eq('is_default', true)
      .eq('is_active', true)
      .maybeSingle();

    let configured: Array<{ name: string; rate: number; registration_number: string | null }> = [];
    if (group) {
      const { data: items } = await admin
        .from('tax_group_items')
        .select('sort_order, tax_configs(*)')
        .eq('tax_group_id', group.id)
        .order('sort_order');
      configured = (items || [])
        .map((i: any) => i.tax_configs)
        .filter((t: any) => t && t.is_active && Number(t.rate) > 0)
        .map((t: any) => ({
          name: t.name,
          rate: Number(t.rate),
          registration_number: t.registration_number || null,
        }));
    }

    // 2) Sum tax on invoices fully paid within the window
    let q = admin
      .from('invoices')
      .select('tax_cents')
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .eq('status', 'paid');
    if (from) q = q.gte('paid_at', from);
    if (to) q = q.lte('paid_at', `${to}T23:59:59.999Z`);
    const { data: invoices, error } = await q.limit(10000);
    if (error) throw error;

    const totalTaxCents = (invoices || []).reduce(
      (s: number, r: any) => s + (Number(r.tax_cents) || 0),
      0,
    );

    // 3) Split total proportionally by configured rate (last tax gets the
    // remainder so the parts always sum back to the exact total).
    const sumRates = configured.reduce((s, t) => s + t.rate, 0);
    let allocated = 0;
    const taxes = configured.map((t, i) => {
      let cents: number;
      if (i === configured.length - 1) {
        cents = totalTaxCents - allocated;
      } else {
        cents = sumRates > 0 ? Math.round(totalTaxCents * (t.rate / sumRates)) : 0;
        allocated += cents;
      }
      return { name: t.name, rate: t.rate, cents: Math.max(0, cents), registration_number: t.registration_number };
    });

    return res.json({
      from,
      to,
      total_cents: totalTaxCents,
      configured: configured.length > 0,
      taxes,
    });
  } catch (err: any) {
    console.error('[taxes] collected failed:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /taxes/setup — setup taxes from a preset (e.g. "QC") ──
router.post('/taxes/setup', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    if (!await isOrgAdminOrOwner(admin, auth.user.id, auth.orgId)) {
      return res.status(403).json({ error: 'Admin or owner role required.' });
    }

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
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /taxes/config — create custom tax and add to default group ──
router.post('/taxes/config', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    if (!await isOrgAdminOrOwner(admin, auth.user.id, auth.orgId)) {
      return res.status(403).json({ error: 'Admin or owner role required.' });
    }

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
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /taxes/config/:id — update tax config ──
router.put('/taxes/config/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    if (!await isOrgAdminOrOwner(admin, auth.user.id, auth.orgId)) {
      return res.status(403).json({ error: 'Admin or owner role required.' });
    }

    const { name, rate, is_active, registration_number } = req.body;
    const update: Record<string, any> = { updated_at: new Date().toISOString() };
    if (name !== undefined) update.name = name;
    if (rate !== undefined) update.rate = rate;
    if (is_active !== undefined) update.is_active = is_active;
    if (registration_number !== undefined) update.registration_number = registration_number || null;

    const { data, error } = await admin.from('tax_configs').update(update)
      .eq('id', req.params.id).eq('org_id', auth.orgId).select('*').single();

    if (error) throw error;
    return res.json({ config: data });
  } catch (err: any) {
    console.error('[taxes] update config failed:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /taxes/config/:id — remove a tax rate ──
// FKs make this safe: tax_group_items cascade, applied-tax rows SET NULL, and
// invoices/quotes store their computed tax amounts in their own columns.
router.delete('/taxes/config/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    if (!await isOrgAdminOrOwner(admin, auth.user.id, auth.orgId)) {
      return res.status(403).json({ error: 'Admin or owner role required.' });
    }

    const { error } = await admin.from('tax_configs').delete()
      .eq('id', req.params.id).eq('org_id', auth.orgId);

    if (error) throw error;
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[taxes] delete config failed:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /taxes/group/:id — delete a tax group ──
router.delete('/taxes/group/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    if (!await isOrgAdminOrOwner(admin, auth.user.id, auth.orgId)) {
      return res.status(403).json({ error: 'Admin or owner role required.' });
    }

    // Verify the group belongs to the caller's org BEFORE deleting its items —
    // otherwise a foreign group id would wipe another tenant's tax associations.
    const { data: group } = await admin.from('tax_groups')
      .select('id').eq('id', req.params.id).eq('org_id', auth.orgId).maybeSingle();
    if (!group) return res.status(404).json({ error: 'Tax group not found.' });

    // Delete group items first (cascade), then group
    await admin.from('tax_group_items').delete().eq('tax_group_id', req.params.id);
    const { error } = await admin.from('tax_groups').delete()
      .eq('id', req.params.id).eq('org_id', auth.orgId);

    if (error) throw error;
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[taxes] delete group failed:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /taxes/group/:id/default — set group as default ──
router.patch('/taxes/group/:id/default', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    if (!await isOrgAdminOrOwner(admin, auth.user.id, auth.orgId)) {
      return res.status(403).json({ error: 'Admin or owner role required.' });
    }

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
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
