/**
 * LA PAIE — les heures et le salaire de vrais employes.
 *
 * `server/routes/payroll.ts` (458 lignes) n avait aucun test. C est de
 * l argent verse a des personnes : une heure mal comptee, c est quelqu un
 * qui est paye en moins — ou l entreprise qui paie en trop.
 *
 * Particularite de ce fichier : `computeEntryHours()` et `sumEntryHours()`
 * sont EXPORTEES par `server/lib/payroll.ts`. On teste donc le VRAI code,
 * pas une reproduction. Si quelqu un change la formule, ces tests le voient
 * immediatement — contrairement a un test qui recopierait la regle.
 *
 * Seule la formule du salaire est reproduite ici, parce qu elle vit dans la
 * route et non dans une fonction exportable :
 *
 *     rate  = hourly_rate_cents  OU  round(labour_cost_hourly * 100)  OU  0
 *     gross = round(heures * rate)
 *     total = gross + commissions + ajustements
 *
 * CE QUI EST PROTEGE
 *   - un pointage non termine ne paie RIEN (personne n est paye a l infini)
 *   - une sortie avant l entree ne paie rien (donnee incoherente)
 *   - les pauses fermees sont deduites, les pauses ouvertes ignorees
 *   - les ajustements negatifs (avance, retenue) fonctionnent
 *   - une commission annulee ne se paie pas
 */

import { describe, it, expect } from 'vitest';
import { computeEntryHours, sumEntryHours } from '../server/lib/payroll';

const h = (jour: string, heure: string) => `2026-09-0${jour}T${heure}:00.000Z`;

/* === LES HEURES POINTEES (vrai code) ============================ */

describe('les heures d un pointage', () => {
  it('compte les heures entre l entree et la sortie', () => {
    expect(computeEntryHours({
      punch_in_at: h('1', '08:00'), punch_out_at: h('1', '16:00'), breaks: null,
    })).toBe(8);
  });

  it('un pointage NON TERMINE ne paie rien', () => {
    // Le garde le plus important : un employe qui oublie de pointer sa
    // sortie ne doit pas accumuler des heures jusqu a la fin des temps.
    expect(computeEntryHours({
      punch_in_at: h('1', '08:00'), punch_out_at: null, breaks: null,
    })).toBe(0);
  });

  it('un pointage sans entree ne paie rien', () => {
    expect(computeEntryHours({
      punch_in_at: null, punch_out_at: h('1', '16:00'), breaks: null,
    })).toBe(0);
  });

  it('une sortie AVANT l entree ne paie rien', () => {
    // Donnee incoherente : sans ce garde, la duree serait negative et
    // viendrait REDUIRE le total des autres journees.
    expect(computeEntryHours({
      punch_in_at: h('1', '16:00'), punch_out_at: h('1', '08:00'), breaks: null,
    })).toBe(0);
  });

  it('une entree et une sortie identiques ne paient rien', () => {
    expect(computeEntryHours({
      punch_in_at: h('1', '08:00'), punch_out_at: h('1', '08:00'), breaks: null,
    })).toBe(0);
  });

  it('une date illisible ne paie rien', () => {
    expect(computeEntryHours({
      punch_in_at: 'pas-une-date', punch_out_at: h('1', '16:00'), breaks: null,
    })).toBe(0);
  });

  it('une pause fermee est deduite', () => {
    // 8 h de presence moins 1 h de diner = 7 h payees.
    expect(computeEntryHours({
      punch_in_at: h('1', '08:00'), punch_out_at: h('1', '16:00'),
      breaks: [{ start: h('1', '12:00'), end: h('1', '13:00') }],
    })).toBe(7);
  });

  it('plusieurs pauses se cumulent', () => {
    expect(computeEntryHours({
      punch_in_at: h('1', '08:00'), punch_out_at: h('1', '16:00'),
      breaks: [
        { start: h('1', '10:00'), end: h('1', '10:15') },
        { start: h('1', '12:00'), end: h('1', '13:00') },
      ],
    })).toBe(6.75);  // 8 h - 15 min - 1 h
  });

  it('une pause NON TERMINEE est ignoree, pas devinee', () => {
    // Une pause ouverte n a pas de duree connue. La deviner reviendrait a
    // retirer des heures que l employe a peut-etre travaillees.
    expect(computeEntryHours({
      punch_in_at: h('1', '08:00'), punch_out_at: h('1', '16:00'),
      breaks: [{ start: h('1', '12:00') }],
    })).toBe(8);
  });

  it('une pause plus longue que la journee ne rend pas le total negatif', () => {
    expect(computeEntryHours({
      punch_in_at: h('1', '08:00'), punch_out_at: h('1', '09:00'),
      breaks: [{ start: h('1', '08:00'), end: h('1', '16:00') }],
    })).toBe(0);
  });

  it('une demi-heure est comptee comme 0,5 h', () => {
    expect(computeEntryHours({
      punch_in_at: h('1', '08:00'), punch_out_at: h('1', '08:30'), breaks: null,
    })).toBe(0.5);
  });
});

