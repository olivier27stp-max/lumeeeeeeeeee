// Préfixe de numéro par bureau (Q1 du plan multi-bureaux) : CL-1042 / VL-1042.
// Preuve en conditions réelles : e2e PostgREST staging 11/11.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const sql = lire('supabase/migrations/20260927220000_prefixe_documents_par_bureau.sql');

describe('préfixe des numéros par bureau', () => {
  it('lettres majuscules seulement : la numérotation lit les chiffres du numéro', () => {
    expect(sql).toMatch(/prefixe_documents ~ '\^\[A-Z\]\{1,5\}\$'/);
  });
  it('un trigger par table, après la numérotation, seulement sur un numéro 100 % chiffres', () => {
    expect(sql).toMatch(/create trigger trg_invoices_zz_prefixe\s+before insert or update of invoice_number on public\.invoices/);
    expect(sql).toMatch(/create trigger trg_quotes_zz_prefixe\s+before insert or update of quote_number on public\.quotes/);
    expect(sql.split("_number !~ '^\\d+$' then return new").length - 1).toBe(2);
  });
  it('les doublons de soumission comparent les chiffres ; les RPC renvoient le numéro stocké', () => {
    expect(sql).not.toMatch(/btrim\(q\.quote_number\) = v_wanted::text/);
    expect(sql).toMatch(/returning id, quote_number into v_quote_id, v_quote_number/);
    expect(sql.match(/returning (quote_number|invoice_number) into v_stored/g)?.length).toBe(2);
  });
  it('le réglage est dans Paramètres entreprise, validé comme en base', () => {
    const page = lire('src/pages/CompanySettings.tsx');
    expect(page).toMatch(/prefixe_documents: prefixe \|\| null/);
    expect(page).toMatch(/\^\[A-Z\]\{1,5\}\$/);
  });
});
