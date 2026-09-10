/**
 * Outils différés de Lumi (tool search) — sur les VRAIS outils, sans mock.
 *
 * Mesuré le 2026-09-10 : 67 définitions = 13 128 tokens relus à chaque appel.
 * Seuls les outils du quotidien restent chargés ; les autres portent
 * defer_loading et sont découverts par tool_search_tool_regex.
 */
import { describe, it, expect } from 'vitest';
import { outilsClaude, OUTILS_DE_BASE, OUTIL_RECHERCHE } from '../server/lib/lumi/orchestrateur';
import { AGENT_TOOLS, TOOLS_BY_NAME } from '../server/lib/agent/tools';

const outils = outilsClaude() as any[];
const defs = outils.slice(1);
const charges = defs.filter((t) => !t.defer_loading);
const differes = defs.filter((t) => t.defer_loading === true);

describe('outils différés (tool search)', () => {
  it('la recherche est en tête et n est jamais différée (sinon 400 « all tools deferred »)', () => {
    expect(outils[0]).toEqual(OUTIL_RECHERCHE);
    expect(outils[0].defer_loading).toBeUndefined();
    expect(outils[0].type).toBe('tool_search_tool_regex_20251119');
  });

  it('chaque outil de l agent est envoyé exactement une fois, chargé ou différé', () => {
    expect(defs.map((t) => t.name).sort()).toEqual(AGENT_TOOLS.map((t) => t.declaration.name).sort());
    expect(charges.length + differes.length).toBe(defs.length);
    expect(new Set(charges.map((t) => t.name))).toEqual(new Set(OUTILS_DE_BASE));
  });

  it('le quotidien reste petit : au-delà, le contexte fixe regrossit pour toutes les orgs', () => {
    expect(charges.length).toBeLessThanOrEqual(15);
    expect(differes.length).toBeGreaterThan(40);
  });

  it('le point de cache est sur le DERNIER outil chargé, jamais sur un différé (400 API)', () => {
    expect(charges[charges.length - 1].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(charges.slice(0, -1).every((t) => !t.cache_control)).toBe(true);
    expect(differes.every((t) => !t.cache_control)).toBe(true);
  });

  it('chaque outil de base existe vraiment (une faute de frappe le ferait disparaître en silence)', () => {
    for (const nom of OUTILS_DE_BASE) expect(TOOLS_BY_NAME[nom], nom).toBeDefined();
  });

  it('une seule écriture reste chargée (créer un suivi) ; toute autre proposition passe par une recherche', () => {
    const ecrituresChargees = AGENT_TOOLS.filter((t) => t.kind === 'write' && OUTILS_DE_BASE.has(t.declaration.name)).map((t) => t.declaration.name);
    expect(ecrituresChargees).toEqual(['create_task']);
  });
});
