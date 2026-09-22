/**
 * Maintien du cache 1 h de Lumi : on pinge seulement dans la foulée d'une
 * activité réelle, jamais dans le vide, et le ping vise exactement le préfixe
 * des vrais appels (même bloc stable, mêmes outils).
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('../server/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { doitPinger, fenetreMaintienMs, pingerCache, DELAI_RAFRAICHISSEMENT_MS, signalerAppelLumi, prefixesSuivis, MAX_PREFIXES_CHAUDS } from '../server/lib/lumi/cache-chaud';
import { outilsClaude, promptSystemeLumi } from '../server/lib/lumi/orchestrateur';

const MIN = 60_000;
const T0 = 10 * MIN; // instant du dernier appel réel (0 = « jamais »)
const fenetreMs = 120 * MIN;

describe('doitPinger', () => {
  it('aucun appel réel → jamais', () => {
    expect(doitPinger({ dernierAppelReel: 0, dernierPing: 0, maintenant: T0 + 50 * MIN, fenetreMs })).toBe(false);
  });
  it('moins de 50 min après un appel réel → non (le cache est encore chaud)', () => {
    expect(doitPinger({ dernierAppelReel: T0, dernierPing: 0, maintenant: T0 + 49 * MIN, fenetreMs })).toBe(false);
  });
  it('50 min après l appel réel → oui ; 50 min après le ping → encore oui', () => {
    expect(doitPinger({ dernierAppelReel: T0, dernierPing: 0, maintenant: T0 + 50 * MIN, fenetreMs })).toBe(true);
    expect(doitPinger({ dernierAppelReel: T0, dernierPing: T0 + 50 * MIN, maintenant: T0 + 60 * MIN, fenetreMs })).toBe(false);
    expect(doitPinger({ dernierAppelReel: T0, dernierPing: T0 + 50 * MIN, maintenant: T0 + 100 * MIN, fenetreMs })).toBe(true);
  });
  it('au-delà de la fenêtre → on laisse expirer (pas de ping dans le vide)', () => {
    expect(doitPinger({ dernierAppelReel: T0, dernierPing: T0 + 100 * MIN, maintenant: T0 + 150 * MIN, fenetreMs })).toBe(false);
  });
  it('fenêtre 0 → désactivé', () => {
    expect(doitPinger({ dernierAppelReel: T0, dernierPing: 0, maintenant: T0 + 50 * MIN, fenetreMs: 0 })).toBe(false);
  });
  it('DELAI_RAFRAICHISSEMENT_MS est sous le TTL d une heure', () => {
    expect(DELAI_RAFRAICHISSEMENT_MS).toBeLessThan(60 * MIN);
  });
});

describe('fenetreMaintienMs', () => {
  // 12 h depuis le 2026-09-22 : mesuré en prod, au-delà d'une heure sans
  // appel le cache est froid à 100 % (5,25 ¢ le tour contre 2,06 ¢), et une
  // fenêtre de 2 h ne couvrait pas la personne qui revient après le dîner.
  it('défaut 720 min (12 h), valeur lue, 0 désactive, valeur absurde → défaut', () => {
    expect(fenetreMaintienMs({})).toBe(720 * MIN);
    expect(fenetreMaintienMs({ LUMI_CACHE_CHAUD_MINUTES: '30' })).toBe(30 * MIN);
    expect(fenetreMaintienMs({ LUMI_CACHE_CHAUD_MINUTES: '0' })).toBe(0);
    expect(fenetreMaintienMs({ LUMI_CACHE_CHAUD_MINUTES: 'abc' })).toBe(720 * MIN);
  });
});

describe('pingerCache', () => {
  it('vise le même préfixe qu un vrai tour : bloc stable identique, mêmes outils, sortie minuscule', async () => {
    let params: any = null;
    const client = { messages: { create: async (p: any) => { params = p; return { usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 6700, cache_creation_input_tokens: 0 } } as any; } } };
    const r = await pingerCache(client, 'claude-sonnet-5');
    const reel = promptSystemeLumi({ companyName: 'Coquin lavage', userName: 'Will', language: 'fr', todayIso: '2026-09-16' });
    expect(params.model).toBe('claude-sonnet-5');
    expect(params.system[0]).toEqual(reel[0]);              // bloc stable + point de cache 1 h
    expect(params.tools).toEqual(outilsClaude());           // même ordre, même point de cache
    expect(params.max_tokens).toBeLessThanOrEqual(16);
    expect(params.thinking).toEqual({ type: 'adaptive' });  // les mêmes réglages qu'un vrai appel
    expect(r.cache_lu).toBe(6700);
    expect(r.cost_cents).toBeGreaterThan(0);
    expect(r.cost_cents).toBeLessThan(0.3);
  });
});

describe('signalerAppelLumi : un préfixe par jeu d outils', () => {
  it('suit le jeu de base et chaque sous-agent séparément, jamais plus de MAX_PREFIXES_CHAUDS', () => {
    const p = (n: string) => ({ systeme: [{ type: 'text' as const, text: n }], outils: [] });
    signalerAppelLumi('claude-sonnet-5', p('base'), 'base');
    signalerAppelLumi('claude-sonnet-5', p('facturation'), 'facturation');
    expect([...prefixesSuivis().keys()]).toEqual(['base', 'facturation']);
    for (let i = 0; i < MAX_PREFIXES_CHAUDS + 3; i++) signalerAppelLumi('claude-sonnet-5', p(`t${i}`), `t${i}`);
    expect(prefixesSuivis().size).toBe(MAX_PREFIXES_CHAUDS);
    expect(prefixesSuivis().has('base')).toBe(false); // le plus ancien est parti
  });
});
