/**
 * Place des custom keys dans les formulaires (Rafba, 2026-09-28) : rangées de base,
 * ancre `config.apres`, et relecture après glisser-déposer.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OBJETS, type ChampPerso, type DossierChamp, type ObjetChamp } from '../src/lib/champs/types';
import { RANGEES_FORMULAIRE, SECTIONS_SYSTEME, ancresFormulaire, champsSysteme, rangeesFormulaire } from '../src/lib/champs/standard';
import { ancreValide, lirePlan, planFormulaire, type ElementPlan } from '../src/lib/champs/placement';

const dossier = (id: string, cle: string | null): DossierChamp =>
  ({ id, object_type: 'client', name: cle ?? id, position: 0, created_at: '', cle_systeme: cle });
const champ = (id: string, folder: string | null, position: number, apres?: string): ChampPerso => ({
  id, object_type: 'client', folder_id: folder, key: id, label: id.toUpperCase(), placeholder: null, help_text: null,
  default_value: null, field_type: 'single_line', config: apres ? { apres } : {}, is_required: false, is_searchable: false,
  is_unique: false, position, created_at: '', updated_at: '', archived_at: null, options: [],
} as unknown as ChampPerso);

const DOSSIERS = [dossier('f-coord', 'coordonnees'), dossier('f-lead', 'lead'), dossier('f-adr', 'adresse'), dossier('f-perso', null)];

describe('rangées des formulaires', () => {
  it.each(Object.keys(RANGEES_FORMULAIRE) as ObjetChamp[])('%s : chaque champ de base est dans UNE rangée, une rangée = une section, dans l’ordre de l’écran', (objet) => {
    const base = champsSysteme(objet).filter((c) => !c.suit);
    const toutes = RANGEES_FORMULAIRE[objet]!.flat();
    expect([...toutes].sort()).toEqual(base.map((c) => c.key).sort());
    const sectionDe = new Map(base.map((c) => [c.key, c.section]));
    const ordreSections = SECTIONS_SYSTEME[objet].map((s) => s.cle);
    let dernier = -1;
    for (const r of RANGEES_FORMULAIRE[objet]!) {
      expect(new Set(r.map((k) => sectionDe.get(k))).size, r.join()).toBe(1);
      const i = ordreSections.indexOf(sectionDe.get(r[0])!);
      expect(i, r.join()).toBeGreaterThanOrEqual(dernier);
      dernier = i;
    }
  });
  it('objet sans rangées déclarées : une rangée par section, aucune ancre', () => {
    expect(rangeesFormulaire('invoice').every((r) => r.cles.length >= 1)).toBe(true);
    expect(ancresFormulaire('invoice').size).toBe(0);
  });
  it('la dernière rangée d’une section n’est pas une ancre (fin de section)', () => {
    const a = ancresFormulaire('client');
    expect(a.has('first_name')).toBe(true);
    expect(a.has('email')).toBe(false);
    expect(a.has('lead_source')).toBe(false);
  });
  it.each([
    ['src/pages/NewClient.tsx', 'client'], ['src/pages/QuoteNew.tsx', 'quote'], ['src/components/NewJobModal.tsx', 'job'],
  ] as const)('%s pose un emplacement apres() pour chaque ancre', (fichier, objet) => {
    const src = readFileSync(join(__dirname, '..', fichier), 'utf8');
    expect(src).toContain('rangees: true');
    for (const a of ancresFormulaire(objet)) expect(src, a).toContain(`apres('${a}')`);
  });
});

describe('ancre d’une custom key', () => {
  it('valide seulement si la rangée est dans la section du champ', () => {
    expect(ancreValide('client', champ('x', 'f-coord', 0, 'phone'), 'coordonnees')).toBe('phone');
    expect(ancreValide('client', champ('x', 'f-adr', 0, 'phone'), 'adresse')).toBeNull();
    expect(ancreValide('client', champ('x', 'f-coord', 0, 'email'), 'coordonnees')).toBeNull();
    expect(ancreValide('client', champ('x', 'f-coord', 0), 'coordonnees')).toBeNull();
  });
});

describe('plan du formulaire ↔ places', () => {
  const champs = [champ('a', 'f-coord', 0, 'first_name'), champ('b', 'f-coord', 1), champ('c', 'f-perso', 2), champ('d', null, 3)];
  const plan = planFormulaire('client', champs, DOSSIERS, true);
  const ids = plan.map((e) => e.id);

  it('chaque custom key à sa place : après sa rangée, en fin de section, dans son dossier, puis sans dossier', () => {
    expect(ids.indexOf('c:a')).toBe(ids.indexOf('r:first_name') + 1);
    expect(ids.indexOf('c:b')).toBeGreaterThan(ids.indexOf('r:email'));
    expect(ids.indexOf('c:b')).toBeLessThan(ids.indexOf('s:lead'));
    expect(ids.indexOf('c:c')).toBe(ids.indexOf('d:f-perso') + 1);
    expect(ids[ids.length - 1]).toBe('c:d');
  });
  it('relire le plan sans glisser rend les mêmes places', () => {
    const p = lirePlan('client', plan);
    expect(p.get('a')).toEqual({ folder_id: 'f-coord', apres: 'first_name', position: 0 });
    expect(p.get('b')).toMatchObject({ folder_id: 'f-coord', apres: null });
    expect(p.get('c')).toMatchObject({ folder_id: 'f-perso', apres: null });
    expect(p.get('d')).toMatchObject({ folder_id: null, apres: null });
  });
  it('glissée sous « Adresse » → dossier adresse, après address', () => {
    const sans = plan.filter((e) => e.id !== 'c:d');
    const i = sans.findIndex((e) => e.id === 'r:address');
    const deplace: ElementPlan[] = [...sans.slice(0, i + 1), plan.find((e) => e.id === 'c:d')!, ...sans.slice(i + 1)];
    expect(lirePlan('client', deplace).get('d')).toMatchObject({ folder_id: 'f-adr', apres: 'address' });
  });
  it('glissée juste sous un en-tête de section → collée à la 1re rangée', () => {
    const sans = plan.filter((e) => e.id !== 'c:d');
    const i = sans.findIndex((e) => e.id === 's:coordonnees');
    const deplace: ElementPlan[] = [...sans.slice(0, i + 1), plan.find((e) => e.id === 'c:d')!, ...sans.slice(i + 1)];
    expect(lirePlan('client', deplace).get('d')).toMatchObject({ folder_id: 'f-coord', apres: 'first_name' });
  });
});

describe('colonnes = formulaire', () => {
  it.each([
    ['src/pages/Clients.tsx', ['nom', 'numero', 'entreprise', 'telephone', 'courriel', 'source', 'adresse', 'taxes', 'facturation']],
    ['src/pages/Jobs.tsx', ['titre', 'numero', 'vendeur', 'vente', 'client', 'propriete', 'type', 'planification', 'equipe', 'facturation', 'produits', 'total', 'contrat', 'notes']],
    ['src/pages/Quotes.tsx', ['client', 'type', 'titre', 'propriete', 'numero', 'vendeur', 'valide', 'produits', 'total', 'acompte', 'notes']],
  ] as const)('%s : chaque colonne du formulaire existe et est verrouillée', (fichier, ordre) => {
    const src = readFileSync(join(__dirname, '..', fichier), 'utf8');
    expect(src).toContain('colonnesDuFormulaire(');
    for (const id of ordre) expect(src, id).toMatch(new RegExp(`id: '${id}'`));
  });
  it('tous les objets ont leurs sections', () => { for (const o of OBJETS) expect(SECTIONS_SYSTEME[o].length).toBeGreaterThan(0); });
});
