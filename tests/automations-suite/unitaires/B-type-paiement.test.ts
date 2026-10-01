/**
 * B — `payment_type` des événements `invoice.paid` : le vocabulaire commun aux
 * trois émetteurs (Stripe/PayPal, « Marquer payée », dépôt de soumission).
 * Unitaire pur.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { typePaiement } from '../../../server/lib/type-paiement';
import { AUTOMATION_PRESETS } from '../../../server/lib/automationPresets.data';

describe('B-591 — payment_type', () => {
  it('[B-591] dépôt → deposit ; facture soldée → full ; sinon → partial', () => {
    expect(typePaiement({ depot: true, soldee: false })).toBe('deposit');
    expect(typePaiement({ depot: true, soldee: true })).toBe('deposit');
    expect(typePaiement({ soldee: true })).toBe('full');
    expect(typePaiement({ soldee: false })).toBe('partial');
  });

  it('[B-591] les préréglages n’ont pas bougé : payment_confirmation = « pas un dépôt », deposit_received = « dépôt »', () => {
    const par = (cle: string) => AUTOMATION_PRESETS.find((p) => p.preset_key === cle)?.conditions;
    expect(par('payment_confirmation')).toEqual({ payment_type: { neq: 'deposit' } });
    expect(par('deposit_received')).toEqual({ payment_type: 'deposit' });
  });

  it('[B-591] chaque émetteur de invoice.paid pose payment_type par typePaiement (aucune valeur écrite à la main)', () => {
    for (const fichier of ['server/lib/payments.ts', 'server/routes/invoice-mark-paid.ts', 'server/routes/payments.ts']) {
      const source = readFileSync(resolve(__dirname, '../../..', fichier), 'utf8');
      const emissions = source.split("emit('invoice.paid'").slice(1).map((bloc) => bloc.slice(0, 900));
      expect(emissions.length, `${fichier} n'émet plus invoice.paid ?`).toBeGreaterThan(0);
      for (const bloc of emissions) expect(bloc, fichier).toMatch(/payment_type: typePaiement\(/);
    }
  });
});
