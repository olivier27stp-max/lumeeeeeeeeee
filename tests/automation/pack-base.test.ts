/**
 * Le PACK DE BASE (décidé avec Rafba le 2026-09-28).
 *
 * À la création d'une entreprise : ses parcours sont publiés, tout le reste
 * passe en brouillon (onglet Modèles). Chez une entreprise EXISTANTE : les
 * parcours du pack arrivent en brouillon — sinon ils doubleraient les
 * relances déjà actives (5 relances de devis + le parcours).
 */
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureAutomationPresets, PRESETS_SOLLICITATION } from '../../server/lib/automationPresetSeeder';
import { PACK_PARCOURS, PACK_ACTIF } from '../../server/lib/automationPack.data';
import { AUTOMATION_PRESETS } from '../../server/lib/automationPresets.data';
import { sequenceEtapes } from '../../server/lib/validation';

type Ecrit = { op: 'insert' | 'update'; lignes?: any[]; patch?: any; filtres: Array<[string, string, unknown]> };

function fauxAdmin(existantes: string[]) {
  const ecrits: Ecrit[] = [];
  const from = (table: string) => {
    let ecrit: Ecrit | null = null;
    const filtres: Array<[string, string, unknown]> = [];
    const b: any = {
      update(p: any) { ecrit = { op: 'update', patch: p, filtres }; return b; },
      insert(l: any[]) { ecrits.push({ op: 'insert', lignes: l, filtres }); return Promise.resolve({ error: null }); },
      select() { return b; },
      eq(c: string, v: unknown) { filtres.push(['eq', c, v]); return b; },
      in(c: string, v: unknown) { filtres.push(['in', c, v]); return b; },
      not(c: string, o: string, v: unknown) { filtres.push(['not', c, v]); return b; },
      maybeSingle() { return Promise.resolve({ data: { review_enabled: false }, error: null }); },
      then(res: (v: unknown) => unknown) {
        if (ecrit) { ecrits.push(ecrit); return Promise.resolve({ data: [], error: null }).then(res); }
        if (table === 'automation_rules') return Promise.resolve({ data: existantes.map((k) => ({ preset_key: k })), error: null }).then(res);
        return Promise.resolve({ data: [], error: null }).then(res);
      },
    };
    return b;
  };
  return { admin: { from } as unknown as SupabaseClient, ecrits };
}

describe('les parcours du pack', () => {
  it.each(PACK_PARCOURS.map((p) => [p.preset_key, p] as const))('%s passe la validation du serveur', (_k, p) => {
    const v = sequenceEtapes.safeParse(p.steps);
    expect(v.success, v.success ? '' : JSON.stringify(v.error.issues.slice(0, 2))).toBe(true);
  });

  it('le rendez-vous : confirmation puis rappels 7 j, veille et 2 h AVANT la date', () => {
    const rdv = PACK_PARCOURS.find((p) => p.preset_key === 'pack_rendez_vous')!;
    const avant = rdv.steps.filter((e: any) => e.mode === 'avant_date').map((e: any) => e.secondes_avant);
    expect(avant).toEqual([7 * 86400, 86400, 7200]);
  });

  it('la relance de devis : 1, 2, 5, 10 et 30 j, par le canal de l’envoi', () => {
    const d = PACK_PARCOURS.find((p) => p.preset_key === 'pack_relance_devis')!;
    let cumul = 0;
    const jalons = d.steps.filter((e: any) => e.type === 'attendre').map((e: any) => (cumul += e.delai_secondes) / 86400);
    expect(jalons).toEqual([1, 2, 5, 10, 30]);
    expect(d.steps.filter((e: any) => e.type === 'si' && e.conditions?.channel?.eq === 'sms')).toHaveLength(5);
  });

  it('la relance de facture : 3, 7, 14 et 30 j', () => {
    const f = PACK_PARCOURS.find((p) => p.preset_key === 'pack_relance_facture')!;
    let cumul = 0;
    expect(f.steps.filter((e: any) => e.type === 'attendre').map((e: any) => (cumul += e.delai_secondes) / 86400)).toEqual([3, 7, 14, 30]);
  });

  it.each([
    ['pack_relance_devis', 'quote_link'],
    ['pack_relance_facture', 'invoice_link'],
    ['pack_depot', 'quote_link'],
  ])('%s : chaque texto et courriel porte le lien [%s]', (cle, lien) => {
    const p = PACK_PARCOURS.find((x) => x.preset_key === cle)!;
    const envois = p.steps.filter((e: any) => e.type === 'action' && /^send_/.test(e.action.type));
    expect(envois.length).toBeGreaterThan(0);
    for (const e of envois as any[]) expect(String(e.action.config.body)).toContain(`[${lien}]`);
  });

  it('aucune sollicitation commerciale n’est publiée d’office', () => {
    for (const k of PACK_ACTIF) expect(PRESETS_SOLLICITATION.has(k)).toBe(false);
  });
});

describe('à la création d’une entreprise', () => {
  it('publie le pack et met TOUT le reste en brouillon', async () => {
    const { admin, ecrits } = fauxAdmin(AUTOMATION_PRESETS.map((p) => p.preset_key));
    await ensureAutomationPresets(admin, 'org-neuve', { activateAll: true });
    const publie = ecrits.find((e) => e.op === 'update' && e.patch?.is_active === true && e.filtres.some(([op, c]) => op === 'in' && c === 'preset_key'));
    const brouillon = ecrits.find((e) => e.op === 'update' && e.patch?.is_active === false && e.filtres.some(([op, c]) => op === 'not' && c === 'preset_key'));
    const cles = publie!.filtres.find(([op]) => op === 'in')![2] as string[];
    expect(new Set(cles)).toEqual(new Set([...PACK_ACTIF]));
    expect(brouillon).toBeTruthy();
  });
});

describe('chez une entreprise existante', () => {
  it('les parcours du pack arrivent en BROUILLON (pas de relances en double)', async () => {
    const { admin, ecrits } = fauxAdmin(AUTOMATION_PRESETS.map((p) => p.preset_key));
    await ensureAutomationPresets(admin, 'org-existante');
    const insertion = ecrits.find((e) => e.op === 'insert')!;
    expect(insertion.lignes!.map((l) => l.preset_key).sort()).toEqual(PACK_PARCOURS.map((p) => p.preset_key).sort());
    expect(insertion.lignes!.every((l) => l.is_active === false)).toBe(true);
    expect(insertion.lignes!.every((l) => Array.isArray(l.steps) && l.steps.length > 0)).toBe(true);
    // Aucune activation massive hors création.
    expect(ecrits.some((e) => e.op === 'update' && e.patch?.is_active === true)).toBe(false);
  });
});
