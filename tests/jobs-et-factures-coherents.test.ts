/**
 * TROIS TRIGGERS QUI LAISSAIENT LES DONNÉES MENTIR.
 *
 * Passe d'invariants métier sur la prod (2026-09-06, npm run qa:invariants
 * -- --prod) : 9 violations sur 35. Trois venaient de triggers :
 *
 *   1. recalculate_job_totals_from_items écrivait `subtotal` (dollars,
 *      projection) et `total_cents`, jamais `subtotal_cents` — puis la
 *      projection était recalculée depuis subtotal_cents = 0. Jobs 14 et
 *      15 : total 760 $, sous-total 0 $.
 *   2. Aucun trigger ne posait `completed_at` ; l'interface (UPDATE direct)
 *      non plus. 6 jobs terminés sur 6 sans date de fin — et les
 *      automatisations « X jours après un job terminé » (scheduler.ts)
 *      se déclenchent sur cette colonne : jamais parties.
 *   3. invoices_apply_status_logic forçait « brouillon » tant que
 *      issued_at était vide, avant de regarder le solde. « Marquer payée »
 *      sur un brouillon : 1 535 $ encaissés, statut brouillon.
 *
 * CE QUE CES TESTS FIGENT
 * Le contenu exact des trois correctifs, et le lien scheduler ↔ completed_at
 * qui justifie le deuxième.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RACINE = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(RACINE, p), 'utf8');
const MIG = lire('supabase/migrations/20260906140000_jobs_et_factures_coherents.sql');

describe('1. le recalcul des totaux d un job n écrit que les cents', () => {
  const fn = MIG.slice(MIG.indexOf('create or replace function public.recalculate_job_totals_from_items'), MIG.indexOf('-- ── 2.'));

  it('pose subtotal_cents depuis les lignes', () => {
    expect(fn).toMatch(/set subtotal_cents = v_subtotal_cents/);
  });

  it('pose total_cents = sous-total + tax_cents (cents, pas tax_total en dollars)', () => {
    expect(fn).toMatch(/total_cents\s+= v_subtotal_cents \+ coalesce\(tax_cents, 0\)/);
    // L'ancienne version calculait la taxe depuis tax_total (dollars).
    expect(fn).not.toMatch(/round\(tax_total/);
  });

  it('ne touche plus aux projections en dollars', () => {
    // subtotal, total, total_amount sont posés par sync_legacy_money_columns.
    expect(fn).not.toMatch(/set subtotal\s*=/);
    expect(fn).not.toMatch(/total_amount\s*=/);
  });

  it('ignore les lignes supprimées', () => {
    expect(fn).toMatch(/where job_id = v_job_id\s+and deleted_at is null/);
  });
});

describe('2. completed_at suit le statut, quel que soit le chemin', () => {
  it('un trigger BEFORE INSERT OR UPDATE OF status existe sur jobs', () => {
    expect(MIG).toMatch(/create trigger trg_jobs_set_completed_at\s+before insert or update of status on public\.jobs/);
  });

  it('il pose now() au passage à completed, sans écraser une date existante', () => {
    expect(MIG).toMatch(/if new\.status = 'completed' and new\.completed_at is null then\s+new\.completed_at := now\(\);/);
  });

  it('les automatisations après-job lisent bien completed_at — c est ce qui justifie le trigger', () => {
    const sched = lire('server/lib/scheduler.ts');
    expect(sched).toContain(".not('completed_at', 'is', null)");
    expect(sched).toMatch(/new Date\(job\.completed_at\)/);
  });

  it('le chemin de l interface est un UPDATE direct qui ne pose pas completed_at', () => {
    // Le trigger existe parce que ce chemin-là est muet. Si un jour l'API
    // le pose elle-même, le trigger reste inoffensif (il ne remplace pas
    // une date existante).
    const api = lire('src/lib/jobsApi.ts');
    expect(api).toMatch(/from\('jobs'\)\.update\(updatePayload\)/);
    const i = api.indexOf('export async function updateJob(');
    const bloc = i === -1 ? api : api.slice(i, i + 4000);
    expect(bloc).not.toMatch(/completed_at:\s*new Date/);
  });
});

describe('3. une facture encaissée a été émise', () => {
  const fn = MIG.slice(MIG.indexOf('create or replace function public.invoices_apply_status_logic'), MIG.indexOf('-- ── Rattrapage'));

  it('issued_at est posé quand de l argent est entré, AVANT le test brouillon', () => {
    const iPose = fn.indexOf("if new.issued_at is null and new.paid_cents > 0 then");
    const iDraft = fn.indexOf("if new.issued_at is null then");
    expect(iPose).toBeGreaterThan(-1);
    expect(iDraft).toBeGreaterThan(iPose);
    expect(fn.slice(iPose, iPose + 200)).toContain('new.issued_at := coalesce(new.paid_at, now())');
  });

  it('le reste de la logique est inchangé', () => {
    for (const ligne of [
      "new.balance_cents := greatest(new.total_cents - new.paid_cents, 0);",
      "if coalesce(new.status, '') = 'void' then",
      "if new.balance_cents = 0 then",
      "new.status := 'partial';",
      "new.status := 'sent';",
    ]) expect(fn).toContain(ligne);
  });
});

describe('le rattrapage ne touche que les lignes fautives', () => {
  const r = MIG.slice(MIG.indexOf('-- ── Rattrapage'));

  it('sous-totaux : seulement ceux qui diffèrent de leurs lignes', () => {
    expect(r).toMatch(/and j\.subtotal_cents is distinct from s\.somme/);
  });

  it('completed_at : seulement les terminés sans date, avec la meilleure date connue', () => {
    expect(r).toMatch(/set completed_at = coalesce\(closed_at, updated_at\)\s+where status = 'completed'\s+and completed_at is null/);
  });

  it('factures : seulement celles encaissées jamais émises, en rejouant le trigger', () => {
    expect(r).toMatch(/set updated_at = now\(\)\s+where issued_at is null\s+and paid_cents > 0/);
  });
});

describe('la passe d invariants est un outil du projet', () => {
  it('npm run qa:invariants existe et couvre les trois familles', () => {
    expect(JSON.parse(lire('package.json')).scripts['qa:invariants']).toContain('invariants.mjs');
    const s = lire('scripts/qa/invariants.mjs');
    expect(s).toContain('job : sous-total ≠ somme des lignes');
    expect(s).toContain('job : terminé sans completed_at');
    expect(s).toContain('facture : solde 0, total > 0, statut ≠ payée');
  });
});
