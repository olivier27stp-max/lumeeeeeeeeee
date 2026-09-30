/**
 * Rentabilité (analyze_profitability) — calculateur, gabarits, sécurité, routeur.
 * Voir PROFITABILITY_PLAN.md. Les montants attendus sont calculés à la main
 * dans chaque test : un test qui recopie la formule ne prouverait rien.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORG = '11111111-2222-3333-4444-555555555555';
const PROPRIO = 'aaaaaaaa-0000-4000-8000-000000000001';
const TECH_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const TECH_B = 'aaaaaaaa-0000-4000-8000-00000000000b';
const REP = 'aaaaaaaa-0000-4000-8000-0000000000e1';
const J1 = 'bbbbbbbb-0000-4000-8000-000000000001';
const J2 = 'bbbbbbbb-0000-4000-8000-000000000002';

/* ── Faux client Supabase : eq / neq / is / in / not is null / gt / gte / lt, pagination ── */
let tables: Record<string, any[]> = {};
let role = 'owner';
let perms: Record<string, boolean> = {};

function fauxClient() {
  return {
    from: (table: string) => {
      const conds: Array<(l: any) => boolean> = [];
      let de = 0; let a = 999; let tete = false; let compte = false; let unique = false; let limite = Infinity;
      const q: any = {
        select: (_c?: string, o?: { count?: string; head?: boolean }) => { if (o?.head) tete = true; if (o?.count) compte = true; return q; },
        eq: (c: string, v: any) => { conds.push((l) => l[c] === v); return q; },
        neq: (c: string, v: any) => { conds.push((l) => l[c] !== v); return q; },
        is: (c: string, v: any) => { conds.push((l) => (l[c] ?? null) === v); return q; },
        in: (c: string, vs: any[]) => { conds.push((l) => vs.includes(l[c])); return q; },
        not: (c: string, _op: string, _v: any) => { conds.push((l) => l[c] != null); return q; },
        gt: (c: string, v: any) => { conds.push((l) => l[c] > v); return q; },
        gte: (c: string, v: any) => { conds.push((l) => l[c] >= v); return q; },
        lt: (c: string, v: any) => { conds.push((l) => l[c] < v); return q; },
        or: () => q, order: () => q,
        limit: (n: number) => { limite = n; return q; },
        range: (x: number, y: number) => { de = x; a = y; return q; },
        maybeSingle: () => { unique = true; return q; },
        then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => {
          const lignes = (tables[table] ?? []).filter((l) => conds.every((c) => c(l)));
          const r = tete ? { data: null, count: lignes.length, error: null }
            : unique ? { data: lignes[0] ?? null, error: null }
            : { data: lignes.slice(de, a + 1).slice(0, limite), error: null, ...(compte ? { count: lignes.length } : {}) };
          return Promise.resolve(r).then(ok, ko);
        },
      };
      return q;
    },
  };
}
vi.mock('../server/lib/supabase', () => ({ getServiceClient: () => fauxClient() }));
vi.mock('../server/lib/rbac', () => ({
  getUserContext: async (_c: unknown, userId: string, orgId: string) => ({ userId, orgId, role, permissions: perms }),
  hasPermission: (ctx: { role: string; permissions: Record<string, boolean> }, k: string) => ctx.role === 'owner' || ctx.permissions[k] === true,
}));

import { analyser, type Donnees, type Filtres } from '../server/lib/rentabilite/calcul';
import { analyserRentabilite, viderCacheRentabilite, REFUS_PERMISSION } from '../server/lib/rentabilite';
import { detecterRentabilite, periodeRentabilite } from '../server/lib/lumi/actions-directes';
import { PERMISSION_PAR_OUTIL, OUTILS_FINANCIERS } from '../server/lib/agent/garde';

/* ── Fixtures du calculateur ── */
const job = (id: string, o: Partial<Donnees['jobs'][number]> = {}): Donnees['jobs'][number] => ({
  id, numero: id === J1 ? '101' : '102', titre: id === J1 ? 'Lavage vitres' : 'Gouttières', clientId: 'c1', clientNom: 'Marie Tremblay',
  vendeurId: null, creeParId: PROPRIO, subtotalCents: 0, depensesJobCents: 0, jourReference: '2026-09-10', ...o,
});
const vide = (o: Partial<Donnees> = {}): Donnees => ({
  jobs: [], visites: [], factures: [], soumissions: [], pointages: [], membres: [], commissions: [],
  depensesChamps: [], materiaux: [], lignes: [], reglesCommission: { parDefaut: false, assignes: [] }, ...o,
});
const F = (o: Partial<Filtres> = {}): Filtres => ({ du: '2026-01-01', au: '2026-09-30', groupePar: 'job', tri: 'revenus_desc', limite: 10, ...o });
const tech = (userId: string, nom: string, tauxCents: number | null, mode: 'hourly' | 'commission' | 'both' = 'hourly') => ({ userId, nom, tauxCents, mode, equipeId: null });

