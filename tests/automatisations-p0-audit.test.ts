/**
 * LES TROIS P0 DE L'AUDIT DU 25 SEPTEMBRE 2026.
 *
 * Chacun échouait en silence — rien ne plantait, rien ne s'affichait :
 *   · P0-1  le champ « Conditions » semblait refuser le clavier ;
 *   · P0-2  le déclencheur pipeline n'était pas configurable ;
 *   · P0-3  250 règles sur 251 affichaient un parcours vide (couvert par
 *           `automatisations-format-origine.test.ts`).
 *
 * Ce fichier fige P0-1 et P0-2 au niveau du CONTRAT, pas de l'apparence :
 * un test d'apparence se réécrit à chaque retouche de style et finit par
 * ne plus rien protéger.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DECLENCHEURS, trouverDeclencheur } from '../src/lib/automationCatalogue';

const RACINE = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(RACINE, p), 'utf8');

describe('P0-1 — le champ « Conditions » accepte le clavier', () => {
  const panneau = lire('src/components/automations/PanneauEtape.tsx');

  it('le texte affiché est CELUI QU’ON TAPE, pas une reconstruction', () => {
    /*
     * La cause réelle (l'hypothèse « onChange débranché » était fausse) :
     * `value` était dérivé de l'objet `conditions`, et l'analyse ne gardait
     * une ligne que si la clé ET la valeur étaient remplies. Taper
     * « statut » — sans « = » encore — jetait la ligne, et la valeur dérivée
     * réécrivait un champ vide. Le champ s'effaçait à chaque frappe.
     */
    expect(panneau, 'un état local doit tenir le texte brut').toMatch(/conditionsTexte/);
    expect(panneau).toMatch(/value=\{conditionsTexte\}/);
    expect(panneau, 'ne jamais redériver la valeur depuis l’objet')
      .not.toMatch(/value=\{Object\.entries\(\(brouillon as EtapeSi\)\.conditions/);
  });

  it('l’objet `conditions` suit la saisie, pour l’enregistrement', () => {
    // Afficher le texte brut ne suffit pas : ce qui part au serveur doit
    // rester à jour, sinon on tape et rien ne s'enregistre.
    expect(panneau).toMatch(/setConditionsTexte\(e\.target\.value\)/);
    expect(panneau).toMatch(/conditions: analyserConditions\(e\.target\.value\)/);
  });

  it('des exemples cliquables disent QUOI écrire', () => {
    /*
     * L'audit : « aucune autocomplétion, aucune liste des champs valides —
     * l'utilisateur ne sait même pas quoi écrire ». Les champs dépendent du
     * déclencheur, donc on propose les plus courants plutôt qu'une liste
     * exhaustive qui serait fausse ailleurs.
     */
    expect(panneau).toMatch(/\['statut', 'source', 'montant', 'stage_id'\]/);
  });
});

describe('P0-2 — le déclencheur pipeline est configurable', () => {
  it('« Opportunité entre dans une étape » a un réglage d’étape', () => {
    /*
     * Sans `champs`, aucun panneau de configuration n'existait : le clic
     * retombait sur le tiroir des déclencheurs et le nœud restait en
     * pointillés. Impossible de choisir le pipeline ni l'étape.
     */
    const d = trouverDeclencheur('deal.stage_entered');
    expect(d, 'le déclencheur doit exister').toBeDefined();
    const stage = d!.champs?.find((c) => c.cle === 'stage_id');
    expect(stage, '`stage_id` doit être réglable').toBeDefined();
    expect(stage!.type).toBe('etape_pipeline');
  });

  it('« Opportunité qui dort » aussi', () => {
    const stage = trouverDeclencheur('deal.stage_idle')?.champs?.find((c) => c.cle === 'stage_id');
    expect(stage?.type).toBe('etape_pipeline');
  });

  it('l’étape reste FACULTATIVE — vide = toutes les étapes', () => {
    /*
     * La rendre obligatoire casserait les règles existantes, qui écoutent
     * aujourd'hui toutes les étapes. Vide doit garder ce comportement.
     */
    for (const cle of ['deal.stage_entered', 'deal.stage_idle']) {
      const stage = trouverDeclencheur(cle)?.champs?.find((c) => c.cle === 'stage_id');
      expect(stage?.obligatoire, `${cle} : ne pas casser l’existant`).toBe(false);
    }
  });

  it('la clé stockée est celle que le MOTEUR compare', () => {
    /*
     * Le trigger SQL écrit `stage_id` dans `pipeline_events.payload`, et
     * `evaluateConditions` compare `conditions.stage_id` à
     * `event.metadata.stage_id`. Un autre nom de clé donnerait un réglage
     * enregistré que rien ne lit — une règle qui ne filtre jamais.
     */
    const moteur = lire('server/lib/automationEngine.ts');
    expect(moteur, 'le moteur lit les métadonnées de l’événement')
      .toMatch(/const actual = event\.metadata\[key\]/);
    const migration = lire('supabase/migrations/20260923100100_pipeline_moteur_et_forfait.sql');
    expect(migration, 'le payload porte bien stage_id').toMatch(/'stage_id', new\.stage_id/);
  });

  it('aucun déclencheur offert n’est resté « bientôt » sans raison', () => {
    // Garde-fou inverse : j'avais grisé ces deux déclencheurs alors qu'ils
    // étaient branchés (34 événements émis en prod). Un déclencheur grisé à
    // tort est une fonctionnalité perdue en silence.
    const catalogue = lire('src/lib/automationCatalogue.ts');
    for (const d of DECLENCHEURS.filter((x) => x.bientot)) {
      const i = catalogue.indexOf(`cle: '${d.cle}'`);
      const bloc = catalogue.slice(i, catalogue.indexOf('\n  },', i));
      expect(bloc, `${d.cle} : dire POURQUOI il est grisé`).toMatch(/n'émet pas|n’émet pas|pas encore/i);
    }
  });
});
