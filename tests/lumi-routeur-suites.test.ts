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
  it('le prompt du routeur impose action null sur une suite qui se rapporte au contexte', () => {
    expect(PROMPT_ROUTEUR).toContain('Suites de conversation');
    expect(PROMPT_ROUTEUR).toContain("« c'est qui le pire ? »");
    expect(PROMPT_ROUTEUR).toContain('« pis cette semaine ? » → planification, agenda, periode semaine');
  });
});

describe('effortDuSousAgent', () => {
  it('rapports et facturation en medium ; les autres suivent la règle stricte (low)', () => {
    expect(SOUS_AGENTS_COMPLEXES.has('rapports')).toBe(true);
    expect(effortDuSousAgent('rapports')).toBe('medium');
    expect(effortDuSousAgent('facturation')).toBe('medium');
    expect(effortDuSousAgent('planification')).toBe('low');
    expect(effortDuSousAgent(null)).toBe('low');
  });
});