describe('calculateur — un job complet', () => {
  // Facture 1 000 $ avant taxes (1 149,75 $ avec taxes), 4 h à 30 $/h, commission 50 $, dépenses 80 $
  const d = vide({
    jobs: [job(J1)],
    factures: [{ jobId: J1, netCents: 100_000, totalCents: 114_975, rembourseCents: 0 }],
    pointages: [{ jobId: J1, userId: TECH_A, nom: 'Marc', jour: '2026-09-10', heures: 4 }],
    membres: [tech(TECH_A, 'Marc Roy', 3000)],
    commissions: [{ jobId: J1, montantCents: 5000 }],
    depensesChamps: [{ jobId: J1, montantCents: 8000 }],
  });
  const r = analyser(d, F());

  it('revenu avant taxes, coûts ventilés, profit et marge', () => {
    expect(r.totaux).toMatchObject({
      revenus_cents: 100_000, main_oeuvre_cents: 12_000, commissions_cents: 5000, depenses_cents: 8000,
      couts_cents: 25_000, profit_cents: 75_000, marge_pct: 75, heures: 4,
    });
    expect(r.completude).toBe('complete');
    expect(r.marge_est_un_maximum).toBe(false);
    expect(r.manquant).toEqual([]);
    expect(r.action).toBeNull();
  });

  it('golden : résumé français et anglais', () => {
    expect(r.resume_fr).toBe(
      'Du 1er janvier au 30 septembre 2026, 1 job : revenus 1 000,00 $, coûts 250,00 $, profit 750,00 $ (marge 75,0 %). '
      + 'Inclus : factures (1 job), 4 h pointées (trajets pointés compris), commissions 50,00 $, dépenses 80,00 $. Rien ne manque.',
    );
    expect(r.resume_en).toBe(
      'From January 1 to September 30, 2026, 1 job: revenue $1,000.00, costs $250.00, profit $750.00 (margin 75.0%). '
      + 'Included: invoices (1 job), 4 h clocked (clocked travel included), commissions $50.00, expenses $80.00. Nothing is missing.',
    );
  });

  it('ne contient aucun taux horaire, nulle part', () => {
    expect(JSON.stringify(r)).not.toMatch(/taux_cents|tauxCents|hourly_rate|"rate"/);
    expect(JSON.stringify(r)).not.toContain('3000');
  });
});

describe('calculateur — revenus', () => {
  it('un remboursement retire sa part AVANT taxes', () => {
    // Facture 100 $ + taxes = 114,98 $, remboursée de moitié (57,49 $) → revenu 50 $
    const r = analyser(vide({
      jobs: [job(J1)],
      factures: [{ jobId: J1, netCents: 10_000, totalCents: 11_498, rembourseCents: 5749 }],
      depensesChamps: [{ jobId: J1, montantCents: 1000 }],
    }), F());
    expect(r.totaux.revenus_cents).toBe(5000);
  });

  it('sans facture : prix du job, marqué estimation (pas un maximum)', () => {
    const r = analyser(vide({
      jobs: [job(J1, { subtotalCents: 20_000 })],
      pointages: [{ jobId: J1, userId: TECH_A, nom: 'Marc', jour: '2026-09-10', heures: 1 }],
      membres: [tech(TECH_A, 'Marc Roy', 3000)],
      depensesChamps: [{ jobId: J1, montantCents: 2000 }],
    }), F());
    expect(r.totaux.revenus_cents).toBe(20_000);
    expect(r.marge_est_un_maximum).toBe(false);
    expect(r.inclus.map((i) => i.code)).toContain('prix_job_estime');
    expect(r.contient_estimations).toBe(true);
    expect(r.resume_fr).toContain('profit estimé 150,00 $ (marge estimée 75,0 %)');
  });

  it('sans facture ni prix : soumission acceptée, sinon revenu inconnu', () => {
    const avecDevis = analyser(vide({ jobs: [job(J1)], soumissions: [{ jobId: J1, netCents: 30_000 }], depensesChamps: [{ jobId: J1, montantCents: 1 }] }), F());
    expect(avecDevis.inclus.map((i) => i.code)).toContain('soumission_estimee');
    const rien = analyser(vide({ jobs: [job(J1)] }), F());
    expect(rien.manquant.map((m) => m.code)).toContain('revenu_inconnu');
    expect(rien.action?.code).toBe('facturer');
    expect(rien.resume_fr).toContain('aucun revenu connu, la rentabilité ne peut pas être calculée');
  });

  it('revenu à 0 : le profit, jamais de %', () => {
    const r = analyser(vide({
      jobs: [job(J1)],
      factures: [{ jobId: J1, netCents: 0, totalCents: 0, rembourseCents: 0 }],
      depensesChamps: [{ jobId: J1, montantCents: 30_000 }],
    }), F());
    expect(r.totaux.profit_cents).toBe(-30_000);
    expect(r.totaux.marge_pct).toBeNull();
    expect(r.resume_fr).toContain('pas de marge en % sans revenu');
  });
});

