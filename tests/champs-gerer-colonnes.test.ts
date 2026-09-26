/**
 * « Gérer les champs » des listes Clients, Jobs, Devis et Factures (refonte « comme GoHighLevel »,
 * PR 3) : colonnes par utilisateur en base, colonnes standard + champs, tri par
 * un champ. Vérifié au navigateur contre staging (scripts QA de la PR) ; ici on
 * fige les règles qui ne doivent pas régresser.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const rpc = vi.fn();
vi.mock('../src/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock('../src/lib/orgApi', () => ({ getCurrentOrgIdOrThrow: async () => 'org' }));

import { pageTrieeParChamp, champDeColonne, idColonneChamp } from '../src/lib/colonnesTableauApi';
import { normaliserColonnes } from '../src/components/champs/colonnes';

const lire = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

describe('colonnes choisies', () => {
  it('identifiants : colonne standard ou « cf:<id> »', () => {
    expect(idColonneChamp('abc')).toBe('cf:abc');
    expect(champDeColonne('cf:abc')).toBe('abc');
    expect(champDeColonne('adresse')).toBeNull();
  });

  it('la colonne verrouillée reste première ; inconnues (champ archivé) et doublons écartés', () => {
    const connues = new Set(['nom', 'adresse', 'statut', 'cf:a']);
    expect(normaliserColonnes(['statut', 'nom', 'cf:a', 'cf:archive', 'statut'], ['nom'], connues)).toEqual(['nom', 'statut', 'cf:a']);
    expect(normaliserColonnes([], ['nom'], connues)).toEqual(['nom']);
  });
});

describe('tri par un champ personnalisé', () => {
  it('d’abord les fiches qui ont une valeur (ordre du champ), puis les autres ; les filtres de la liste s’appliquent', async () => {
    rpc.mockResolvedValue({ data: ['c3', 'x-autre-filtre', 'c1'], error: null });
    const charge = vi.fn(async (ids: string[]) => ids.slice().reverse().map((id) => ({ id })));
    const p1 = await pageTrieeParChamp({
      cle: 't1', champId: 'f', asc: true, from: 0, to: 1,
      idsFiltres: async () => ['c1', 'c2', 'c3', 'c4'], lignes: charge,
    });
    expect(p1.items.map((l) => l.id)).toEqual(['c3', 'c1']);
    expect(p1.total).toBe(4);
    const p2 = await pageTrieeParChamp({
      cle: 't1', champId: 'f', asc: true, from: 2, to: 3,
      idsFiltres: async () => { throw new Error('séquence gardée : pas de rechargement'); }, lignes: charge,
    });
    expect(p2.items.map((l) => l.id)).toEqual(['c2', 'c4']);
    expect(rpc).toHaveBeenCalledWith('cf_ordre_ids', { p_field: 'f', p_asc: true });
  });
});

describe('base : réglage personnel, isolé', () => {
  const sql = lire('supabase/migrations/20260929160000_colonnes_par_utilisateur.sql');
  it('RLS forcée, chacun les siennes, membre de l’entreprise', () => {
    expect(sql).toMatch(/force row level security/);
    for (const op of ['select', 'insert', 'update', 'delete']) {
      expect(sql).toMatch(new RegExp(`create policy table_view_preferences_${op}`));
    }
    expect(sql.match(/user_id = \(select auth\.uid\(\)\) and public\.has_org_membership\(\(select auth\.uid\(\)\), org_id\)/g)!.length).toBeGreaterThanOrEqual(5);
  });
  it('clé étrangère composite vers l’adhésion : quitter l’entreprise emporte le réglage', () => {
    expect(sql).toMatch(/foreign key \(user_id, org_id\)\s+references public\.memberships \(user_id, org_id\) on delete cascade/);
  });
  it('tri : SECURITY INVOKER (la RLS des valeurs s’applique), fermé à anon', () => {
    expect(sql).toMatch(/function public\.cf_ordre_ids[\s\S]*security invoker/);
    expect(sql).toMatch(/revoke all on function public\.cf_ordre_ids\(uuid, boolean\) from public, anon/);
  });
});

describe('listes branchées', () => {
  for (const [page, objet] of [['src/pages/Clients.tsx', 'client'], ['src/pages/Jobs.tsx', 'job'], ['src/pages/Quotes.tsx', 'quote'], ['src/pages/Invoices.tsx', 'invoice']] as const) {
    it(`${page} : « Gérer les champs », colonnes, tri par champ`, () => {
      const s = lire(page);
      expect(s).toContain(`useColonnesTableau<`);
      expect(s).toContain(`('${objet}', colonnesStandard, fr, { tri: triChamp, setTri: setTriChamp })`);
      expect(s).toContain('{colonnes.bouton}');
      expect(s).toContain('{colonnes.panneau}');
      expect(s).toContain('colonnes.pistes');
      expect(s).toMatch(/triChamp: triChamp \? \{ \.\.\.triChamp, cle: champsListe\.cle \} : null/);
      expect(s).toMatch(/verrouillee: true/);
    });
  }
  it('le panneau reproduit « Manage fields » de GoHighLevel', () => {
    const s = lire('src/components/champs/colonnes.tsx');
    for (const texte of ['Gérer les champs', 'Chercher un champ', 'Champs dans le tableau', 'Ajouter des champs', 'Ajouter un champ personnalisé', 'Annuler', 'Appliquer']) {
      expect(s).toContain(texte);
    }
    // Un champ créé depuis le panneau revient coché.
    expect(s).toMatch(/setBrouillon\(\(b\) => \(b\.includes\(idColonneChamp\(c\.id\)\) \? b : \[\.\.\.b, idColonneChamp\(c\.id\)\]\)\)/);
  });
});
