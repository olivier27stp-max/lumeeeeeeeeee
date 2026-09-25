/**
 * Lignes des factures importées (server/lib/migration/lignes-facture.ts).
 * Cas tirés de l'export Jobber réel de Vision Lavage (645 factures, 1 104
 * lignes, somme = sous-total au cent près pour les 645).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  lireLignesExport, lignesPourFacture, texteLignes, creerLignesImportees, LIBELLE_MONTANT_IMPORTE,
} from '../../server/lib/migration/lignes-facture';
import { suggestMappings } from '../../server/lib/migration/mapping';

describe('lireLignesExport (format Jobber)', () => {
  it('« Nom (qté, $total de la ligne) » séparés par des virgules', () => {
    expect(lireLignesExport('Nettoyage des fenêtres extérieures (1, $240.00), Nettoyage des fenêtres intérieures (1, $200.00), Nettoyage de revêtement (1, $450.00)'))
      .toEqual([
        { nom: 'Nettoyage des fenêtres extérieures', qte: 1, totalCents: 24000 },
        { nom: 'Nettoyage des fenêtres intérieures', qte: 1, totalCents: 20000 },
        { nom: 'Nettoyage de revêtement', qte: 1, totalCents: 45000 },
      ]);
  });

  it('le montant est le TOTAL de la ligne, pas le prix unitaire', () => {
    const l = lireLignesExport('Nettoyage des fenêtres extérieures (3, $420.00), Entretien de gouttières (1, $235.00)')!;
    expect(l[0]).toEqual({ nom: 'Nettoyage des fenêtres extérieures', qte: 3, totalCents: 42000 });
  });

  it('parenthèses et virgules dans le nom, milliers avec virgule', () => {
    expect(lireLignesExport('Nettoyage des fenêtres extérieures(Forfait saisonnier) (1, $320.00)')![0].nom).toBe('Nettoyage des fenêtres extérieures(Forfait saisonnier)');
    expect(lireLignesExport('Nettoyage des fascias (devant) (1, $50.00)')![0].nom).toBe('Nettoyage des fascias (devant)');
    expect(lireLignesExport('Toiture, bardeaux (1, $1,250.00)')).toEqual([{ nom: 'Toiture, bardeaux', qte: 1, totalCents: 125000 }]);
  });

  it('texte qui ne suit pas le format d’un bout à l’autre → null', () => {
    expect(lireLignesExport('')).toBeNull();
    expect(lireLignesExport('Lavage de vitres')).toBeNull();
    expect(lireLignesExport('Lavage (1, $10.00) et autre chose')).toBeNull();
    expect(lireLignesExport('Crédit (1, $-10.00)')).toBeNull();
  });
});

describe('lignesPourFacture', () => {
  it('somme exacte → les lignes lues, prix unitaire = total ÷ qté', () => {
    expect(lignesPourFacture('Fenêtres (3, $420.00), Gouttières (1, $235.00)', 65500)).toEqual([
      { description: 'Fenêtres', qty: 3, unit_price_cents: 14000 },
      { description: 'Gouttières', qty: 1, unit_price_cents: 23500 },
    ]);
  });

  it('total non divisible par la quantité → qté 1 au total exact (jamais un sou d’écart)', () => {
    expect(lignesPourFacture('Gardes-gouttières (3, $100.00)', 10000)).toEqual([
      { description: 'Gardes-gouttières (× 3)', qty: 1, unit_price_cents: 10000 },
    ]);
  });

  it('somme différente du sous-total, ou pas de colonne → une ligne « Montant importé »', () => {
    expect(lignesPourFacture('Fenêtres (1, $100.00)', 12000)).toEqual([{ description: LIBELLE_MONTANT_IMPORTE, qty: 1, unit_price_cents: 12000 }]);
    expect(lignesPourFacture('', 5000)).toEqual([{ description: LIBELLE_MONTANT_IMPORTE, qty: 1, unit_price_cents: 5000 }]);
    expect(lignesPourFacture('', 0)).toEqual([]);
  });
});

describe('texteLignes', () => {
  it('champ mappé, sinon colonne restée non mappée (import préparé avant ce champ)', () => {
    expect(texteLignes({ line_items: 'A (1, $1.00)' })).toBe('A (1, $1.00)');
    expect(texteLignes({ _unmapped: { 'Sent to': 'x', 'Line items': 'B (1, $2.00)' } })).toBe('B (1, $2.00)');
    expect(texteLignes({})).toBe('');
  });
});

describe('mappage', () => {
  it('« Line items » d’un fichier de factures → line_items', () => {
    const [s] = suggestMappings('invoices', [{ position: 0, header: 'Line items', detectedType: 'text', emptyRatio: 0, samplesMasked: [] }], 'invoices.csv');
    expect(s.targetField).toBe('line_items');
  });
});

describe('creerLignesImportees', () => {
  function faux(existantes: string[] = []) {
    const inserts: unknown[][] = [];
    const admin = {
      from: vi.fn(() => ({
        select: () => ({ in: () => ({ is: async () => ({ data: existantes.map((invoice_id) => ({ invoice_id })), error: null }) }) }),
        insert: async (rows: unknown[]) => { inserts.push(rows); return { error: null }; },
      })),
    };
    return { admin, inserts };
  }

  it('toutes les lignes de toutes les factures d’un lot en UNE instruction', async () => {
    const { admin, inserts } = faux();
    const r = await creerLignesImportees(admin as never, 'org', [
      { id: 'f1', lignes: [{ description: 'A', qty: 1, unit_price_cents: 100 }, { description: 'B', qty: 2, unit_price_cents: 50 }] },
      { id: 'f2', lignes: [{ description: 'C', qty: 1, unit_price_cents: 300 }] },
    ]);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toHaveLength(3);
    expect(r).toEqual({ creees: 3, echecs: 0 });
  });

  it('une facture qui a déjà des lignes (import rejoué) est sautée', async () => {
    const { admin, inserts } = faux(['f1']);
    await creerLignesImportees(admin as never, 'org', [
      { id: 'f1', lignes: [{ description: 'A', qty: 1, unit_price_cents: 100 }] },
      { id: 'f2', lignes: [{ description: 'C', qty: 1, unit_price_cents: 300 }] },
    ]);
    expect(inserts[0]).toEqual([expect.objectContaining({ invoice_id: 'f2', sort_order: 0 })]);
  });
});

describe('rattrapage SQL (migration 20260926100700) — même règle que l’importeur', () => {
  const sql = readFileSync(join(__dirname, '../../supabase/migrations/20260926100700_factures_importees_lignes.sql'), 'utf8');

  it('une seule instruction INSERT (la protection des factures émises l’exige)', () => {
    expect(sql.match(/insert into public\.invoice_items/g)).toHaveLength(1);
  });
  it('motif paresseux en premier, montant = total de la ligne', () => {
    expect(sql).toContain(String.raw`'(.*?) \((\d+(?:\.\d+)?), \$([\d,]*\.\d{2})\)(?:, |$)'`);
    expect(sql).toContain('having sum(lues.total_ligne) = src.subtotal_cents');
  });
  it('repli « Montant importé » et factures déjà pourvues de lignes sautées', () => {
    expect(sql).toContain(`'${LIBELLE_MONTANT_IMPORTE}'`);
    expect(sql).toMatch(/not exists \(select 1 from public\.invoice_items ii where ii\.invoice_id = i\.id and ii\.deleted_at is null\)/);
  });
});
