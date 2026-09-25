/**
 * LE FORMAT D'ORIGINE — 250 règles sur 251 en production.
 *
 * Avant le builder visuel, une automatisation portait une LISTE PLATE
 * d'actions et un seul `delay_seconds`. Le canevas, lui, ne lit que
 * `steps` : il affichait donc « Ajouter une première étape » sur des
 * automatisations ACTIVES qui envoient vraiment des messages.
 *
 * Mesuré en prod le 2026-09-25 : 250 des 251 règles vivantes ont `steps`
 * vide et leur configuration dans `actions`. Ce n'était pas un cas
 * isolé — c'était presque tout le parc client. L'éditeur mentait.
 *
 * Exigence de Will : le rendu en lecture seule doit être FIDÈLE, sinon on
 * remplace un mensonge par un autre. Ce fichier tient la garde sur la
 * fidélité de la projection, pas sur son apparence.
 */

import { describe, it, expect } from 'vitest';
import { apercuConversion, estFormatOrigine, projeterFormatOrigine } from '../src/lib/sequenceTypes';

describe('reconnaître une règle au format d’origine', () => {
  it('steps vide + actions remplies = format d’origine', () => {
    expect(estFormatOrigine({ steps: [], actions: [{ type: 'send_sms' }] })).toBe(true);
    expect(estFormatOrigine({ steps: null, actions: [{ type: 'send_sms' }] })).toBe(true);
  });

  it('une règle avec un parcours n’est PAS au format d’origine', () => {
    // Sinon on écraserait l'affichage d'un vrai parcours par la projection.
    expect(estFormatOrigine({
      steps: [{ id: 'e1', type: 'action' }],
      actions: [{ type: 'send_sms' }],
    })).toBe(false);
  });

  it('une règle vraiment vide n’est pas au format d’origine', () => {
    // Elle doit garder son « Ajouter une première étape » — c'est la vérité.
    expect(estFormatOrigine({ steps: [], actions: [] })).toBe(false);
  });
});

describe('la projection montre ce que la règle fait VRAIMENT', () => {
  it('chaque action devient une carte, dans l’ordre d’exécution', () => {
    const etapes = projeterFormatOrigine({
      delay_seconds: 0,
      actions: [
        { type: 'send_email', config: { subject: 'Rappel', body: 'Bonjour' } },
        { type: 'send_sms', config: { body: 'Suivi' } },
      ],
    });
    expect(etapes).toHaveLength(2);
    expect(etapes.map((e) => (e as { action: { type: string } }).action.type))
      .toEqual(['send_email', 'send_sms']);
  });

  it('la configuration est conservée telle quelle', () => {
    // Le panneau doit pouvoir montrer le VRAI texte du courriel : c'est la
    // demande de Rafba (« je veux voir le texte quand je clique »).
    const [e] = projeterFormatOrigine({
      delay_seconds: 0,
      actions: [{ type: 'send_email', config: { subject: 'Facture en retard', body: 'Bonjour [client_name]' } }],
    });
    expect((e as { action: { config: Record<string, string> } }).action.config)
      .toEqual({ subject: 'Facture en retard', body: 'Bonjour [client_name]' });
  });

  it('le délai partagé devient une attente EN TÊTE', () => {
    /*
     * C'est ce que le moteur fait réellement : il attend `delay_seconds`,
     * puis exécute toutes les actions. Le montrer après les actions, ou
     * l'omettre, décrirait un comportement qui n'existe pas.
     *
     * 205 règles de prod portent un délai : ce n'est pas un cas marginal.
     */
    const etapes = projeterFormatOrigine({
      delay_seconds: 86400,
      actions: [{ type: 'send_sms', config: { body: 'x' } }],
    });
    expect(etapes[0].type).toBe('attendre');
    expect((etapes[0] as { delai_secondes: number }).delai_secondes).toBe(86400);
    expect(etapes[1].type).toBe('action');
  });

  it('sans délai, aucune attente n’est inventée', () => {
    const etapes = projeterFormatOrigine({
      delay_seconds: 0,
      actions: [{ type: 'send_sms', config: { body: 'x' } }],
    });
    expect(etapes.every((e) => e.type !== 'attendre')).toBe(true);
  });

  it('les cartes sont CHAÎNÉES — un parcours, pas des cartes flottantes', () => {
    const etapes = projeterFormatOrigine({
      delay_seconds: 3600,
      actions: [{ type: 'send_email', config: {} }, { type: 'send_sms', config: {} }, { type: 'create_task', config: {} }],
    });
    expect(etapes.map((e) => e.id)).toEqual(['origine-attente', 'origine-0', 'origine-1', 'origine-2']);
    expect((etapes[0] as { suivant: string }).suivant).toBe('origine-0');
    expect((etapes[1] as { suivant: string }).suivant).toBe('origine-1');
    expect((etapes[3] as { suivant: string | null }).suivant, 'la dernière termine le parcours').toBeNull();
  });

  it('un type INCONNU du catalogue est conservé, pas masqué', () => {
    /*
     * `log_activity` est une écriture interne du moteur, absente du
     * catalogue — et présente dans de vraies règles de prod. La masquer
     * donnerait un parcours incomplet : exactement le défaut qu'on corrige.
     */
    const etapes = projeterFormatOrigine({
      delay_seconds: 0,
      actions: [{ type: 'log_activity', config: {} }, { type: 'send_sms', config: {} }],
    });
    expect(etapes).toHaveLength(2);
    expect((etapes[0] as { action: { type: string } }).action.type).toBe('log_activity');
  });

  it('les identifiants sont STABLES d’un rendu à l’autre', () => {
    // Un id tiré au hasard ferait « sauter » la carte sélectionnée à chaque
    // rendu de React.
    const regle = { delay_seconds: 0, actions: [{ type: 'send_sms', config: {} }] };
    expect(projeterFormatOrigine(regle).map((e) => e.id))
      .toEqual(projeterFormatOrigine(regle).map((e) => e.id));
  });

  it('une règle sans action ne projette rien', () => {
    expect(projeterFormatOrigine({ delay_seconds: 0, actions: [] })).toEqual([]);
    expect(projeterFormatOrigine({ delay_seconds: 0, actions: null as never })).toEqual([]);
  });
});

