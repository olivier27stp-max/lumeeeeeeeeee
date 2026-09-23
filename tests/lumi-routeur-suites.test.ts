/**
 * Suites de conversation au routeur (contexte tronqué) et effort de réflexion
 * par sous-agent (qualité : rapports et analyse financière en medium).
 */
import { describe, it, expect } from 'vitest';
import { messageRouteur, PROMPT_ROUTEUR } from '../server/lib/lumi/routeur';
import { effortDuSousAgent, SOUS_AGENTS_COMPLEXES } from '../server/lib/lumi/sous-agents';

describe('messageRouteur', () => {
  it('sans contexte : l énoncé seul, borné à 1 000 caractères', () => {
    expect(messageRouteur('chu tu occupé demain ?')).toBe('chu tu occupé demain ?');
    expect(messageRouteur('x'.repeat(2000))).toHaveLength(1000);
  });
  it('avec contexte : l échange précédent tronqué (300 / 400) puis le message', () => {
    const m = messageRouteur('pis cette semaine ?', { utilisateur: 'u'.repeat(500), lumi: 'l'.repeat(900) });
    expect(m).toMatch(/^Échange précédent — utilisateur : « u{300} » ; Lumi : « l{400} »/);
    expect(m).toContain('Message à classer : « pis cette semaine ? »');
  });
  it('une suite qui se rapporte au contexte garde le TOPIC précédent', () => {
    // Depuis l'élagage du 2026-09-22, le routeur ne rend plus d'action :
    // il ne classe qu'un topic (mesuré : 0 action reconnue sur 46 verdicts,
    // 0 tour servi à l'étage 5, alors que le topic sert 22 fois sur 46).
    // Une suite doit donc rester sur le sujet de l'échange précédent.
    expect(PROMPT_ROUTEUR).toContain('Suites de conversation');
    expect(PROMPT_ROUTEUR).toContain("« c'est qui le pire ? »");
    expect(PROMPT_ROUTEUR).toContain("garde le topic de l'échange précédent");
    expect(PROMPT_ROUTEUR).toContain('« pis cette semaine ? »');
  });

  it('le prompt ne demande plus aucune action (elles n\'ont jamais servi)', () => {
    expect(PROMPT_ROUTEUR).toContain('action = null TOUJOURS');
    // Le catalogue d'actions a disparu : ces identifiants n'y sont plus décrits.
    expect(PROMPT_ROUTEUR).not.toContain('- clients-total :');
    expect(PROMPT_ROUTEUR).not.toContain('- devis-attente :');
    // …ni la grammaire d'extraction (en sommeil, code aval intact).
    expect(PROMPT_ROUTEUR).not.toContain('Extraction (champ');
  });

  it('reste au-dessus du minimum cachable de Haiku 4.5', () => {
    // 4 096 tokens : EN DESSOUS, le cache ne se crée pas — sans erreur, sans
    // signal. Chaque appel repaierait le prompt au plein tarif. La marge est
    // vérifiée ici en caractères (≈ 3,5 par token) pour rester hors ligne.
    expect(PROMPT_ROUTEUR.length).toBeGreaterThan(4096 * 3.5);
  });
});

describe('effortDuSousAgent', () => {
  it('rapports en medium ; les autres suivent la règle stricte (low) — facturation en medium perdait des actions et doublait le coût', () => {
    expect(SOUS_AGENTS_COMPLEXES.has('rapports')).toBe(true);
    expect(effortDuSousAgent('rapports')).toBe('medium');
    expect(effortDuSousAgent('facturation')).toBe('low');
    expect(effortDuSousAgent('planification')).toBe('low');
    expect(effortDuSousAgent(null)).toBe('low');
  });
});
