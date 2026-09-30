/**
 * Le socle d'une entreprise (automatisations, services, taxes) ne s'applique
 * qu'UNE fois (2026-09-30).
 *
 * Le webhook de paiement rappelait l'installation « de création » sur une
 * entreprise EXISTANTE (client qui paie par un lien avec un compte déjà
 * ouvert) : pack republié, tout le reste remis en brouillon, unité par défaut
 * réécrite, services supprimés reposés, 2e groupe de taxes mis par défaut.
 */
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureAutomationPresets } from '../../server/lib/automationPresetSeeder';
import { seedOrgComplete } from '../../server/lib/seedOrgDefaults';
import { AUTOMATION_PRESETS } from '../../server/lib/automationPresets.data';

type Ecrit = { table: string; op: 'insert' | 'update' | 'upsert'; valeur: any; filtres: Array<[string, string, unknown]> };

function fauxAdmin({ marque, presets, services = 0, taxes = 0 }: { marque: string | null; presets: string[]; services?: number; taxes?: number }) {
  const ecrits: Ecrit[] = [];
  const from = (table: string) => {
    let ecrit: Ecrit | null = null;
    const filtres: Array<[string, string, unknown]> = [];
    const b: any = {
      update(v: any) { ecrit = { table, op: 'update', valeur: v, filtres }; return b; },
      upsert(v: any) { ecrits.push({ table, op: 'upsert', valeur: v, filtres }); return Promise.resolve({ error: null }); },
      insert(v: any) { ecrits.push({ table, op: 'insert', valeur: v, filtres }); return b; },
      select() { return b; },
      single() { return Promise.resolve({ data: { id: 'x' }, error: null }); },
      eq(c: string, v: unknown) { filtres.push(['eq', c, v]); return b; },
      is(c: string, v: unknown) { filtres.push(['is', c, v]); return b; },
      in(c: string, v: unknown) { filtres.push(['in', c, v]); return b; },
      not(c: string, o: string, v: unknown) { filtres.push(['not', c, v]); return b; },
      limit() { return b; },
      maybeSingle() {
        if (table === 'orgs') return Promise.resolve({ data: { automations_initialisees_le: marque }, error: null });
        if (table === 'tax_groups') return Promise.resolve({ data: taxes > 0 ? { id: 't0' } : null, error: null });
        return Promise.resolve({ data: { review_enabled: false }, error: null });
      },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
        if (ecrit) { ecrits.push(ecrit); ecrit = null; return Promise.resolve({ data: [], error: null }).then(res, rej); }
        if (table === 'automation_rules') return Promise.resolve({ data: presets.map((k) => ({ preset_key: k })), error: null }).then(res, rej);
        if (table === 'predefined_services') return Promise.resolve({ data: Array.from({ length: services }, (_, i) => ({ id: `s${i}` })), error: null }).then(res, rej);
        if (table === 'tax_groups') return Promise.resolve({ data: Array.from({ length: taxes }, (_, i) => ({ id: `t${i}` })), error: null }).then(res, rej);
        return Promise.resolve({ data: [], error: null }).then(res, rej);
      },
    };
    return b;
  };
  return { admin: { from } as unknown as SupabaseClient, ecrits };
}

const activations = (ecrits: Ecrit[]) => ecrits.filter((e) => e.table === 'automation_rules' && e.op === 'update' && 'is_active' in (e.valeur ?? {}));

describe('automatisations : le pack ne se pose qu’une fois', () => {
  it('entreprise NEUVE : pack publié, reste en brouillon, puis marquée', async () => {
    const { admin, ecrits } = fauxAdmin({ marque: null, presets: AUTOMATION_PRESETS.map((p) => p.preset_key) });
    await ensureAutomationPresets(admin, 'org-neuve', { activateAll: true });
    expect(activations(ecrits).length).toBeGreaterThanOrEqual(2);
    const marque = ecrits.find((e) => e.table === 'orgs' && e.op === 'update');
    expect(marque?.valeur.automations_initialisees_le).toBeTruthy();
  });

  it('entreprise EXISTANTE (paiement par lien) : AUCUNE activation touchée', async () => {
    const { admin, ecrits } = fauxAdmin({ marque: '2026-09-01T00:00:00Z', presets: AUTOMATION_PRESETS.map((p) => p.preset_key) });
    await ensureAutomationPresets(admin, 'org-existante', { activateAll: true });
    expect(activations(ecrits)).toEqual([]);
    expect(ecrits.some((e) => e.table === 'orgs')).toBe(false);
  });

  it('entreprise EXISTANTE : ce qui manque arrive en brouillon, jamais publié', async () => {
    const { admin, ecrits } = fauxAdmin({ marque: '2026-09-01T00:00:00Z', presets: [] });
    await ensureAutomationPresets(admin, 'org-existante', { activateAll: true });
    const insertion = ecrits.find((e) => e.table === 'automation_rules' && e.op === 'insert');
    expect(insertion).toBeTruthy();
    expect((insertion!.valeur as Array<{ is_active: boolean }>).every((l) => l.is_active === false)).toBe(true);
  });
});

describe('services et taxes : on ne refait pas le socle d’une entreprise équipée', () => {
  it('entreprise EXISTANTE : ni services, ni unité par défaut, ni taxes réécrits', async () => {
    const { admin, ecrits } = fauxAdmin({ marque: '2026-09-01T00:00:00Z', presets: AUTOMATION_PRESETS.map((p) => p.preset_key), services: 3, taxes: 1 });
    await seedOrgComplete(admin, 'org-existante', { industry: 'window_cleaning', taxRegion: 'QC' });
    expect(ecrits.filter((e) => ['company_settings', 'predefined_services', 'tax_groups', 'tax_configs'].includes(e.table))).toEqual([]);
    expect(activations(ecrits)).toEqual([]);
  });

  it('entreprise NEUVE : services et taxes posés', async () => {
    const { admin, ecrits } = fauxAdmin({ marque: null, presets: AUTOMATION_PRESETS.map((p) => p.preset_key) });
    await seedOrgComplete(admin, 'org-neuve', { industry: 'window_cleaning', taxRegion: 'QC' });
    expect(ecrits.some((e) => e.table === 'company_settings' && e.op === 'upsert')).toBe(true);
    expect(ecrits.some((e) => e.table === 'tax_groups' || e.table === 'tax_configs')).toBe(true);
  });
});