describe('la projection ne touche JAMAIS la règle', () => {
  it('l’objet d’origine est intact après projection', () => {
    /*
     * Exigence de Will : aucune conversion silencieuse d'une règle active
     * qui envoie des messages à de vrais clients. La projection est une
     * LECTURE ; l'écriture attend un clic explicite.
     */
    const regle = {
      delay_seconds: 86400,
      actions: [{ type: 'send_email', config: { subject: 'A', body: 'B' } }],
    };
    const copie = JSON.parse(JSON.stringify(regle));
    projeterFormatOrigine(regle);
    expect(regle).toEqual(copie);
  });
});

describe('l’aperçu de conversion — dire AVANT, pas échouer après', () => {
  it('une règle de types connus est convertible', () => {
    const a = apercuConversion({
      delay_seconds: 86400,
      actions: [{ type: 'send_email', config: { subject: 'A', body: 'B' } }],
    });
    expect(a.possible).toBe(true);
    expect(a.bloquants).toEqual([]);
    expect(a.etapes).toHaveLength(2); // l'attente + l'action
  });

  it('`log_activity` EMPÊCHE la conversion, et est nommé', () => {
    /*
     * Il écrit la trace interne (`activity_log`) et n'est pas au catalogue :
     * le serveur refuse le parcours. Mesuré en prod le 2026-09-25 :
     * 100 règles sur 250 en portent un. Les convertir en le retirant ferait
     * disparaître leur historique EN SILENCE — on refuse et on le dit.
     */
    const a = apercuConversion({
      delay_seconds: 0,
      actions: [{ type: 'send_sms', config: { body: 'x' } }, { type: 'log_activity', config: {} }],
    });
    expect(a.possible).toBe(false);
    expect(a.bloquants).toContain('log_activity');
    // Les étapes restent calculées : l'aperçu montre quand même le parcours.
    expect(a.etapes).toHaveLength(2);
  });

  it('une règle vide n’est pas « convertible »', () => {
    expect(apercuConversion({ delay_seconds: 0, actions: [] }).possible).toBe(false);
  });

  it('un type bloquant n’est listé qu’UNE fois', () => {
    const a = apercuConversion({
      delay_seconds: 0,
      actions: [{ type: 'log_activity', config: {} }, { type: 'log_activity', config: {} }],
    });
    expect(a.bloquants).toEqual(['log_activity']);
  });
});
