// VAGUE 4 — A-16 : les noms des modèles dans la bonne langue (audit V2, s1).

import { describe, it, expect } from 'vitest';
import { localizeAutomationName } from '../src/lib/automationNames';

describe('A-16 — noms des modèles', () => {
  it('« Invoice Reminder — 30 Days » (semé par la base) est traduit en français', () => {
    expect(localizeAutomationName('Invoice Reminder — 30 Days', 'fr')).toBe('Rappel de facture — 30 jours');
  });

  it('les modèles semés en FRANÇAIS s’affichent en anglais pour un utilisateur anglais', () => {
    for (const nom of [
      'Me notifier quand un client ouvre sa soumission',
      'Avancer le deal quand la soumission est envoyée',
      'Avancer le deal quand le client ouvre sa soumission',
      'Passer le deal à « Gagné » quand la soumission est acceptée',
      'Sondage d\'avis — dès la fin de la job',
      'Rendez-vous — confirmation et rappels',
      'Relance de devis — 1, 2, 5, 10 et 30 jours',
      'Relance de facture — 3, 7, 14 et 30 jours',
      'Nouveau prospect — bienvenue et suivis',
      'Dépôt — demande et rappel',
    ]) {
      const en = localizeAutomationName(nom, 'en');
      expect(en, nom).not.toBe(nom);
      // Enregistré en anglais par l'éditeur, il revient en français en FR.
      expect(localizeAutomationName(en, 'fr'), en).toBe(nom);
    }
  });

  it('un nom donné par l’entreprise ne bouge pas, dans les deux langues', () => {
    expect(localizeAutomationName('Ma relance à moi', 'en')).toBe('Ma relance à moi');
    expect(localizeAutomationName('Ma relance à moi', 'fr')).toBe('Ma relance à moi');
  });
});
