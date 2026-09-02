import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Un technicien ne doit voir aucun montant.
 *
 * Trouvé le 2026-09-01 en ouvrant une vraie session sous ce rôle : la base
 * livrait directement les montants — 1 626,90 $, 1 415 $, 425 $ — sur les
 * factures ET les jobs.
 *
 * Le masquage existait, mais uniquement dans l'application. Les politiques de
 * lecture ne filtraient que par ORGANISATION, jamais par rôle : un technicien
 * interrogeant la base depuis les outils de son navigateur contournait tout.
 *
 * Risque au moment de la correction : nul en production (33 owner, 6 sales_rep,
 * 1 admin, aucun technicien). Il se serait manifesté au premier technicien
 * embauché — et la correction aurait alors été plus risquée.
 */

const RACINE = process.cwd();
const lire = (p: string) => fs.readFileSync(path.join(RACINE, p), 'utf8');
const MIGRATION = 'supabase/migrations/20260901210000_technicien_sans_montants.sql';

describe('les politiques excluent le technicien', () => {
  const sql = lire(MIGRATION);

  it('les factures lui sont refusées', () => {
    const bloc = sql.slice(sql.indexOf('create policy invoices_select_org'));
    const fin = bloc.slice(0, bloc.indexOf(');'));
    expect(fin).toContain("coalesce(m.role, '') <> 'technician'");
  });

  it('les devis lui sont refusés', () => {
    const bloc = sql.slice(sql.indexOf('create policy quotes_select'));
    const fin = bloc.slice(0, bloc.indexOf(');'));
    expect(fin).toContain("coalesce(m.role, '') <> 'technician'");
  });

  it('seule la LECTURE des devis change', () => {
    // Toucher insert/update/delete priverait un technicien de gestes légitimes.
    expect(sql).toContain('drop policy if exists quotes_select on public.quotes');
    expect(sql).not.toContain('drop policy if exists quotes_update');
    expect(sql).not.toContain('drop policy if exists quotes_insert');
  });

  it('la politique exige une adhésion ACTIVE', () => {
    expect(sql).toMatch(/m\.status = 'active'/);
  });
});

describe('la vue masque les montants des jobs', () => {
  const sql = lire(MIGRATION);

  it('elle existe et s\'exécute avec les droits de l\'appelant', () => {
    // `security_invoker` : sans lui, la vue contournerait les politiques de
    // `jobs` et exposerait les lignes d'autres organisations.
    expect(sql).toContain('create or replace view public.jobs_pour_role');
    expect(sql).toContain('security_invoker = true');
  });

  it('les huit colonnes d\'argent sont masquées', () => {
    for (const col of ['total_cents', 'subtotal_cents', 'tax_cents', 'total',
                       'subtotal', 'total_amount', 'tax_total', 'deposit_cents']) {
      expect(sql).toContain(`then j."${col}" end as "${col}"`);
    }
  });

  it('seuls les rôles à permission financière voient les montants', () => {
    expect(sql).toContain("array['owner','admin','sales_rep']");
  });

  it('la migration échoue si la vue ou une politique disparaît', () => {
    expect(sql).toContain('La vue jobs_pour_role est absente');
    expect(sql).toContain('La politique quotes_select a disparu');
  });
});

describe('le préréglage du technicien reste sans permission financière', () => {
  it('permissions.ts ne lui accorde ni quotes.read ni invoices.read', () => {
    const src = lire('src/lib/permissions.ts');
    const bloc = src.slice(src.indexOf('technician: pick(['));
    const fin = bloc.slice(0, bloc.indexOf(']),'));
    expect(fin).not.toContain("'quotes.read'");
    expect(fin).not.toContain("'invoices.read'");
    expect(fin).toContain("'jobs.read'"); // il garde ses jobs
  });
});