describe('calculateur — coûts manquants et estimations', () => {
  it('un taux absent n’est jamais inventé : manquant nommé, marge d’au plus', () => {
    const r = analyser(vide({
      jobs: [job(J1)],
      factures: [{ jobId: J1, netCents: 100_000, totalCents: 114_975, rembourseCents: 0 }],
      pointages: [{ jobId: J1, userId: TECH_A, nom: 'Marc', jour: '2026-09-10', heures: 14.5 }],
      membres: [tech(TECH_A, 'Marc Roy', null)],
    }), F());
    expect(r.totaux.main_oeuvre_cents).toBe(0);
    expect(r.manquant).toEqual([{ code: 'taux_horaire', nb_jobs: 1, noms: ['Marc Roy'], heures: 14.5 }]);
    expect(r.completude).toBe('partielle');
    expect(r.marge_est_un_maximum).toBe(true);
    expect(r.action?.code).toBe('saisir_taux');
    expect(r.resume_fr).toBe(
      'Du 1er janvier au 30 septembre 2026, 1 job : revenus 1 000,00 $, coûts connus 0,00 $, profit d’au plus 1 000,00 $ (marge d’au plus 100,0 %). '
      + 'Inclus : factures (1 job), 14,5 h pointées (trajets pointés compris). Manquant : taux horaire de Marc Roy (14,5 h). '
      + 'À faire : Saisis le taux horaire de Marc Roy dans Équipe (14,5 h sans taux).',
    );
  });

  it('aucun coût du tout : insuffisante, pas de marge affichée', () => {
    const r = analyser(vide({ jobs: [job(J1)], factures: [{ jobId: J1, netCents: 50_000, totalCents: 57_488, rembourseCents: 0 }] }), F());
    expect(r.completude).toBe('insuffisante');
    expect(r.action?.code).toBe('pointer_heures');
    expect(r.resume_fr).toBe(
      'Du 1er janvier au 30 septembre 2026, 1 job : revenus 500,00 $, mais aucun coût n’est saisi : la rentabilité ne peut pas être calculée. '
      + 'Inclus : factures (1 job). Manquant : aucune main-d’œuvre sur 1 job. '
      + 'À faire : Pointe les heures sur les jobs, ou assigne les visites à un technicien (1 job sans main-d’œuvre).',
    );
    expect(r.resume_en).toBe(
      'From January 1 to September 30, 2026, 1 job: revenue $500.00, but no cost is recorded, so profitability cannot be calculated. '
      + 'Included: invoices (1 job). Missing: no labour on 1 job. '
      + 'Next step: Clock hours on jobs, or assign visits to a technician (1 job with no labour).',
    );
  });

  it('sans pointage : durée des visites × technicien assigné, en estimation', () => {
    const r = analyser(vide({
      jobs: [job(J1)],
      factures: [{ jobId: J1, netCents: 40_000, totalCents: 45_990, rembourseCents: 0 }],
      visites: [{ jobId: J1, jour: '2026-09-10', heures: 2, assigne: TECH_A, equipeId: null }],
      membres: [tech(TECH_A, 'Marc Roy', 2500)],
    }), F());
    expect(r.totaux.main_oeuvre_cents).toBe(5000);
    expect(r.inclus.find((i) => i.code === 'heures_planifiees')?.heures).toBe(2);
    expect(r.contient_estimations).toBe(true);
    expect(r.marge_est_un_maximum).toBe(false);
  });

  it('technicien payé à la commission : pas de coût horaire, pas de manquant', () => {
    const r = analyser(vide({
      jobs: [job(J1)],
      factures: [{ jobId: J1, netCents: 40_000, totalCents: 45_990, rembourseCents: 0 }],
      pointages: [{ jobId: J1, userId: TECH_A, nom: 'Marc', jour: '2026-09-10', heures: 3 }],
      membres: [tech(TECH_A, 'Marc Roy', null, 'commission')],
    }), F());
    expect(r.manquant).toEqual([]);
    expect(r.totaux.main_oeuvre_cents).toBe(0);
  });

  it('vendeur à commission, facture émise, aucune commission : manquant', () => {
    const r = analyser(vide({
      jobs: [job(J1, { vendeurId: REP })],
      factures: [{ jobId: J1, netCents: 40_000, totalCents: 45_990, rembourseCents: 0 }],
      pointages: [{ jobId: J1, userId: TECH_A, nom: 'Marc', jour: '2026-09-10', heures: 1 }],
      membres: [tech(TECH_A, 'Marc Roy', 3000), tech(REP, 'Julie Côté', null, 'commission')],
      reglesCommission: { parDefaut: true, assignes: [] },
    }), F());
    expect(r.manquant).toEqual([{ code: 'commission_non_calculee', nb_jobs: 1, noms: ['Julie Côté'] }]);
    expect(r.marge_est_un_maximum).toBe(true);
  });
});

