/**
 * « Je veux que ça se mette automatiquement une fois créé, attribué au bon
 * truc, et que le formulaire s'adapte. » (Rafba, 2026-09-26)
 *
 * Le formulaire de demande suit les champs : ajouté à la création, mis à jour
 * à la modification, retiré à l'archivage — et seulement pour ce qui a du sens
 * sur un formulaire public.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ajouterAuxFormulaires, retirerDesFormulaires, synchroniserQuestions,
} from '../server/lib/champs/formulaireSuit';
import type { ChampPerso } from '../src/lib/champs/types';

const ORG = 'org-1';
let formulaires: { id: string; custom_fields: unknown }[];
let ecritures: { id: string; liste: any[] }[];

/** Faux client Supabase : juste ce que le module appelle. */
const db: any = {
  from: () => ({
    select: () => ({ eq: () => ({ is: () => ({ data: formulaires, error: null }) }) }),
    update: (patch: any) => ({ eq: (_c: string, id: string) => ({ eq: () => {
      ecritures.push({ id, liste: patch.custom_fields });
      const f = formulaires.find((x) => x.id === id);
      if (f) f.custom_fields = patch.custom_fields;
      return { error: null };
    } }) }),
  }),
};

const champ = (p: Partial<ChampPerso> = {}): ChampPerso => ({
  id: 'champ-1', org_id: ORG, object_type: 'client', field_type: 'single_line',
  label: 'Type de toiture', key: 'type_de_toiture', is_required: false, is_searchable: false,
  is_unique: false, position: 0, options: [], config: {}, folder_id: null,
  placeholder: null, help_text: null, default_value: null, archived_at: null,
  created_at: '', updated_at: '', ...p,
} as ChampPerso);

beforeEach(() => {
  formulaires = [{ id: 'form-1', custom_fields: [{ id: 'q-libre', label: 'Type de service', type: 'text', section: 'service_details' }] }];
  ecritures = [];
});

describe('à la création', () => {
  it('pose la question sur le formulaire, déjà reliée au champ', async () => {
    expect(await ajouterAuxFormulaires(db, ORG, champ())).toBe(1);
    const ajoutee = ecritures[0].liste.at(-1);
    expect(ajoutee).toMatchObject({ label: 'Type de toiture', type: 'text', required: false, cf_field_id: 'champ-1', section: 'service_details' });
    // La question que l'utilisateur avait écrite à la main reste intacte.
    expect(ecritures[0].liste[0]).toMatchObject({ id: 'q-libre', label: 'Type de service' });
  });

  it('une liste déroulante apporte ses options, une case à cocher devient Oui / Non', async () => {
    await ajouterAuxFormulaires(db, ORG, champ({
      field_type: 'dropdown_single',
      options: [{ id: 'o1', label: 'Bardeau', position: 0, archived_at: null }, { id: 'o2', label: 'Tôle', position: 1, archived_at: null }] as any,
    }));
    expect(ecritures[0].liste.at(-1)).toMatchObject({ type: 'dropdown', options: ['Bardeau', 'Tôle'] });
    ecritures = [];
    await ajouterAuxFormulaires(db, ORG, champ({ id: 'champ-2', field_type: 'checkbox' }));
    expect(ecritures[0].liste.at(-1)).toMatchObject({ type: 'dropdown', options: ['Oui', 'Non'] });
  });

  it('ignore ce qui n’a rien à faire sur un formulaire public', async () => {
    for (const c of [champ({ object_type: 'job' }), champ({ object_type: 'invoice' }),
                     champ({ object_type: 'property' }), champ({ field_type: 'file' })]) {
      expect(await ajouterAuxFormulaires(db, ORG, c)).toBe(0);
    }
    expect(ecritures).toHaveLength(0);
  });

  it('ne double pas une question déjà reliée', async () => {
    formulaires[0].custom_fields = [{ id: 'q1', cf_field_id: 'champ-1', label: 'Type de toiture' }];
    expect(await ajouterAuxFormulaires(db, ORG, champ())).toBe(0);
  });
});

describe('à la modification', () => {
  beforeEach(() => {
    formulaires[0].custom_fields = [
      { id: 'q-libre', label: 'Type de service', type: 'text', section: 'service_details' },
      { id: 'q1', cf_field_id: 'champ-1', label: 'Ancien nom', type: 'text', required: false, options: [], section: 'service_details' },
    ];
  });

  it('la question reprend le nouveau nom et devient obligatoire', async () => {
    expect(await synchroniserQuestions(db, ORG, champ({ label: 'Toiture', is_required: true }))).toBe(1);
    expect(ecritures[0].liste[1]).toMatchObject({ id: 'q1', label: 'Toiture', required: true, cf_field_id: 'champ-1' });
    expect(ecritures[0].liste[0]).toMatchObject({ id: 'q-libre', label: 'Type de service' });
  });

  it('rien à écrire quand rien n’a changé', async () => {
    formulaires[0].custom_fields = [{ id: 'q1', cf_field_id: 'champ-1', label: 'Type de toiture', type: 'text', required: false, options: [], section: 'service_details' }];
    expect(await synchroniserQuestions(db, ORG, champ())).toBe(0);
    expect(ecritures).toHaveLength(0);
  });
});

describe('à l’archivage', () => {
  it('retire la question reliée et laisse les autres', async () => {
    formulaires[0].custom_fields = [
      { id: 'q-libre', label: 'Type de service' },
      { id: 'q1', cf_field_id: 'champ-1', label: 'Type de toiture' },
      { id: 'q2', cf_field_id: 'champ-2', label: 'Autre champ' },
    ];
    expect(await retirerDesFormulaires(db, ORG, 'champ-1')).toBe(1);
    expect(ecritures[0].liste.map((q: any) => q.id)).toEqual(['q-libre', 'q2']);
  });

  it('ne touche à rien si le champ n’était sur aucun formulaire', async () => {
    expect(await retirerDesFormulaires(db, ORG, 'champ-inconnu')).toBe(0);
    expect(ecritures).toHaveLength(0);
  });
});
