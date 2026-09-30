/**
 * Les demandes d'avis ne naissent pas publiées tant que les avis sont
 * désactivés.
 *
 * Mesuré en prod le 2026-09-28 : le préréglage « Demander un avis » était
 * publié d'office alors que `review_enabled` vaut faux à la création —
 * chaque job terminée donnait un échec (« Review requests are disabled ») et
 * l'entrepreneur croyait ses demandes parties.
 */
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureAutomationPresets, PRESETS_ATTENDENT_AVIS } from '../../server/lib/automationPresetSeeder';
import { AUTOMATION_PRESETS } from '../../server/lib/automationPresets.data';

interface Ecriture { table: string; patch: Record<string, unknown>; filtres: Array<[string, string, unknown]> }

function fauxAdmin(reviewEnabled: boolean | null) {
  const ecritures: Ecriture[] = [];
  const from = (table: string) => {
    let patch: Record<string, unknown> | null = null;
    const filtres: Array<[string, string, unknown]> = [];
    const resultat = () => {
      if (patch) ecritures.push({ table, patch, filtres });
      return { data: [], error: null };
    };
    const b: any = {
      update(p: Record<string, unknown>) { patch = p; return b; },
      insert() { return Promise.resolve({ error: null }); },
      select() { return b; },
      eq(c: string, v: unknown) { filtres.push(['eq', c, v]); return b; },
      is(c: string, v: unknown) { filtres.push(['is', c, v]); return b; },
      in(c: string, v: unknown) { filtres.push(['in', c, v]); return b; },
      not(c: string, _o: string, v: unknown) { filtres.push(['not', c, v]); return b; },
      maybeSingle() {
        return Promise.resolve({ data: reviewEnabled === null ? null : { review_enabled: reviewEnabled }, error: null });
      },
      then(res: (v: unknown) => unknown) {
        // La lecture des presets existants : on répond « tous présents ».
        if (!patch && table === 'automation_rules') {
          return Promise.resolve({ data: AUTOMATION_PRESETS.map((p) => ({ preset_key: p.preset_key })), error: null }).then(res);
        }
        return Promise.resolve(resultat()).then(res);
      },
    };
    return b;
  };
  return { admin: { from } as unknown as SupabaseClient, ecritures };
}

const miseEnBrouillonAvis = (e: Ecriture[]) => e.find((x) =>
  x.table === 'automation_rules' && x.patch.is_active === false
  && x.filtres.some(([op, c, v]) => op === 'in' && c === 'preset_key'
    && Array.isArray(v) && v.includes('google_review')));

describe('préréglages d\'avis à la création d\'une entreprise', () => {
  it('avis désactivés → les règles d\'avis sont remises en brouillon', async () => {
    const { admin, ecritures } = fauxAdmin(false);
    await ensureAutomationPresets(admin, 'org-1', { activateAll: true });
    expect(miseEnBrouillonAvis(ecritures)).toBeTruthy();
  });

  it('aucune ligne de réglages (entreprise neuve) → brouillon aussi', async () => {
    const { admin, ecritures } = fauxAdmin(null);
    await ensureAutomationPresets(admin, 'org-1', { activateAll: true });
    expect(miseEnBrouillonAvis(ecritures)).toBeTruthy();
  });

  it('avis déjà activés → on n\'y touche pas', async () => {
    const { admin, ecritures } = fauxAdmin(true);
    await ensureAutomationPresets(admin, 'org-1', { activateAll: true });
    expect(miseEnBrouillonAvis(ecritures)).toBeFalsy();
  });

  it('hors création (filet quotidien), on ne réécrit jamais le choix de l\'entreprise', async () => {
    const { admin, ecritures } = fauxAdmin(false);
    await ensureAutomationPresets(admin, 'org-1');
    expect(miseEnBrouillonAvis(ecritures)).toBeFalsy();
  });

  it('les deux préréglages d\'avis existent vraiment dans le catalogue', () => {
    const cles = new Set(AUTOMATION_PRESETS.map((p) => p.preset_key));
    for (const k of PRESETS_ATTENDENT_AVIS) expect(cles.has(k)).toBe(true);
  });
});