describe('calculateur — dépenses : pas de double compte', () => {
  it('les champs Dépenses remplacent l’ancien total du job, jamais les deux', () => {
    const r = analyser(vide({
      jobs: [job(J1, { depensesJobCents: 99_999 })],
      factures: [{ jobId: J1, netCents: 100_000, totalCents: 114_975, rembourseCents: 0 }],
      depensesChamps: [{ jobId: J1, montantCents: 3000 }, { jobId: J1, montantCents: 2000 }],
    }), F());
    expect(r.totaux.depenses_cents).toBe(5000);
    expect(r.groupes[0].depenses_saisie_libre).toBe(false);
  });
  it('sans champ Dépenses rempli : l’ancien total compte (et reste modifiable)', () => {
    const r = analyser(vide({
      jobs: [job(J1, { depensesJobCents: 7000 })],
      factures: [{ jobId: J1, netCents: 100_000, totalCents: 114_975, rembourseCents: 0 }],
    }), F());
    expect(r.totaux.depenses_cents).toBe(7000);
    expect(r.groupes[0].depenses_saisie_libre).toBe(true);
  });
  it('matériaux : chiffrés comptés, sans coût = manquant', () => {
    const r = analyser(vide({
      jobs: [job(J1)],
      factures: [{ jobId: J1, netCents: 100_000, totalCents: 114_975, rembourseCents: 0 }],
      materiaux: [{ jobId: J1, nom: 'Savon', quantite: 2, coutUnitaireCents: 1250 }, { jobId: J1, nom: 'Perche', quantite: 1, coutUnitaireCents: null }],
    }), F());
    expect(r.totaux.depenses_cents).toBe(2500);
    expect(r.manquant.find((m) => m.code === 'cout_materiel')?.noms).toEqual(['Perche']);
  });
});

