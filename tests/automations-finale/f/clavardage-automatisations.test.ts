/**
 * Agent F — constats F-11 et F-16, côté clavardage de Lumi.
 *
 * F-11 : un ORDRE qui porte sur une automatisation passe toujours par le
 * routeur (un appel Haiku, 0,156 ¢ et 1,1 à 1,7 s mesurés, 12 messages sur
 * 12), parce que la règle gratuite `sujetParRegle` se tait dès que la phrase
 * touche deux vocabulaires — et une automatisation parle toujours aussi de
 * devis, de factures, de textos ou de clients.
 *
 * F-16 : après Confirmer, le reçu d'une écriture d'automatisation dit
 * « C'est fait : l’action. » — ni le nom de l'automatisation, ni le fait
 * qu'elle naît en pause.
 *
 * Tests purs : aucune base, aucun réseau, aucun modèle.
 */
import { describe, it, expect } from 'vitest';
import { sujetParRegle } from '../../../server/lib/lumi/sujet-par-regle';
import { texteRecus } from '../../../server/lib/lumi/recus';

describe('F-11 — un ordre sur une automatisation trouve son sujet sans le routeur', () => {
  it.each([
    'Active l’automatisation Rappel de facture',
    'Mets en pause l’automatisation Relance de soumission',
    'Change le texto de l’automatisation « Relance de soumission » pour : Bonjour, des questions ?',
    'Renomme l’automatisation « Rappel de facture » en « Rappel de facture en retard ».',
    'Crée une automatisation : quand un devis est envoyé, attends 3 jours puis envoie un texto de relance au client.',
    'Supprime l’automatisation Suivi après visite',
  ])('« %s » → sujet « rapports » (celui qui charge les outils d’automatisation)', (message) => {
    expect(sujetParRegle(message)).toBe('rapports');
  });

  it('garde-fou : une phrase sans le mot « automatisation » qui touche deux sujets reste au routeur', () => {
    expect(sujetParRegle('Envoie la facture au client Tremblay et planifie sa visite')).toBeNull();
  });
});

describe('F-16 — le reçu d’une écriture d’automatisation dit ce qui a été fait', () => {
  const recu = (outil: string, resultat: Record<string, unknown>) => texteRecus([
    { recu: { tool_use_id: 'toolu_test', ok: true, fiche: null } as never, erreur: null, outil, resultat },
  ], 'confirm', true);

  it('création : le nom de l’automatisation et « en pause » sont dans le reçu', () => {
    const texte = recu('create_automation_from_text', {
      created: true, name: 'Relance de devis à 3 jours', is_active: false,
      note: 'Créée EN PAUSE : rien ne partira tant qu’elle n’est pas activée.',
    });
    expect(texte, 'reçu lu aujourd’hui : « C’est fait : l’action. »').not.toMatch(/l’action\./);
    expect(texte).toMatch(/Relance de devis à 3 jours/);
    expect(texte).toMatch(/pause/i);
  });

  it.each(['toggle_automation_rule', 'update_automation_message', 'update_automation_sms_body', 'rename_automation_rule'])('%s : le reçu nomme l’automatisation', (outil) => {
    const texte = recu(outil, { updated: true, name: 'Rappel de facture', note: 'Automatisation activée : elle partira dès son prochain déclenchement.' });
    expect(texte).not.toMatch(/l’action\./);
    expect(texte).toMatch(/Rappel de facture/);
  });
});
