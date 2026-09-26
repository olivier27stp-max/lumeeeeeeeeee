/**
 * QA DU 2026-09-25 — la persistance des parcours.
 *
 * P1-3 et P1-8 sont le MÊME défaut, vu de deux façons :
 * « Enregistrement… » qui ne finit jamais, et la moitié d'un parcours
 * de 16 étapes qui disparaît.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RACINE = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(RACINE, p), 'utf8');
const EDITEUR = 'src/pages/AutomationBuilderPage.tsx';

describe('P1-3 — « Enregistrement… » doit toujours finir', () => {
  const src = lire(EDITEUR);

  it('la confirmation ne dépend plus du drapeau d’annulation', () => {
    /*
     * LA CAUSE. L'effet d'autosauvegarde dépend de `steps` ET de
     * `etatSauvegarde`. Poser `en_cours` le relançait donc lui-même :
     * le nettoyage mettait `annule = true`, la réponse du serveur
     * revenait, et le `if (!annule)` l'ignorait. `a_jour` n'était
     * JAMAIS posé — l'indicateur restait bloqué alors que la mutation
     * avait réussi.
     */
    expect(src, 'a_jour ne doit plus être conditionné par !annule')
      .not.toMatch(/if \(!annule\) setEtatSauvegarde\('a_jour'\)/);
    expect(src, 'on confirme via la forme fonctionnelle, qui voit l’état réel')
      .toMatch(/setEtatSauvegarde\(\(actuel\) => \{[\s\S]{0,200}?'a_jour'/);
  });

  it('un échec ne laisse pas « en cours » non plus', () => {
    // Même raison : l'utilisateur doit toujours savoir où il en est.
    expect(src).toMatch(/setEtatSauvegarde\(\(actuel\) => \(actuel === 'en_cours' \? 'modifie' : actuel\)\)/);
  });
});

describe('P1-8 — un parcours long ne perd plus la moitié de ses étapes', () => {
  const src = lire(EDITEUR);

  it('un changement pendant l’envoi repart en « modifié », il n’est pas perdu', () => {
    /*
     * Chaque duplication modifiait `steps`, ce qui annulait la
     * sauvegarde en vol. Seules 8 des 16 étapes persistaient — sans
     * aucun message. On compare donc ce qu'on a ENVOYÉ à ce qui est à
     * l'écran au retour.
     */
    expect(src, 'on retient ce qui part').toMatch(/const envoye = JSON\.stringify\(steps\)/);
    expect(src, 'et on le compare au retour')
      .toMatch(/JSON\.stringify\(steps\) === envoye \? 'a_jour' : 'modifie'/);
  });

  it('la limite de 20 étapes est annoncée AVANT la perte', () => {
    /*
     * Le serveur refuse au-delà de 20 (`ETAPES_MAX`, validation.ts) :
     * un parcours plus long n'était jamais enregistré, et l'utilisateur
     * croyait avoir perdu son travail. Le rapport l'exige :
     * « si une limite volontaire existe, elle doit être affichée ET
     * bloquer avant la perte ».
     */
    expect(src).toMatch(/const ETAPES_MAX = 20/);
    const ajouts = [...src.matchAll(/if \(steps\.length >= ETAPES_MAX\)/g)];
    expect(ajouts.length, 'les DEUX chemins (ajout et duplication) doivent refuser')
      .toBe(2);
  });

  it('la limite du client suit celle du serveur', () => {
    // Deux chiffres différents = soit on refuse trop tôt, soit on laisse
    // passer ce que le serveur rejettera.
    expect(lire('server/lib/validation.ts')).toMatch(/const ETAPES_MAX = 20/);
  });
});

