// Rattachement des documents à leur client par le nom : variantes (personne, raison sociale,
// nom affiché), forme relâchée (accents, ponctuation, article), et départage des homonymes
// par nom + adresse. Cas Vision Lavage 2026-09-22 : 35 propriétés orphelines pour des
// entreprises désignées par leur raison sociale, 34 pour des homonymes.
import { describe, expect, it } from 'vitest';
import { buildEntityRow, looseNameKey, nameKeysOf, refKeysOf, type BuildContext } from '../../server/lib/migration/importer';

describe('looseNameKey', () => {
  it('ignore accents, ponctuation et article initial/final', () => {
    expect(looseNameKey('Fabricants de Boyaux Industriel Premier Ltée (Les)')).toBe(looseNameKey('Les Fabricants de Boyaux Industriel Premier Ltée'));
    expect(looseNameKey('Nicole Hébert')).toBe('nicole hebert');
    expect(looseNameKey("L'Arpent Vert")).toBe('arpent vert');
  });
});

describe('nameKeysOf', () => {
  it('expose « Prénom Nom » ET la raison sociale pour une entreprise avec contact', () => {
    const keys = nameKeysOf({ first_name: 'Marc', last_name: 'Roy', company: 'Immobilier McCutcheon-Rice Inc' });
    expect(keys).toContain('marc roy');
    expect(keys).toContain('immobilier mccutcheon-rice inc');
    expect(keys).toContain('immobilier mccutcheon rice inc');
  });
  it('refKeysOf(client) reprend toutes les variantes', () => {
    const rec = { id: 'c1', file_id: 'f', row_number: 1, entity_type: 'client', external_id: null, normalized: { company: 'Les Arpents Verts', email: 'a@b.ca' }, relations: {}, status: 'ready' } as any;
    const keys = refKeysOf('client', rec);
    expect(keys).toContain('les arpents verts');
    expect(keys).toContain('arpents verts');
    expect(keys).toContain('a@b.ca');
  });
});

describe('buildEntityRow — homonymes départagés par nom + adresse', () => {
  const ctx = (): BuildContext => ({
    migration: { id: 'm', org_id: 'o' } as any,
    createdBy: 'u',
    clientIdByRef: new Map(), // « denise côté » ambigu : retiré de l'index
    clientIdByNameAddress: new Map([[`denise côté|${'12 rue des lilas'}`, 'client-A']]),
    propertyIdByRef: new Map(),
    jobIdByRef: new Map(),
  });
  it('rattache la propriété au bon homonyme par son adresse', () => {
    const rec = { id: 'p1', file_id: 'f', row_number: 2, entity_type: 'property', external_id: null, normalized: { address: '12 rue des Lilas' }, relations: { client_name_ref: 'Denise Côté' }, status: 'ready' } as any;
    const res = buildEntityRow('property', rec, ctx());
    expect(res.ok).toBe(true);
    expect((res as any).row.client_id).toBe('client-A');
  });
  it('reste orphelin sans adresse, avec le motif', () => {
    const rec = { id: 'p2', file_id: 'f', row_number: 3, entity_type: 'property', external_id: null, normalized: { address: '99 rue Inconnue' }, relations: { client_name_ref: 'Denise Côté' }, status: 'ready' } as any;
    const res = buildEntityRow('property', rec, ctx());
    expect(res.ok).toBe(false);
    expect((res as any).reason).toBe('orphan');
    expect((res as any).detail).toMatch(/client introuvable/);
  });
});

describe('doublons internes — export Jobber « une ligne par propriété »', () => {
  it('deux lignes avec le même préfixe clientId_ sont le même client (fusionnées, pas homonymes)', async () => {
    const { planIntraDedupe } = await import('../../server/lib/migration/importer');
    const row = (id: string, ext: string, address: string) => ({ id, file_id: 'f', row_number: 1, entity_type: 'client', external_id: ext, normalized: { company: 'Les Arpents Verts', external_id: ext, address }, relations: {}, status: 'ready' }) as any;
    const intra = planIntraDedupe('client', [row('a', '113169748_121696871', '3244 Chemin des Patriotes'), row('b', '113169748_120141036', '17920 avenue St-Louis')]);
    expect(intra.siblingOf.get('b')).toBe('a');
    expect(intra.ambiguousKeys.size).toBe(0);
  });
});
