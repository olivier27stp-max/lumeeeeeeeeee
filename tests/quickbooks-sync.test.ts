import { describe, expect, it } from 'vitest';
import { isMissingSchema, methodKeyOf } from '../server/lib/quickbooks/sync';

describe('methodKeyOf — moyen de paiement Lume → QuickBooks', () => {
  it('reconnaît les moyens manuels du modal « Marquer payée »', () => {
    expect(methodKeyOf('card', 'manual')).toBe('card');
    expect(methodKeyOf('e-transfer', 'manual')).toBe('e-transfer');
    expect(methodKeyOf('cash', 'manual')).toBe('cash');
    expect(methodKeyOf('check', 'manual')).toBe('check');
  });

  it('reconnaît les libellés importés en français', () => {
    expect(methodKeyOf('Virement Interac', null)).toBe('e-transfer');
    expect(methodKeyOf('Comptant', null)).toBe('cash');
    expect(methodKeyOf('Chèque', null)).toBe('check');
    expect(methodKeyOf('Carte de crédit', null)).toBe('card');
  });

  it('paiements en ligne : Stripe sans méthode = carte, PayPal = PayPal', () => {
    expect(methodKeyOf(null, 'stripe')).toBe('card');
    expect(methodKeyOf('us_bank_account', 'stripe')).toBe('bank');
    expect(methodKeyOf(null, 'paypal')).toBe('paypal');
  });

  it('inconnu → aucun moyen imposé', () => {
    expect(methodKeyOf(null, 'manual')).toBeNull();
    expect(methodKeyOf('autre', null)).toBeNull();
  });
});

describe('isMissingSchema', () => {
  it('migration non appliquée', () => {
    expect(isMissingSchema({ code: 'PGRST202', message: 'Could not find the function' })).toBe(true);
    expect(isMissingSchema({ code: '42P01', message: 'relation does not exist' })).toBe(true);
  });
  it('autre erreur', () => {
    expect(isMissingSchema({ code: '23505', message: 'duplicate key' })).toBe(false);
    expect(isMissingSchema(null)).toBe(false);
  });
});
