/**
 * Launch 2026-09-28 — `[invoice_link]` mène à la facture.
 *
 * La variable lisait `public_token` (toujours vide) : les relances de
 * facture du pack partaient sans lien. La page publique cherche la facture
 * par `view_token` : c'est ce jeton que le lien doit porter.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveEntityVariables } from '../../server/lib/actions/index';
import { clientEnregistreur } from './filet-regression/_enregistreur';
import { monde, ORG, IDS } from './filet-regression/_banc';

process.env.PUBLIC_URL = process.env.PUBLIC_URL || 'https://app.lume.test';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'https://app.lume.test';

describe('[invoice_link]', () => {
  it('porte le view_token de la facture (celui que la page publique lit)', async () => {
    const { client } = clientEnregistreur(monde({ id: 'x', trigger_event: 'invoice.sent' }));
    const vars = await resolveEntityVariables(client as any, ORG, 'invoice', IDS.facture);
    expect(vars.invoice_link).toMatch(/\/invoice\/bbbbbbbb-0000-4000-8000-000000000002$/);
  });

  it('la page publique ouvre bien une facture par ce jeton', () => {
    const route = readFileSync('server/routes/invoices-public.ts', 'utf8');
    const bloc = route.slice(route.indexOf("router.get('/invoices/public/:token'"));
    expect(bloc.slice(0, 1500)).toMatch(/\.eq\('view_token', token\)/);
  });
});
