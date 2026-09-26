/**
 * Formulaire de demande : « Ajouter des champs personnalisés » (le « Add Object
 * Fields » de GoHighLevel). Vérifié au navigateur : cocher A et C → 2 questions reliées.
 */
import { describe, it, expect } from 'vitest';
import { questionPour, typeQuestion } from '../src/components/champs/AjouterChampsFormulaire';
import type { ChampPerso } from '../src/lib/champs/types';

const champ = (p: Partial<ChampPerso>): ChampPerso => ({
  id: 'f1', object_type: 'client', folder_id: null, key: 'k', label: 'Surface', placeholder: null, help_text: null,
  field_type: 'single_line', config: {}, is_required: false, is_searchable: false, is_unique: false, position: 0,
  created_at: '', updated_at: '', archived_at: null, options: [], ...p,
} as ChampPerso);

describe('question créée depuis un champ', () => {
  it('reliée au champ, même libellé, obligatoire suivi', () => {
    const q = questionPour(champ({ is_required: true }), 'service_details', 'q1');
    expect(q).toMatchObject({ id: 'q1', label: 'Surface', type: 'text', required: true, cf_field_id: 'f1', section: 'service_details' });
  });
  it('types : liste → dropdown avec options actives ; choix multiples → cases ; nombre/montant → number ; long → paragraph', () => {
    const opts = [{ id: 'o1', label: 'Oui', archived_at: null }, { id: 'o2', label: 'Vieux', archived_at: '2026-01-01' }] as ChampPerso['options'];
    expect(questionPour(champ({ field_type: 'dropdown_single', options: opts }), 'service_details', 'q').options).toEqual(['Oui']);
    expect(typeQuestion(champ({ field_type: 'dropdown_single' }))).toBe('dropdown');
    expect(typeQuestion(champ({ field_type: 'dropdown_multi' }))).toBe('checkbox');
    expect(typeQuestion(champ({ field_type: 'monetary' }))).toBe('number');
    expect(typeQuestion(champ({ field_type: 'multi_line' }))).toBe('paragraph');
  });
});
