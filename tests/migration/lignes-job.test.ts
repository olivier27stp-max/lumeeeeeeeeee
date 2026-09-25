// Lignes de services des jobs importés + nom du client sur le job (Vision Lavage, 2026-09-24 :
// 896 jobs sans lignes, 220 jobs dont la colonne Client était un courriel).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { nomsServices, lignesPourJob, LIBELLE_MONTANT_IMPORTE } from '../../server/lib/migration/lignes-facture';
import { nomAffichageClient, nomClientPourJob, type BuildContext } from '../../server/lib/migration/importer';

const lu = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('nomsServices', () => {
  it('lit la liste de l\'export Jobs (noms seuls) et celle de l\'export Visits (« Nom (qté) »)', () => {
    expect(nomsServices('Nettoyage des fenêtres extérieures, Nettoyage des fenêtres intérieures')).toEqual(['Nettoyage des fenêtres extérieures', 'Nettoyage des fenêtres intérieures']);
    expect(nomsServices('Nettoyage des fenêtres extérieures (1), Nettoyage de revêtement (2)')).toEqual(['Nettoyage des fenêtres extérieures', 'Nettoyage de revêtement']);
    expect(nomsServices('Lavage à pression (1, $440.00)')).toEqual(['Lavage à pression']);
    expect(nomsServices('')).toEqual([]);
  });
});

describe('lignesPourJob', () => {
  it('sans montants : UNE ligne nommée par la liste des services, au sous-total — rien d\'inventé', () => {
    expect(lignesPourJob('Nettoyage des fenêtres extérieures, Nettoyage des fenêtres intérieures', 33000)).toEqual([
      { description: 'Nettoyage des fenêtres extérieures, Nettoyage des fenêtres intérieures', qty: 1, unit_price_cents: 33000 },
    ]);
    expect(lignesPourJob("Nettoyage d'entrée de cour", 23000)).toEqual([{ description: "Nettoyage d'entrée de cour", qty: 1, unit_price_cents: 23000 }]);
  });
  it('avec montants qui somment au sous-total : lignes réelles (même règle que les factures)', () => {
    expect(lignesPourJob('Nettoyage des fenêtres extérieures (1, $440.00), Nettoyage de revêtement (2, $600.00)', 104000)).toEqual([
      { description: 'Nettoyage des fenêtres extérieures', qty: 1, unit_price_cents: 44000 },
      { description: 'Nettoyage de revêtement', qty: 2, unit_price_cents: 30000 },
    ]);
  });
  it('avec montants qui ne somment PAS au sous-total : une ligne nommée au sous-total, jamais les montants faux', () => {
    expect(lignesPourJob('A (1, $100.00), B (1, $100.00)', 25000)).toEqual([{ description: 'A, B', qty: 1, unit_price_cents: 25000 }]);
  });
  it('sans texte : « Montant importé » si sous-total > 0, sinon rien', () => {
    expect(lignesPourJob('', 5000)).toEqual([{ description: LIBELLE_MONTANT_IMPORTE, qty: 1, unit_price_cents: 5000 }]);
    expect(lignesPourJob('', 0)).toEqual([]);
  });
  it('un service connu à 0 $ garde son nom (pas de « Montant importé » qui cacherait le service)', () => {
    expect(lignesPourJob('Frais de déplacement', 0)).toEqual([{ description: 'Frais de déplacement', qty: 1, unit_price_cents: 0 }]);
  });
});

describe('nom du client sur le job', () => {
  const ctx = (noms: Array<[string, string]>): BuildContext => ({
    migration: { org_id: 'o' } as any, createdBy: 'u', clientIdByRef: new Map(), propertyIdByRef: new Map(), jobIdByRef: new Map(), clientNameById: new Map(noms),
  });
  it('la fiche client fait foi : « Prénom Nom », sinon entreprise', () => {
    expect(nomAffichageClient({ first_name: 'Simon', last_name: 'Boisvert', company: 'Gestion Boisvert 2024 inc.' })).toBe('Simon Boisvert');
    expect(nomAffichageClient({ first_name: '', last_name: '', company: 'Gestion Boisvert 2024 inc.' })).toBe('Gestion Boisvert 2024 inc.');
    expect(nomClientPourJob(ctx([['c1', 'Simon Boisvert']]), 'c1', { client_email_ref: 'info@gestion-isr.com' })).toBe('Simon Boisvert');
  });
  it('sans fiche connue : la référence source, mais JAMAIS un courriel', () => {
    expect(nomClientPourJob(ctx([]), 'c9', { client_email_ref: 'info@gestion-isr.com', client_name_ref: 'Simon Boisvert' })).toBe('Simon Boisvert');
    expect(nomClientPourJob(ctx([]), 'c9', { client_ref: 'michel-poulin@cgocable.ca' })).toBeNull();
  });
});

describe('câblage dans l\'importeur', () => {
  it('les jobs importés reçoivent leurs lignes, puis les factures les raffinent ; les clients existants et importés donnent leur nom', () => {
    const src = lu('server/lib/migration/importer.ts');
    expect(src).toContain("if (entity === 'job' && importedIds.length > 0)");
    expect(src).toContain('creerLignesJobsImportees(admin, migration.org_id, ctx.createdBy,');
    expect(src).toContain('raffinerLignesJobsDepuisFactures(admin, migration.org_id, ctx.createdBy,');
    expect(src).toContain('client_name: nomClientPourJob(ctx, clientId, r)');
    expect(src.match(/retenirNomClient\(ctx, /g)?.length ?? 0).toBeGreaterThanOrEqual(3); // seed existants + dry-run + final
  });
  it('le SQL de rattrapage suit la même règle (copie de la facture si somme exacte, sinon liste des services au sous-total)', () => {
    const sql = lu('supabase/migrations/20260926130000_jobs_importes_lignes_et_nom_client.sql');
    expect(sql).toContain("having sum(round(f.qty * f.unit_price_cents)) = src.subtotal_cents");
    expect(sql).toContain("bool_and(f.description <> 'Montant importé')");
    expect(sql).toContain("insert into public.job_line_items (org_id, job_id, name, qty, unit_price_cents, total_cents, included, created_by, created_at)");
    expect(sql).toContain("j.client_name ~ '@'");
  });
});
