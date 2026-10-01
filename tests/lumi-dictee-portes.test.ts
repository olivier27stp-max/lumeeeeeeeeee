/**
 * La dictée (le micro de Lumi) obéit aux mêmes portes que Lumi.
 *
 * Inventaire S7, 2026-10-01 : POST /api/agent/transcribe était ouverte à tout
 * compte connecté — forfait sans Lumi, rôle sans Lumi, crédits à zéro — et
 * bornée seulement par un plafond commun à toute la plateforme.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');
const PERMS = lire('server/lib/route-permissions.ts');
const ROUTE = lire('server/routes/agent.ts');
const handler = ROUTE.slice(ROUTE.indexOf("router.post('/agent/transcribe'"), ROUTE.indexOf("router.post('/agent/chat'"));

describe('portes de la dictée', () => {
  it('le droit Lumi (page Rôles) est exigé', () => {
    expect(PERMS).toContain("'POST /api/agent/transcribe': 'external_agent.use'");
  });

  it('une limite par PERSONNE, qui tient même sans Redis', () => {
    expect(ROUTE).toContain("redisRateLimit({ preset: 'lumi', keyFn: (req) => `voix:${userKey(req)}`, repliMemoire: true })");
    expect(handler).toMatch(/^router\.post\('\/agent\/transcribe', limiteDictee, validate\(agentTranscribeSchema\)/);
  });

  it('forfait sans Lumi → 403, crédits épuisés → 402 — AVANT tout appel de transcription', () => {
    const plan = handler.indexOf("code: 'plan_sans_lumi'");
    const epuise = handler.indexOf("code: 'quota_epuise'");
    const appel = handler.indexOf('transcribeAudioAvecUsage(');
    const compte = handler.indexOf("ajouterAppel('voix')");
    expect(plan).toBeGreaterThan(0);
    expect(epuise).toBeGreaterThan(plan);
    expect(appel).toBeGreaterThan(epuise);
    // Un appel refusé ne consomme pas le plafond commun.
    expect(compte).toBeGreaterThan(epuise);
    expect(handler).toContain('if (!budget.includes_ai)');
    expect(handler).toContain("if (budget.palier === 'epuise')");
    expect(handler).toContain('res.status(403)');
    expect(handler).toContain('res.status(402)');
  });

  it('les refus parlent de crédits, jamais de dollars', () => {
    const messages = [...handler.matchAll(/error: fr \? '([^']+)' : '([^']+)'/g)].flatMap((m) => [m[1], m[2]]);
    expect(messages.length).toBeGreaterThanOrEqual(4);
    for (const m of messages) expect(m).not.toMatch(/\$|dollar/i);
  });
});