describe('P1-4 — on doit pouvoir lire ce qui est parti', () => {
  const journaux = lire('src/components/automations/OngletJournaux.tsx');
  const api = lire('src/lib/automationJournauxApi.ts');

  it('le contenu envoyé est exposé, pas seulement lu en base', () => {
    /*
     * `result_data` était SELECT-é depuis toujours, mais absent du type
     * `LigneJournal` — donc jamais affiché. L'entrepreneur voyait
     * « envoyé » sans pouvoir vérifier que « [client_first_name] »
     * avait bien été remplacé par « Jean ».
     */
    expect(api).toMatch(/result_data\?: Record<string, unknown> \| null/);
    expect(api).toMatch(/result_data, action_config/);
  });

  it('une ligne de journal s’ouvre', () => {
    // « les lignes de journaux ne sont pas cliquables : impossible de
    // voir le contenu réellement envoyé » — le rapport.
    expect(journaux).toMatch(/setDepliee\(\(d\) => \(d === l\.id \? null : l\.id\)\)/);
    expect(journaux).toMatch(/<DetailEnvoi ligne=\{l\} fr=\{fr\} \/>/);
  });

  it('elle s’ouvre aussi au CLAVIER', () => {
    // Une ligne qu'on n'ouvre qu'à la souris exclut qui navigue au
    // clavier — et le cliquet d'accessibilité le refuse.
    expect(journaux).toMatch(/onKeyDown=/);
    expect(journaux).toMatch(/aria-expanded=\{depliee === l\.id\}/);
  });

  it('une exécution sans contenu le DIT, au lieu d’une case vide', () => {
    // Les vieilles exécutions n'ont pas `result_data` : une ligne vide
    // ferait croire à un bug.
    expect(journaux).toMatch(/n\u2019a pas \u00e9t\u00e9 conserv\u00e9/);
  });
});

describe('P1-6 / P1-7 — Lumi doit MODIFIER, pas tout refaire', () => {
  const gen = lire('server/lib/lumi/generer-parcours.ts');
  const route = lire('server/routes/automation-rules.ts');
  const editeur = lire(EDITEUR);

  it('le modèle reçoit la CONVERSATION, plus seulement la dernière phrase', () => {
    /*
     * LA CAUSE : `messages: [{ role: 'user', content: demande }]` — un
     * seul message. « Change le délai à 7 jours » reconstruisait donc
     * tout depuis cette seule phrase : déclencheur changé, 2 SMS
     * devenus 1, nom renommé. Reproduit 2 fois au QA.
     */
    expect(gen, 'les messages doivent être construits, pas figés à un seul')
      .toMatch(/messages: construireMessages\(demande, echanges, parcoursActuel\)/);
    expect(gen).toMatch(/function construireMessages\(/);
  });

  it('il reçoit aussi le parcours À L’ÉCRAN', () => {
    // Sans lui, « le deuxième c'est 2 jours, pas 5 » n'a rien à quoi se
    // rattacher — d'où le silence total de P1-7.
    expect(gen).toMatch(/parcours ACTUEL, \u00e0 modifier \(ne le reconstruis pas de z\u00e9ro\)/);
  });

  it('la consigne dit explicitement de ne changer QUE ce qui est demandé', () => {
    expect(gen).toMatch(/tu le MODIFIES\. Tu ne le reconstruis\s+pas/);
  });

  it('le silence est interdit', () => {
    /*
     * « Le silence est le pire comportement : l'utilisateur croit que
     * c'est corrigé » — le rapport. Faute de comprendre, Lumi doit
     * renvoyer le parcours inchangé ET le dire.
     */
    expect(gen).toMatch(/Ne reste jamais silencieux/);
  });

  it('la chaîne complète transporte le contexte', () => {
    // Un maillon manquant et le correctif ne sert à rien.
    expect(route, 'la route doit relayer les échanges').toMatch(/echanges,/);
    expect(route, 'et le parcours courant').toMatch(/parcoursActuel: corps\?\.parcours_actuel/);
    expect(editeur, 'l’éditeur doit les envoyer').toMatch(/echanges: echangesLumi/);
    expect(editeur, 'et mémoriser la suite').toMatch(/setEchangesLumi\(/);
  });

  it('l’historique est BORNÉ — on ne paie pas des tokens pour rien', () => {
    // Au-delà de quelques tours, le contexte ne sert plus et le modèle
    // se met à suivre une consigne périmée.
    expect(gen).toMatch(/\(echanges \?\? \[\]\)\.slice\(-6\)/);
  });
});