describe('le total des heures d une periode', () => {
  it('additionne les journees', () => {
    expect(sumEntryHours([
      { punch_in_at: h('1', '08:00'), punch_out_at: h('1', '16:00'), breaks: null },
      { punch_in_at: h('2', '08:00'), punch_out_at: h('2', '12:00'), breaks: null },
    ])).toBe(12);
  });

  it('aucun pointage donne zero, pas NaN', () => {
    expect(sumEntryHours([])).toBe(0);
  });

  it('les pointages ouverts n ajoutent rien au total', () => {
    expect(sumEntryHours([
      { punch_in_at: h('1', '08:00'), punch_out_at: h('1', '16:00'), breaks: null },
      { punch_in_at: h('2', '08:00'), punch_out_at: null, breaks: null },
    ])).toBe(8);
  });

  it('le total est arrondi a deux decimales', () => {
    // 20 minutes = 0,3333... h. Sans arrondi, le total trainerait des
    // decimales sans fin jusque dans le salaire.
    const t = sumEntryHours([
      { punch_in_at: h('1', '08:00'), punch_out_at: h('1', '08:20'), breaks: null },
    ]);
    expect(t).toBe(0.33);
  });
});

/* === LE SALAIRE ================================================= */

/** Reproduction de la formule de `GET /payroll` (dans la route). */
function calculerLaPaie(params: {
  heures: number;
  hourly_rate_cents?: number | null;
  labour_cost_hourly?: number | null;
  commissions?: { amount: number; status?: string }[];
  ajustementsCents?: number[];
}) {
  const rateCents =
    Number(params.hourly_rate_cents)
    || Math.round(Number(params.labour_cost_hourly || 0) * 100)
    || 0;
  const grossCents = Math.round(params.heures * rateCents);
  const retenues = (params.commissions || []).filter((c) => c.status !== 'reversed');
  const commissionCents = Math.round(retenues.reduce((s, c) => s + Number(c.amount || 0), 0) * 100);
  const adjustmentsCents = (params.ajustementsCents || []).reduce((s, a) => s + a, 0);
  return {
    rateCents,
    grossCents,
    commissionCents,
    adjustmentsCents,
    totalCents: grossCents + commissionCents + adjustmentsCents,
  };
}

describe('le salaire d un employe', () => {
  it('heures x taux horaire', () => {
    // 8 h a 25,00 $ = 200,00 $
    expect(calculerLaPaie({ heures: 8, hourly_rate_cents: 2500 }).grossCents).toBe(20000);
  });

  it('le taux des Membres a la priorite sur le cout de main-d oeuvre', () => {
    const r = calculerLaPaie({ heures: 10, hourly_rate_cents: 3000, labour_cost_hourly: 20 });
    expect(r.rateCents).toBe(3000);
  });

  it('sans taux aux Membres, on retombe sur le cout de main-d oeuvre', () => {
    // `labour_cost_hourly` est en DOLLARS : 22,50 $ devient 2250 cents.
    const r = calculerLaPaie({ heures: 4, hourly_rate_cents: null, labour_cost_hourly: 22.5 });
    expect(r.rateCents).toBe(2250);
    expect(r.grossCents).toBe(9000);
  });

  it('sans aucun taux, le brut est zero — pas NaN', () => {
    const r = calculerLaPaie({ heures: 8, hourly_rate_cents: null, labour_cost_hourly: null });
    expect(r.rateCents).toBe(0);
    expect(r.grossCents).toBe(0);
    expect(Number.isNaN(r.totalCents)).toBe(false);
  });

  it('les heures fractionnaires sont arrondies au cent', () => {
    // 7,33 h a 23,17 $ = 169,8361 $ -> 169,84 $
    expect(calculerLaPaie({ heures: 7.33, hourly_rate_cents: 2317 }).grossCents).toBe(16984);
  });

  it('les commissions s ajoutent au brut', () => {
    const r = calculerLaPaie({
      heures: 8, hourly_rate_cents: 2500,
      commissions: [{ amount: 150.5 }, { amount: 49.5 }],
    });
    expect(r.commissionCents).toBe(20000);
    expect(r.totalCents).toBe(40000);
  });

  it('une commission ANNULEE ne se paie pas', () => {
    // `status !== 'reversed'` : une commission reprise ne doit pas rester
    // sur la paie de l employe.
    const r = calculerLaPaie({
      heures: 0, hourly_rate_cents: 2500,
      commissions: [{ amount: 100 }, { amount: 200, status: 'reversed' }],
    });
    expect(r.commissionCents).toBe(10000);
  });

  it('un ajustement negatif (avance, retenue) reduit le total', () => {
    const r = calculerLaPaie({ heures: 8, hourly_rate_cents: 2500, ajustementsCents: [-5000] });
    expect(r.totalCents).toBe(15000);
  });

  it('plusieurs ajustements se cumulent', () => {
    const r = calculerLaPaie({
      heures: 8, hourly_rate_cents: 2500, ajustementsCents: [-5000, 2500, -1000],
    });
    expect(r.adjustmentsCents).toBe(-3500);
    expect(r.totalCents).toBe(16500);
  });

  it('une paie complete tombe juste', () => {
    // 37,5 h a 24,00 $ = 900,00 $ + 125,00 $ de commission - 50,00 $ d avance
    const r = calculerLaPaie({
      heures: 37.5, hourly_rate_cents: 2400,
      commissions: [{ amount: 125 }],
      ajustementsCents: [-5000],
    });
    expect(r.grossCents).toBe(90000);
    expect(r.commissionCents).toBe(12500);
    expect(r.totalCents).toBe(97500);
  });

  it('une semaine sans heures ni commission donne zero', () => {
    expect(calculerLaPaie({ heures: 0, hourly_rate_cents: 2500 }).totalCents).toBe(0);
  });
});