describe('calculateur — période et attribution', () => {
  it('job multi-visites : seule la part des visites de la période compte', () => {
    const r = analyser(vide({
      jobs: [job(J1)],
      factures: [{ jobId: J1, netCents: 80_000, totalCents: 91_980, rembourseCents: 0 }],
      visites: ['2026-08-05', '2026-09-05', '2026-10-05', '2026-11-05'].map((jour) => ({ jobId: J1, jour, heures: 2, assigne: null, equipeId: null })),
      pointages: [
        { jobId: J1, userId: TECH_A, nom: 'Marc', jour: '2026-09-05', heures: 2 },
        { jobId: J1, userId: TECH_A, nom: 'Marc', jour: '2026-10-05', heures: 2 },
      ],
      membres: [tech(TECH_A, 'Marc Roy', 3000)],
    }), F({ du: '2026-09-01', au: '2026-09-30' }));
    expect(r.totaux.revenus_cents).toBe(20_000); // 1 visite sur 4
    expect(r.totaux.main_oeuvre_cents).toBe(6000); // les heures pointées en septembre seulement
  });

  it('par technicien : revenu au prorata des heures, main-d’œuvre = son propre coût', () => {
    const r = analyser(vide({
      jobs: [job(J1)],
      factures: [{ jobId: J1, netCents: 100_000, totalCents: 114_975, rembourseCents: 0 }],
      pointages: [
        { jobId: J1, userId: TECH_A, nom: 'Marc', jour: '2026-09-10', heures: 3 },
        { jobId: J1, userId: TECH_B, nom: 'Luc', jour: '2026-09-10', heures: 1 },
      ],
      membres: [tech(TECH_A, 'Marc Roy', 3000), tech(TECH_B, 'Luc Gagné', 5000)],
      depensesChamps: [{ jobId: J1, montantCents: 4000 }],
    }), F({ groupePar: 'technicien' }));
    const marc = r.groupes.find((g) => g.nom === 'Marc Roy')!;
    const luc = r.groupes.find((g) => g.nom === 'Luc Gagné')!;
    expect(marc).toMatchObject({ revenus_cents: 75_000, main_oeuvre_cents: 9000, depenses_cents: 3000, profit_cents: 63_000 });
    expect(luc).toMatchObject({ revenus_cents: 25_000, main_oeuvre_cents: 5000, depenses_cents: 1000, profit_cents: 19_000 });
    expect(r.totaux.profit_cents).toBe(82_000);
  });

  it('filtre technicien : seulement sa part du job', () => {
    const d = vide({
      jobs: [job(J1)],
      factures: [{ jobId: J1, netCents: 100_000, totalCents: 114_975, rembourseCents: 0 }],
      pointages: [
        { jobId: J1, userId: TECH_A, nom: 'Marc', jour: '2026-09-10', heures: 3 },
        { jobId: J1, userId: TECH_B, nom: 'Luc', jour: '2026-09-10', heures: 1 },
      ],
      membres: [tech(TECH_A, 'Marc Roy', 3000), tech(TECH_B, 'Luc Gagné', 5000)],
    });
    const r = analyser(d, F({ technicienId: TECH_B }));
    expect(r.totaux).toMatchObject({ revenus_cents: 25_000, main_oeuvre_cents: 5000 });
    expect(r.filtres_noms.technicien).toBe('Luc Gagné');
  });

  it('par service : chaque ligne porte sa part du job', () => {
    const r = analyser(vide({
      jobs: [job(J1)],
      factures: [{ jobId: J1, netCents: 100_000, totalCents: 114_975, rembourseCents: 0 }],
      lignes: [{ jobId: J1, nom: 'Vitres', totalCents: 60_000 }, { jobId: J1, nom: 'Gouttières', totalCents: 40_000 }],
      depensesChamps: [{ jobId: J1, montantCents: 10_000 }],
    }), F({ groupePar: 'service' }));
    expect(r.groupes.map((g) => [g.nom, g.revenus_cents, g.depenses_cents])).toEqual([['Vitres', 60_000, 6000], ['Gouttières', 40_000, 4000]]);
  });

  it('classement : plus et moins rentable nommés dans le résumé', () => {
    const r = analyser(vide({
      jobs: [job(J1), job(J2)],
      factures: [
        { jobId: J1, netCents: 100_000, totalCents: 114_975, rembourseCents: 0 },
        { jobId: J2, netCents: 10_000, totalCents: 11_498, rembourseCents: 0 },
      ],
      depensesChamps: [{ jobId: J1, montantCents: 20_000 }, { jobId: J2, montantCents: 15_000 }],
    }), F({ tri: 'profit_asc' }));
    expect(r.groupes[0].nom).toBe('#102 · Gouttières (Marie Tremblay)');
    expect(r.resume_fr).toContain('Plus rentable : #101 · Lavage vitres (Marie Tremblay) (profit d’au plus 800,00 $) ; moins rentable : #102 · Gouttières (Marie Tremblay) (profit d’au plus -50,00 $).');
    // Aucune main-d’œuvre saisie : chaque profit est un MAXIMUM, et c’est écrit
    expect(r.marge_est_un_maximum).toBe(true);
  });

  it('aucun job dans la période', () => {
    const r = analyser(vide({ jobs: [job(J1, { jourReference: '2025-03-01' })] }), F());
    expect(r.nb_jobs).toBe(0);
    expect(r.resume_fr).toBe('Du 1er janvier au 30 septembre 2026 : aucun job trouvé.');
  });
});

