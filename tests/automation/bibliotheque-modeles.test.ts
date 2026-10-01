/**
 * Bibliothèque de modèles (« Partir d'un modèle », 2026-09-30).
 *
 * Avant, le bouton ne créait rien : il ouvrait l'onglet « Modèles », qui
 * listait les vraies automatisations en brouillon de l'entreprise. Un modèle
 * est désormais une définition globale en lecture seule ; l'utiliser crée
 * UNE copie en brouillon.
 */
import { describe, it, expect } from 'vitest';
import { MODELES_AUTOMATISATION, META_ORPHELINES, trouverModele } from '../../server/lib/automationTemplates';
import { automationModeleUtiliserSchema, sequenceEtapes } from '../../server/lib/validation';
import { trouverDeclencheur, trouverAction } from '../../src/lib/automationCatalogue';
import { bloquantsPublication } from '../../src/lib/publicationAutomatisation';
import {
  CATEGORIES_MODELES, actionVisible, copierEtapes, etapesApercu, filtrerModeles, nomDisponible, normaliser, trierModeles,
  type CategorieModele,
} from '../../src/lib/automationTemplates';
import { apercuConversion, projeterFormatOrigine, type Etape } from '../../src/lib/sequenceTypes';
import { AUTOMATION_PRESETS } from '../../server/lib/automationPresets.data';

describe('catalogue de modèles', () => {
  it('reprend les préréglages existants, sans métadonnée orpheline', () => {
    expect(MODELES_AUTOMATISATION.length).toBeGreaterThanOrEqual(40);
    expect(META_ORPHELINES).toEqual([]);
    expect(new Set(MODELES_AUTOMATISATION.map((m) => m.id)).size).toBe(MODELES_AUTOMATISATION.length);
  });

  it('n’offre jamais un modèle dont le déclencheur n’est pas émis (estimate.sent)', () => {
    expect(trouverModele('estimate_followup')).toBeUndefined();
  });

  for (const m of MODELES_AUTOMATISATION) {
    it(`${m.id} passe la validation du moteur`, () => {
      expect(trouverDeclencheur(m.declencheur), `déclencheur ${m.declencheur}`).toBeDefined();
      // `log_activity` = journal interne, hors du catalogue de l'éditeur (étape
      // technique : comptée et montrée, jamais proposée).
      for (const a of m.actions) if (actionVisible(a.type)) expect(trouverAction(a.type), `action ${a.type}`).toBeDefined();
      // Le parcours passe la validation de graphe du moteur (étapes reliées,
      // bornes). Le schéma de l'ÉDITEUR, lui, est volontairement plus strict
      // (pas de `body_en`, `lien`…) : les préréglages portent ces clés, les
      // copies aussi — exactement comme « Dupliquer » un préréglage.
      // La copie est TOUJOURS un parcours (modèle d'une vague projeté).
      const r = sequenceEtapes.safeParse(m.steps ?? projeterFormatOrigine({ actions: m.actions, delay_seconds: m.delai_secondes }));
      expect(r.success, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3))).toBe(true);
      // La vérification que la route serveur de publication applique à la
      // COPIE (une automatisation ordinaire, pas un préréglage) : rien de
      // bloquant — sinon l'entreprise ne pourrait pas la publier.
      const bloquants = bloquantsPublication({ trigger_event: m.declencheur, steps: m.steps, actions: m.actions, conditions: m.conditions, is_preset: false });
      expect(bloquants.map((b) => b.message)).toEqual([]);
      expect(m.nom.fr && m.nom.en && m.description.fr && m.description.en).toBeTruthy();
      expect(m.nb_etapes).toBeGreaterThan(0);
      expect(m.canaux.length).toBeGreaterThan(0);
    });
  }

  it('chaque catégorie affichée a au moins un modèle', () => {
    const utilisees = new Set(MODELES_AUTOMATISATION.map((m) => m.categorie));
    for (const c of CATEGORIES_MODELES) expect(utilisees.has(c.cle), c.cle).toBe(true);
  });
});

