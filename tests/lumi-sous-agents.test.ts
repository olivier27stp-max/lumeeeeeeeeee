/**
 * Sous-agents (audit Lumi B7) : un topic sûr du routeur = un jeu d'outils
 * court, cache par topic, bloc stable inchangé.
 */
import { describe, it, expect } from 'vitest';
import { outilsDuSousAgent, sousAgentDepuisVerdict, focusDuSousAgent, estSousAgent, OUTILS_TRANSVERSES } from '../server/lib/lumi/sous-agents';
import { outilsClaude, OUTILS_DE_BASE, promptSystemeLumi } from '../server/lib/lumi/orchestrateur';
import { TOPICS } from '../server/lib/lumi/topics';
import { TOOLS_BY_NAME } from '../server/lib/agent/tools';

describe('outilsDuSousAgent', () => {
  it('chaque sous-agent charge ses outils + les transverses, tous existants, entre 5 et 25', () => {
    for (const t of TOPICS.filter((x) => estSousAgent(x.id))) {
      const noms = outilsDuSousAgent(t.id);
      for (const n of noms) expect(TOOLS_BY_NAME[n], `${t.id}: ${n}`).toBeDefined();
      for (const n of OUTILS_TRANSVERSES) expect(noms).toContain(n);
      expect(noms.length).toBeGreaterThanOrEqual(5);
      expect(noms.length).toBeLessThanOrEqual(25);
      expect(new Set(noms).size).toBe(noms.length);
    }
  });
  it('hors_scope et multi ne sont pas des sous-agents', () => {
    expect(estSousAgent('hors_scope')).toBe(false);
    expect(estSousAgent('multi')).toBe(false);
    expect(estSousAgent(null)).toBe(false);
  });
});

describe('outilsClaude(sousAgent)', () => {
  it('facturation : seuls ses outils sont chargés, le reste est différé, point de cache sur le dernier chargé', () => {
    const outils = outilsClaude('facturation') as any[];
    const charges = outils.filter((t) => t.type !== 'tool_search_tool_regex_20251119' && !t.defer_loading);
    const differes = outils.filter((t) => t.defer_loading === true);
    expect(new Set(charges.map((t) => t.name))).toEqual(new Set(outilsDuSousAgent('facturation')));
    expect(charges.map((t) => t.name)).toContain('get_overdue_payments');
    expect(charges.map((t) => t.name)).not.toContain('query_schedule'); // planification, différé
    expect(differes.map((t) => t.name)).toContain('query_schedule');
    expect(charges[charges.length - 1].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(charges.slice(0, -1).every((t) => !t.cache_control)).toBe(true);
    // Le jeu de base (sans sous-agent) est inchangé.
    const base = (outilsClaude() as any[]).filter((t) => t.type !== 'tool_search_tool_regex_20251119' && !t.defer_loading);
    expect(new Set(base.map((t) => t.name))).toEqual(new Set(OUTILS_DE_BASE));
  });
  it('ordre stable : deux appels donnent le même préfixe (cache)', () => {
    expect(JSON.stringify(outilsClaude('planification'))).toBe(JSON.stringify(outilsClaude('planification')));
  });
});

describe('sousAgentDepuisVerdict', () => {
  const base = { statut: 'ok' as const, decision: 'modele' as const, duree_ms: 1 };
  it('topic sûr sans action → sous-agent ; action, doute, multi, hors scope, erreur → aucun', () => {
    expect(sousAgentDepuisVerdict({ ...base, verdict: { topic: 'facturation', action: null, params: {}, confidence: 0.9 } })).toBe('facturation');
    expect(sousAgentDepuisVerdict({ ...base, verdict: { topic: 'facturation', action: null, params: {}, confidence: 0.6 } })).toBeNull();
    expect(sousAgentDepuisVerdict({ ...base, decision: 'action', verdict: { topic: 'facturation', action: 'retards', params: {}, confidence: 0.95 } })).toBeNull();
    expect(sousAgentDepuisVerdict({ ...base, verdict: { topic: 'multi', action: null, params: {}, confidence: 0.95 } })).toBeNull();
    expect(sousAgentDepuisVerdict({ ...base, verdict: { topic: 'hors_scope', action: null, params: {}, confidence: 0.95 } })).toBeNull();
    expect(sousAgentDepuisVerdict({ ...base, statut: 'erreur', verdict: null })).toBeNull();
    expect(sousAgentDepuisVerdict(null)).toBeNull();
  });
});

describe('focus dans le bloc variable seulement', () => {
  it('le bloc stable ne change pas avec un sous-agent ; le sujet est dans le bloc variable', () => {
    const ctx = { companyName: 'Coquin lavage', userName: 'Will', language: 'fr' as const, todayIso: '2026-09-16' };
    const sans = promptSystemeLumi(ctx);
    const avec = promptSystemeLumi({ ...ctx, focus: focusDuSousAgent('facturation', 'fr') });
    expect(avec[0].text).toBe(sans[0].text);
    expect(avec[1].text).toContain('Sujet de ce tour');
    expect(avec[1].text).toContain('tool_search_tool_regex');
    expect(sans[1].text).not.toContain('Sujet de ce tour');
    expect(focusDuSousAgent('planification', 'en')).toMatch(/^Topic of this turn/);
  });
});