/* ── Service : permission, org de la session, dossier Dépenses lu en base ── */
describe('service — sécurité et dossier Dépenses', () => {
  beforeEach(() => {
    viderCacheRentabilite();
    role = 'owner';
    perms = {};
    tables = {
      jobs: [{ id: J1, org_id: ORG, job_number: '101', title: 'Lavage vitres', client_id: 'c1', client_name: 'Marie Tremblay', salesperson_id: null, created_by: PROPRIO, status: 'completed', subtotal_cents: 100_000, expenses_cents: 0, completed_at: '2026-09-10T15:00:00Z', created_at: '2026-09-01T12:00:00Z', deleted_at: null }],
      schedule_events: [], quotes: [], job_materials: [], job_line_items: [], payments: [],
      invoices: [{ id: 'f1', org_id: ORG, job_id: J1, status: 'paid', subtotal_cents: 100_000, discount_cents: 0, total_cents: 114_975, deleted_at: null }],
      time_entries: [{ id: 't1', org_id: ORG, job_id: J1, employee_id: TECH_A, employee_name: 'Marc', status: 'completed', punch_in_at: '2026-09-10T12:00:00Z', punch_out_at: '2026-09-10T16:00:00Z', breaks: [] }],
      team_members: [{ id: 'm1', org_id: ORG, user_id: TECH_A, first_name: 'Marc', last_name: 'Roy', hourly_rate_cents: 3000, compensation_mode: 'hourly', team_id: null }],
      fs_commission_entries: [], fs_commission_rules: [], commission_settings: [],
      custom_field_folders: [{ id: 'dos-dep', org_id: ORG, object_type: 'job', cle_systeme: 'depenses' }],
      custom_fields: [
        { id: 'cf-carburant', org_id: ORG, object_type: 'job', field_type: 'monetary', folder_id: 'dos-dep', archived_at: null },
        { id: 'cf-note', org_id: ORG, object_type: 'job', field_type: 'single_line', folder_id: 'dos-dep', archived_at: null },
      ],
      custom_field_values: [
        { id: 'v1', org_id: ORG, field_id: 'cf-carburant', job_id: J1, value_money_cents: 4500 },
        { id: 'v2', org_id: ORG, field_id: 'cf-note', job_id: J1, value_money_cents: null, value_text: '999' },
      ],
    };
  });
  const appel = (demande = {}) => analyserRentabilite({ client: fauxClient() as any, orgId: ORG, userId: PROPRIO, demande: { job_ids: [J1], ...demande } });

  it('un champ « montant » du dossier Dépenses est compté ; un champ texte ne l’est pas', async () => {
    const r = await appel();
    if (!r.ok) throw new Error('refus inattendu');
    expect(r.resultat.totaux).toMatchObject({ revenus_cents: 100_000, main_oeuvre_cents: 12_000, depenses_cents: 4500 });
  });

  it('un nouveau champ « montant » ajouté au dossier est compté sans rien changer au code', async () => {
    tables.custom_fields.push({ id: 'cf-peage', org_id: ORG, object_type: 'job', field_type: 'monetary', folder_id: 'dos-dep', archived_at: null });
    tables.custom_field_values.push({ id: 'v3', org_id: ORG, field_id: 'cf-peage', job_id: J1, value_money_cents: 1500 });
    const r = await appel();
    if (!r.ok) throw new Error('refus inattendu');
    expect(r.resultat.totaux.depenses_cents).toBe(6000);
  });

  it('un champ archivé ou hors du dossier n’est pas compté', async () => {
    tables.custom_fields.push({ id: 'cf-ailleurs', org_id: ORG, object_type: 'job', field_type: 'monetary', folder_id: 'autre', archived_at: null });
    tables.custom_field_values.push({ id: 'v4', org_id: ORG, field_id: 'cf-ailleurs', job_id: J1, value_money_cents: 77_700 });
    const r = await appel();
    if (!r.ok) throw new Error('refus inattendu');
    expect(r.resultat.totaux.depenses_cents).toBe(4500);
  });

  it('les données d’une autre entreprise ne sont jamais lues', async () => {
    tables.time_entries.push({ id: 't2', org_id: 'autre-org', job_id: J1, employee_id: TECH_A, status: 'completed', punch_in_at: '2026-09-10T12:00:00Z', punch_out_at: '2026-09-10T22:00:00Z', breaks: [] });
    const r = await appel();
    if (!r.ok) throw new Error('refus inattendu');
    expect(r.resultat.totaux.main_oeuvre_cents).toBe(12_000);
  });

  it('technicien : refusé, sans aucun chiffre', async () => {
    role = 'technician';
    perms = { 'financial.view_margins': true }; // même si on lui avait coché la case
    const r = await appel();
    expect(r).toEqual({ ok: false, refus: REFUS_PERMISSION });
    expect(REFUS_PERMISSION.fr).not.toMatch(/\d/);
    expect(REFUS_PERMISSION.en).not.toMatch(/\d/);
  });

  it('gestionnaire sans la permission des marges : refusé ; avec : servi', async () => {
    role = 'manager';
    expect((await appel()).ok).toBe(false);
    perms = { 'financial.view_margins': true };
    expect((await appel()).ok).toBe(true);
  });

  it('identifiants invalides refusés avant toute lecture', async () => {
    const r = await analyserRentabilite({ client: fauxClient() as any, orgId: ORG, userId: PROPRIO, demande: { job_ids: ["x' or 1=1"] } });
    expect(r).toEqual({ ok: false, erreur: 'job_ids : identifiant de job invalide.' });
  });
});

describe('gardes et registre', () => {
  it('analyze_profitability exige la permission des marges et est un outil financier', () => {
    expect(PERMISSION_PAR_OUTIL.analyze_profitability.cle).toBe('financial.view_margins');
    expect(OUTILS_FINANCIERS.has('analyze_profitability')).toBe(true);
    expect(PERMISSION_PAR_OUTIL).not.toHaveProperty('get_job_profitability');
  });
});