describe('« Utiliser ce modèle » : le corps ne porte que le modèle', () => {
  it('refuse un org_id glissé dans la requête', () => {
    expect(automationModeleUtiliserSchema.safeParse({ templateId: 'pack_depot' }).success).toBe(true);
    expect(automationModeleUtiliserSchema.safeParse({ templateId: 'pack_depot', org_id: 'x' }).success).toBe(false);
    expect(automationModeleUtiliserSchema.safeParse({ templateId: '../x' }).success).toBe(false);
  });
});

describe('fonctions partagées', () => {
  it('copierEtapes : nouveaux identifiants et renvois réécrits, modèle intact', () => {
    const modele = trouverModele('pack_relance_devis');
    expect(modele?.steps).toBeTruthy();
    const source = modele!.steps as Etape[]; // vérifié juste au-dessus
    const avant = JSON.stringify(source);
    let n = 100;
    const copie = copierEtapes(source, () => `e${++n}`);
    expect(JSON.stringify(source)).toBe(avant);
    const anciens = new Set(source.map((e) => e.id));
    const nouveaux = new Set(copie.map((e) => e.id));
    for (const id of nouveaux) expect(anciens.has(id)).toBe(false);
    for (const e of copie) {
      const renvois = [
        'suivant' in e ? e.suivant : null,
        e.type === 'si' ? e.alors : null, e.type === 'si' ? e.sinon : null,
        e.type === 'attendre' ? e.si_reponse : null, e.type === 'attendre' ? e.si_depasse : null,
      ].filter(Boolean) as string[];
      for (const r of renvois) expect(nouveaux.has(r), r).toBe(true);
    }
    expect(etapesApercu({ steps: copie, actions: [], delai_secondes: 0 }).length)
      .toBe(etapesApercu({ steps: source, actions: [], delai_secondes: 0 }).length);
  });

  it('nomDisponible ajoute (2), (3)…', () => {
    expect(nomDisponible('Relance', [])).toBe('Relance');
    expect(nomDisponible('Relance', ['relance'])).toBe('Relance (2)');
    expect(nomDisponible('Relance', ['Relance', 'Relance (2)'])).toBe('Relance (3)');
  });

  it('recherche insensible aux accents, filtres et tris', () => {
    expect(normaliser('Réengagement')).toBe('reengagement');
    const aucune = new Set<CategorieModele>();
    const r = filtrerModeles(MODELES_AUTOMATISATION, { recherche: 'reengagement', categories: aucune, fr: true });
    expect(r.some((m) => m.id === 'reengagement_90d')).toBe(true);
    const cat = filtrerModeles(MODELES_AUTOMATISATION, { recherche: '', categories: new Set<CategorieModele>(['facturation']), fr: true });
    expect(cat.every((m) => m.categorie === 'facturation')).toBe(true);
    const parEtapes = trierModeles(MODELES_AUTOMATISATION, 'etapes', true);
    expect(parEtapes[0].nb_etapes).toBeGreaterThanOrEqual(parEtapes[parEtapes.length - 1].nb_etapes);
    const recents = trierModeles(MODELES_AUTOMATISATION, 'recent', true);
    expect(recents[0].ajoute_le >= recents[recents.length - 1].ajoute_le).toBe(true);
  });
});

describe('conversion des automatisations au format d’origine (Rafba : « les autres bulles »)', () => {
  // Les règles réelles sont, à 250 sur 251, des préréglages au format
  // d'origine. Converties, elles doivent être acceptées par le serveur —
  // `log_activity` compris — sinon l'éditeur les laisse en lecture seule.
  for (const p of AUTOMATION_PRESETS) {
    it(`${p.preset_key} se convertit et passe la validation`, () => {
      const c = apercuConversion({ actions: p.actions, delay_seconds: p.delay_seconds });
      expect(c.possible, c.bloquants.join(',')).toBe(true);
      const r = sequenceEtapes.safeParse(c.etapes);
      expect(r.success, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3))).toBe(true);
      if (p.delay_seconds < 0) {
        // Un rappel « la veille » reste la veille une fois converti.
        expect(c.etapes[0]).toMatchObject({ type: 'attendre', mode: 'avant_date', secondes_avant: -p.delay_seconds });
      }
    });
  }
});
