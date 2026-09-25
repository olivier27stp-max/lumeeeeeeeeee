// Rattachement aux dossiers DÉJÀ dans le CRM (migration complémentaire) et
// activation des clients facturés — leçons de l'import Vision Lavage 2026-09-17.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { existingClientRefKeys } from '../../server/lib/migration/importer';

describe('existingClientRefKeys', () => {
  it('courriel, nom complet et téléphone (10 chiffres), en minuscules', () => {
    expect(existingClientRefKeys({ email: 'Marc@Exemple.com', first_name: 'Marc', last_name: 'Tremblay', phone: '(514) 555-1234' }))
      .toEqual(['marc@exemple.com', 'marc tremblay', 'tel:5145551234']);
  });
  it('entreprise sans personne → raison sociale ; rien → aucune clé', () => {
    expect(existingClientRefKeys({ company: 'Vision Lavage inc' })).toEqual(['vision lavage inc']);
    expect(existingClientRefKeys({})).toEqual([]);
  });
});

describe('les deux passes amorcent le rattachement sur les dossiers existants', () => {
  const src = readFileSync('server/lib/migration/importer.ts', 'utf8');
  it('runDryRun et runFinalImport appellent seedExistingRefs', () => {
    expect(src.split('await seedExistingRefs(admin, migration.org_id, ctx);').length - 1).toBe(2);
  });
  it('les clients facturés ou avec job passent de prospect à actif, jamais les inactifs', () => {
    expect(src).toContain(".update({ status: 'active' })");
    expect(src).toContain(".eq('status', 'lead')");
  });
});