describe('routeur avant le modèle (0 token)', () => {
  const n = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  it.each([
    ['Est-ce que je suis rentable?', 'rentabilite', {}],
    ['chu tu rentable ce mois-ci', null, null],
    ['suis-je rentable cette année', 'rentabilite', { quand: 'cette annee' }],
    ['ma marge', 'rentabilite', {}],
    ['am I profitable this month', 'rentabilite', { quand: 'this month' }],
    ['rentabilité du job 42', 'rentabilite-job', { job_numbers: ['42'] }],
    ['le job #42 est-tu rentable', 'rentabilite-job', { job_numbers: ['42'] }],
    ['est-ce que le job 42 est rentable', 'rentabilite-job', { job_numbers: ['42'] }],
    ['mes jobs les moins rentables', 'rentabilite-classement', { sort: 'profit_asc' }],
    ['my most profitable jobs', 'rentabilite-classement', { sort: 'profit_desc' }],
    ['rentabilité par technicien', 'rentabilite-groupe', { group_by: 'technicien' }],
    ['profit par client cette année', 'rentabilite-groupe', { group_by: 'client', quand: 'cette annee' }],
    ['ma marge sur les jobs de Tremblay et envoie la facture', null, null],
    // Les 5 questions de la mission (phase 4)
    ['Ma job #42 était-tu rentable?', 'rentabilite-job', { job_numbers: ['42'] }],
    ['Rentabilité de mes gars ce mois-ci', 'rentabilite-groupe', { group_by: 'technicien', quand: 'ce mois ci' }],
    ['Quel rep me rapporte le plus?', 'rentabilite-classement', { group_by: 'rep', sort: 'profit_desc' }],
    ['Mon service le plus rentable?', 'rentabilite-classement', { group_by: 'service', sort: 'profit_desc' }],
    ['Marge du client Tremblay cette année', 'rentabilite-client', { group_by: 'job', quand: 'cette annee' }],
    // Variantes et pièges
    ['quel client est le moins rentable', 'rentabilite-classement', { group_by: 'client', sort: 'profit_asc' }],
    ['which service makes me the most money', 'rentabilite-classement', { group_by: 'service', sort: 'profit_desc' }],
    ['quel service je devrais vendre plus', null, null],
    ['mon client le plus fidèle', null, null],
    ['envoie la facture au client Tremblay', null, null],
  ])('%s', (phrase, id, attendu) => {
    const a = detecterRentabilite(n(phrase));
    if (id == null) { expect(a).toBeNull(); return; }
    expect(a?.id).toBe(id);
    const { quand, ...args } = (attendu ?? {}) as Record<string, unknown>;
    expect(a?.args).toMatchObject(args);
    if (quand) expect(a?.cible?.quand).toBe(quand);
    if (id === 'rentabilite-client') expect(a?.cible?.nom).toBe('tremblay');
  });

  it('les mots de période deviennent des dates dans le fuseau de l’entreprise', () => {
    const maintenant = new Date('2026-09-30T14:00:00Z');
    expect(periodeRentabilite('ce mois ci', 'America/Toronto', maintenant)).toEqual({ date_from: '2026-09-01', date_to: '2026-09-30' });
    expect(periodeRentabilite('cette annee', 'America/Toronto', maintenant)).toEqual({ date_from: '2026-01-01', date_to: '2026-09-30' });
    expect(periodeRentabilite('le mois passe', 'America/Toronto', maintenant)).toEqual({ date_from: '2026-08-01', date_to: '2026-08-31' });
    expect(periodeRentabilite(undefined, 'America/Toronto', maintenant)).toEqual({});
  });
});

describe('service — facture annulée', () => {
  beforeEach(() => {
    viderCacheRentabilite();
    role = 'owner';
    tables = {
      jobs: [{ id: J1, org_id: ORG, job_number: '101', title: 'Lavage vitres', client_id: 'c1', client_name: 'Marie Tremblay', salesperson_id: null, created_by: PROPRIO, status: 'completed', subtotal_cents: 0, expenses_cents: 1000, completed_at: '2026-09-10T15:00:00Z', created_at: '2026-09-01T12:00:00Z', deleted_at: null }],
      invoices: [
        { id: 'f-void', org_id: ORG, job_id: J1, status: 'void', subtotal_cents: 90_000, discount_cents: 0, total_cents: 103_478, deleted_at: null },
        { id: 'f-ok', org_id: ORG, job_id: J1, status: 'sent', subtotal_cents: 30_000, discount_cents: 5000, total_cents: 28_744, deleted_at: null },
        { id: 'f-brouillon', org_id: ORG, job_id: J1, status: 'draft', subtotal_cents: 70_000, discount_cents: 0, total_cents: 80_483, deleted_at: null },
      ],
      schedule_events: [], quotes: [], job_materials: [], job_line_items: [], payments: [], time_entries: [], team_members: [],
      fs_commission_entries: [], fs_commission_rules: [], commission_settings: [], custom_field_folders: [], custom_fields: [], custom_field_values: [],
    };
  });
  it('une facture annulée ou en brouillon ne compte pas ; le rabais est retiré', async () => {
    const r = await analyserRentabilite({ client: fauxClient() as any, orgId: ORG, userId: PROPRIO, demande: { job_ids: [J1] } });
    if (!r.ok) throw new Error('refus inattendu');
    expect(r.resultat.totaux.revenus_cents).toBe(25_000);
  });
});

