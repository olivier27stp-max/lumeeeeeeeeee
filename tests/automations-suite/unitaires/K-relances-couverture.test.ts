/**
 * K — Une facture = UNE source de relances : le cron des rappels de paiement
 * se tait quand une automatisation « Facture en retard » publiée couvre la
 * facture (`couvertureAutomatisations`, server/routes/reminders-cron.ts).
 *
 * Unitaire : la base est un faux client qui rend les règles données ; le
 * jugement des conditions est celui du VRAI moteur (`evaluateConditions`).
 */
import { describe, it, expect } from 'vitest';
import { couvertureAutomatisations } from '../../../server/routes/reminders-cron';

type Regle = { id: string; trigger_event: string; preset_key: string | null; conditions: Record<string, unknown> | null };

function base(regles: Regle[], taches: Array<{ id: string }> = []) {
  const requete = (rendu: unknown) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'in', 'limit']) q[m] = () => q;
    (q as { then: unknown }).then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rendu, error: null }).then(res);
    return q;
  };
  return { from: (table: string) => requete(table === 'automation_rules' ? regles : taches) };
}

const AUJOURDHUI = '2026-10-31';
const facture = (echeance: string) => ({ id: 'facture-1', status: 'sent', total_cents: 50_000, balance_cents: 50_000, invoice_number: 'F-001', client_id: 'client-1', due_date: echeance });
const enRetard = (conditions: Record<string, unknown>): Regle => ({ id: 'regle-1', trigger_event: 'invoice.overdue', preset_key: null, conditions });

describe('K-026 / K-027 — couverture d’une facture par une automatisation « Facture en retard »', () => {
  it('[K-026] règle sans condition : toute facture en retard est couverte (le cron ne relance pas)', async () => {
    const couverte = await couvertureAutomatisations(base([enRetard({})]), 'org-1', AUJOURDHUI);
    expect(await couverte(facture('2026-10-28'))).toBe(true);
  });

  it('[K-026] aucune automatisation de relance : rien n’est couvert (le cron relance comme avant)', async () => {
    const couverte = await couvertureAutomatisations(base([]), 'org-1', AUJOURDHUI);
    expect(await couverte(facture('2026-10-01'))).toBe(false);
  });

  it('[K-027] règle « en retard d’au moins 3 jours » : couverte à 30 jours de retard, pas encore à 1 jour', async () => {
    const couverte = await couvertureAutomatisations(base([enRetard({ days_overdue__gte: 3 })]), 'org-1', AUJOURDHUI);
    expect(await couverte(facture('2026-10-01')), '30 jours de retard : l’automatisation la relance, le cron doit se taire').toBe(true);
    expect(await couverte(facture('2026-10-30')), '1 jour de retard : la règle ne s’applique pas encore').toBe(false);
  });

  it('[K-027] règle « exactement 30 jours de retard » : couverte le 30e jour seulement (plus de doublon ce jour-là)', async () => {
    const couverte = await couvertureAutomatisations(base([enRetard({ days_overdue: 30 })]), 'org-1', AUJOURDHUI);
    expect(await couverte(facture('2026-10-01'))).toBe(true);
    expect(await couverte(facture('2026-10-24'))).toBe(false);
  });

  it('[K-027] une condition sur l’échéance (`due_date`) est jugée elle aussi', async () => {
    const couverte = await couvertureAutomatisations(base([enRetard({ due_date__lt: '2026-10-15' })]), 'org-1', AUJOURDHUI);
    expect(await couverte(facture('2026-10-01'))).toBe(true);
    expect(await couverte(facture('2026-10-20'))).toBe(false);
  });
});
