/**
 * Champs personnalisés, refonte « comme GoHighLevel » (PR 2) :
 *   · la variable s'écrit {{client.type_de_toiture}} — et l'ancien
 *     {client_cf_type_de_toiture} continue de marcher — partout où le serveur
 *     remplit un texte : modèles de courriel, rappels, automatisations ;
 *   · la valeur par défaut est validée côté serveur et pré-remplie à la création.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../server/lib/supabase', () => ({ getServiceClient: () => ({}) }));

import { applyTemplate } from '../server/lib/notificationHelpers';
import { variablesInconnues } from '../src/lib/emailBodyText';
import { variableAffichee } from '../src/lib/champs/types';
import { champCreerSchema, champModifierSchema } from '../server/lib/validation';

const lire = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');
const vars = { client_cf_type_de_toiture: 'Bardeau', client_name: 'Marie' };

describe('variables {{objet.cle}}', () => {
  it('affichée au format GoHighLevel', () => {
    expect(variableAffichee('client', 'type_de_toiture')).toBe('{{client.type_de_toiture}}');
  });

  it('courriels : les deux formats donnent la même valeur', () => {
    expect(applyTemplate('Toit : {{client.type_de_toiture}}', vars)).toBe('Toit : Bardeau');
    expect(applyTemplate('Toit : {{ client.type_de_toiture }}', vars)).toBe('Toit : Bardeau');
    expect(applyTemplate('Toit : {client_cf_type_de_toiture}', vars)).toBe('Toit : Bardeau');
    expect(applyTemplate('Bonjour {client_name}', vars)).toBe('Bonjour Marie');
  });

  it('courriels : une variable inconnue reste visible (comme les autres)', () => {
    expect(applyTemplate('{{client.inexistant}}', vars)).toBe('{{client.inexistant}}');
  });

  it('automatisations : resolveTemplate connaît aussi le format', async () => {
    const { resolveTemplate } = await import('../server/lib/actions/index');
    expect(resolveTemplate('Toit : {{client.type_de_toiture}} / [client_name]', vars)).toBe('Toit : Bardeau / Marie');
  });

  it('les valeurs des champs sont chargées quand un modèle cite le nouveau format', () => {
    expect(lire('server/lib/courriels/modeles.ts')).toMatch(/_cf_\|\\\{\\\{\\s\*\[a-z\]\+\\\.\[a-z\]/);
  });

  it('éditeur : une clé mal tapée est signalée, une bonne ne l’est pas', () => {
    const connues = ['client_cf_type_de_toiture'];
    expect(variablesInconnues('{{client.type_de_toiture}}', connues)).toEqual([]);
    expect(variablesInconnues('{{client.type_de_toitur}}', connues)).toEqual(['client_cf_type_de_toitur']);
  });

  it('le rapport d’impact reconnaît les deux formats avant une purge', () => {
    const sql = lire('supabase/migrations/20260929150000_champs_valeur_defaut.sql');
    expect(sql).toMatch(/create or replace function public\.cf_impact_champ/);
    expect(sql).toMatch(/v_alias := '\\\{\\\{\\s\*'/);
    expect(sql).toMatch(/security invoker/);
  });
});

describe('valeur par défaut', () => {
  const base = { object_type: 'client', label: 'Toit', field_type: 'single_line' };

  it('texte, nombre, liste de libellés, null : acceptés', () => {
    for (const v of ['Bardeau', 12.5, ['A', 'B'], null]) {
      expect(champCreerSchema.safeParse({ ...base, default_value: v }).success).toBe(true);
    }
  });

  it('objet ou texte démesuré : refusés par le serveur', () => {
    expect(champCreerSchema.safeParse({ ...base, default_value: { a: 1 } }).success).toBe(false);
    expect(champCreerSchema.safeParse({ ...base, default_value: 'x'.repeat(5001) }).success).toBe(false);
  });

  it('modifiable après coup (le schéma de modification est strict)', () => {
    expect(champModifierSchema.safeParse({ default_value: 'Tôle' }).success).toBe(true);
    expect(champModifierSchema.safeParse({ default_value: null }).success).toBe(true);
  });

  it('pré-remplie à la création sans écraser la saisie (libellé → id d’option)', () => {
    const src = lire('src/components/champs/creation.tsx');
    expect(src).toMatch(/c\.default_value/);
    expect(src).toMatch(/c\.id in courant\.current/);
    expect(src).toMatch(/o\.label === l\)\?\.id/);
  });
});