describe('dossier Dépenses — écran et migration', async () => {
  const { nomDossier, dossierRenommable, CLE_DOSSIER_DEPENSES } = await import('../src/lib/champs/standard');
  const { readFileSync } = await import('node:fs');
  const mig = readFileSync('supabase/migrations/20261003470000_dossier_depenses.sql', 'utf8');
  const backfill = readFileSync('supabase/migrations/20261003470001_dossier_depenses_backfill.sql', 'utf8');

  it('traduit tant qu’il garde son nom d’origine ; renommé, le nom de l’entreprise', () => {
    const d = { object_type: 'job' as const, cle_systeme: CLE_DOSSIER_DEPENSES };
    expect(nomDossier({ ...d, name: 'Dépenses' }, false)).toBe('Expenses');
    expect(nomDossier({ ...d, name: 'Expenses' }, true)).toBe('Dépenses');
    expect(nomDossier({ ...d, name: 'Frais de chantier' }, false)).toBe('Frais de chantier');
  });
  it('renommable ; les sections du formulaire, non', () => {
    expect(dossierRenommable({ cle_systeme: 'depenses' })).toBe(true);
    expect(dossierRenommable({ cle_systeme: 'notes' })).toBe(false);
    expect(dossierRenommable({ cle_systeme: null })).toBe(true);
  });
  it('les 10 champs de base, type montant, clés stables', () => {
    const cles = [...mig.matchAll(/\('(depense_[a-z_]+)',/g)].map((m) => m[1]);
    expect(cles).toEqual(['depense_carburant', 'depense_materiaux', 'depense_consommables', 'depense_location', 'depense_outils',
      'depense_sous_traitance', 'depense_deplacement', 'depense_elimination', 'depense_permis', 'depense_autres']);
    expect(mig).toContain("'monetary'");
  });
  it('garde : le dossier Dépenses se renomme, ne se supprime pas ; les sections gardent leur nom', () => {
    expect(mig).toMatch(/old\.cle_systeme <> 'depenses' and new\.name is distinct from old\.name/);
    expect(mig).toContain('Un dossier système ne se supprime pas');
  });
  it('fonctions fermées à anon (et à authenticated pour celle qui écrit)', () => {
    expect(mig).toContain('revoke all on function public.cf_assurer_dossier_depenses(uuid) from public, anon, authenticated;');
    expect(mig).toContain('revoke all on function public.cf_depenses_champs_base() from public, anon;');
  });
  it('le backfill ne détruit rien et ne double pas une valeur existante', () => {
    expect(backfill).not.toMatch(/update public\.jobs|delete from/i);
    expect(backfill).toContain('not exists (select 1 from public.custom_field_values v where v.field_id = f.id and v.job_id = j.id)');
  });
});

describe('payload du modèle (phase 4)', async () => {
  const { pourAgent } = await import('../server/lib/rentabilite');
  it('par défaut : groupes réduits, pas d’action en double, résumé intact', () => {
    const r = analyser(vide({
      jobs: [job(J1)],
      factures: [{ jobId: J1, netCents: 100_000, totalCents: 114_975, rembourseCents: 0 }],
      pointages: [{ jobId: J1, userId: TECH_A, nom: 'Marc', jour: '2026-09-10', heures: 2 }],
      membres: [tech(TECH_A, 'Marc Roy', null)],
    }), F());
    const p = pourAgent(r) as any;
    expect(Object.keys(p.groupes[0]).sort()).toEqual(['completude', 'marge_est_un_maximum', 'marge_pct', 'nom', 'profit_cents', 'revenus_cents']);
    for (const k of ['action', 'periode', 'filtres_noms', 'inclus']) expect(p).not.toHaveProperty(k);
    expect(p.resume_fr).toBe(r.resume_fr);
    expect(p.manquant).toEqual(r.manquant);
    expect(JSON.stringify(p).length).toBeLessThan(JSON.stringify(r).length);
  });
});
