/**
 * Étages 3 et 4 — cache exact et cache sémantique (items 13 et 15).
 * - la clé d'un cache de données client contient l'org ET la personne ;
 *   deux orgs avec la même question ne se voient jamais (le seul endroit du
 *   système où une fuite inter-tenant serait possible) ;
 * - une écriture d'agent invalide (version d'org) ; TTL court ;
 * - seuls les tours cachables sont mémorisés (premier message, lecture seule,
 *   pas de proposition) ; le repli oublie ;
 * - le seuil sémantique laisse passer une paraphrase et refuse une autre question.
 * Magasin en mémoire injecté : aucune base, aucun réseau.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../server/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { magasinPourTests } from '../server/lib/lumi/magasin';
import { cleReponse, lireReponse, ecrireReponse, retirerReponse, invaliderOrg, versionOrg, tourCachable, TTL_REPONSE_S } from '../server/lib/lumi/cache-reponses';
import { cleIndex, cosinus, meilleure, chercherSemantique, memoriserSemantique, oublierSemantique, SEUIL_SIMILARITE, embed } from '../server/lib/lumi/cache-semantique';

const lu = (p: string) => readFileSync(resolve(__dirname, '..', ...p.split('/')), 'utf8');
let m: ReturnType<typeof magasinPourTests>;
beforeEach(() => { m = magasinPourTests(); });

describe('cache exact (étage 3)', () => {
  it('la clé porte l org, la personne et la version ; un autre tenant ou une autre personne = une autre clé', () => {
    const a = cleReponse({ orgId: 'org-A', userId: 'u1', enonce: 'Ai-je des jobs en retard ?', version: 3 });
    expect(a).toMatch(/^lumi:rep:org-A:u1:[0-9a-f]{32}$/);
    expect(cleReponse({ orgId: 'org-B', userId: 'u1', enonce: 'Ai-je des jobs en retard ?', version: 3 })).not.toBe(a);
    expect(cleReponse({ orgId: 'org-A', userId: 'u2', enonce: 'Ai-je des jobs en retard ?', version: 3 })).not.toBe(a);
    expect(cleReponse({ orgId: 'org-A', userId: 'u1', enonce: 'Ai-je des jobs en retard ?', version: 4 })).not.toBe(a);
    // Même énoncé à la ponctuation près = même clé.
    expect(cleReponse({ orgId: 'org-A', userId: 'u1', enonce: 'ai je des jobs en retard', version: 3 })).toBe(a);
  });
  it('deux orgs, même question : chacune ne voit que sa réponse', async () => {
    await ecrireReponse({ orgId: 'org-A', userId: 'u1', enonce: 'mes jobs en retard' }, { texte: 'A : 2 jobs', fiches: [], outils: ['list_jobs'] });
    await ecrireReponse({ orgId: 'org-B', userId: 'u1', enonce: 'mes jobs en retard' }, { texte: 'B : aucun', fiches: [], outils: ['list_jobs'] });
    expect((await lireReponse({ orgId: 'org-A', userId: 'u1', enonce: 'mes jobs en retard' }))?.texte).toBe('A : 2 jobs');
    expect((await lireReponse({ orgId: 'org-B', userId: 'u1', enonce: 'mes jobs en retard' }))?.texte).toBe('B : aucun');
    expect(await lireReponse({ orgId: 'org-C', userId: 'u1', enonce: 'mes jobs en retard' })).toBeNull();
    expect(await lireReponse({ orgId: 'org-A', userId: 'u2', enonce: 'mes jobs en retard' })).toBeNull();
  });
  it('une écriture d agent invalide tout pour l org ; le repli retire l entrée ; TTL de 60 s', async () => {
    const p = { orgId: 'org-A', userId: 'u1', enonce: 'mes jobs en retard' };
    await ecrireReponse(p, { texte: 'x', fiches: [], outils: [] });
    expect(await lireReponse(p)).not.toBeNull();
    await invaliderOrg('org-A');
    expect(await versionOrg('org-A')).toBe(1);
    expect(await lireReponse(p)).toBeNull();
    await ecrireReponse(p, { texte: 'y', fiches: [], outils: [] });
    await retirerReponse(p);
    expect(await lireReponse(p)).toBeNull();
    expect(TTL_REPONSE_S).toBe(60);
  });
  it('tourCachable : premier message, lecture seule, texte, sans proposition', () => {
    const base = { historiqueVide: true, texte: '3 jobs en retard.', outils: ['list_jobs'], proposition: false, resultat: 'ok' };
    expect(tourCachable(base)).toBe(true);
    expect(tourCachable({ ...base, historiqueVide: false })).toBe(false);
    expect(tourCachable({ ...base, proposition: true })).toBe(false);
    // Écriture exécutée d'office (remember_this, mode argent) : jamais en cache.
    expect(tourCachable({ ...base, ecritureExecutee: true })).toBe(false);
    // Un énoncé de mémoire (« retiens que… ») n'est jamais une lecture, quoi qu'ait fait le tour.
    expect(tourCachable({ ...base, enonce: 'Retiens que je ne travaille jamais le dimanche.' })).toBe(false);
    expect(tourCachable({ ...base, enonce: 'Oublie ça' })).toBe(false);
    // Une demande de document non plus (« un rapport des jobs » ≠ « combien de jobs »).
    expect(tourCachable({ ...base, enonce: "Un rapport des jobs de cette semaine, s'il te plaît." })).toBe(false);
    expect(tourCachable({ ...base, enonce: 'Sors-moi un PDF de mes retards' })).toBe(false);
    expect(tourCachable({ ...base, enonce: 'Combien de clients ai-je ?' })).toBe(true);
    expect(tourCachable({ ...base, outils: ['list_jobs', 'create_task'] })).toBe(false);
    expect(tourCachable({ ...base, texte: '  ' })).toBe(false);
    expect(tourCachable({ ...base, resultat: 'erreur' })).toBe(false);
  });
  it('le magasin refuse une clé hors préfixe (garde contre une clé sans tenant)', async () => {
    await expect(m.set('autre:cle', 1, 10)).rejects.toThrow(/hors préfixe/);
  });
});

describe('cache sémantique (étage 4)', () => {
  const v = (x: number, y: number) => [x, y, ...new Array(254).fill(0)];
  it('clé d index : tenant = org + personne ; public = partagé', () => {
    expect(cleIndex({ genre: 'tenant', orgId: 'org-A', userId: 'u1' })).toBe('lumi:sem:org-A:u1');
    expect(cleIndex({ genre: 'public' })).toBe('lumi:sem:public');
  });
  it('cosinus et seuil : paraphrase acceptée, autre question refusée, version différente ignorée', () => {
    expect(SEUIL_SIMILARITE).toBe(0.92);
    expect(cosinus(v(1, 0), v(1, 0))).toBeCloseTo(1);
    const index = [{ enonce: 'jobs en retard', vec: v(1, 0), texte: 'R', fiches: [], outils: [], version: 2, ts: 0 }];
    expect(meilleure(index, v(0.99, 0.14), 2)?.entree.texte).toBe('R'); // ≈ 0,99
    expect(meilleure(index, v(0.8, 0.6), 2)).toBeNull();                  // 0,8 < seuil
    expect(meilleure(index, v(1, 0), 3)).toBeNull();                      // version périmée
    expect(meilleure(index, v(1, 0), null)?.entree.texte).toBe('R');       // public : pas de version
  });
  it('deux orgs, même vecteur : isolation stricte ; le repli oublie ; borne de 200 entrées', async () => {
    const A = { genre: 'tenant' as const, orgId: 'org-A', userId: 'u1' };
    const B = { genre: 'tenant' as const, orgId: 'org-B', userId: 'u1' };
    await memoriserSemantique(A, { enonce: 'ai-je des jobs en retard', vec: v(1, 0), texte: 'A', fiches: [], outils: [], version: 0 });
    expect((await chercherSemantique(A, v(1, 0), 0))?.entree.texte).toBe('A');
    expect(await chercherSemantique(B, v(1, 0), 0)).toBeNull();
    expect(await chercherSemantique({ genre: 'tenant', orgId: 'org-A', userId: 'u2' }, v(1, 0), 0)).toBeNull();
    await oublierSemantique(A, 'Ai-je des jobs en retard ?');
    expect(await chercherSemantique(A, v(1, 0), 0)).toBeNull();
    for (let i = 0; i < 205; i++) await memoriserSemantique(A, { enonce: `q${i}`, vec: v(1, i / 1000), texte: `${i}`, fiches: [], outils: [], version: 0 });
    expect(((await m.get<any[]>('lumi:sem:org-A:u1')) ?? []).length).toBe(200);
  });
  it('embed : null sans clé Gemini ou sur réponse inattendue, jamais d exception', async () => {
    const mauvais = (async () => ({ ok: true, json: async () => ({ embedding: { values: [1, 2] } }) })) as unknown as typeof fetch;
    expect(await embed('x', mauvais)).toBeNull();
    const casse = (async () => { throw new Error('réseau'); }) as unknown as typeof fetch;
    expect(await embed('x', casse)).toBeNull();
  });
});

describe('branchement', () => {
  it('Lumi : étages 3-4 seulement au premier message, jamais après un repli ; mémorisation seulement si cachable ; done porte l étage', () => {
    const r = lu('server/routes/lumi.ts');
    expect(r).toContain('const premierMessage = historique.length === 0 && !enAttente.length && !repli;');
    expect(r).toContain('tourCachable({ historiqueVide: opts.cache.historiqueVide');
    expect(r).toContain("action: etage === ETAGE.cacheReponse ? 'cache-exact' : 'cache-semantique'");
    expect(r).toContain('void retirerReponse({ orgId: ctx.auth.orgId, userId: ctx.auth.user.id, enonce: enoncePrecedent });');
    expect((r.match(/etage: ETAGE\.(agent|interface|raccourci)|etage: raccourci\.etage|etage \}\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
    // Toute écriture d'agent invalide les caches de l'org.
    const te = lu('server/lib/agent/tools-etendus.ts');
    expect(te).toContain('void invaliderOrg(ctx.orgId);');
  });
  it('agent public : index partagé seulement (aucun tenant), après les réponses fixes', () => {
    const s = lu('server/routes/sales-chat.ts');
    expect(s).toContain("chercherSemantique({ genre: 'public' }, vecteur, null)");
    expect(s).not.toMatch(/genre: 'tenant'/);
    expect(s.indexOf('reponseFixePour(dernier)')).toBeLessThan(s.indexOf("chercherSemantique({ genre: 'public' }"));
  });
});
