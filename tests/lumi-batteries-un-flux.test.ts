/**
 * Les batteries jouées contre la PRODUCTION n'envoient qu'un flux à la fois.
 *
 * 2026-10-01, 20 h 36 → 21 h 41 UTC : la base de production n'a plus répondu pendant
 * 65 minutes. Tournaient alors, en même temps : cinq lots d'évaluation (cinq
 * conversations Lumi en parallèle), deux batteries du support et une conversation
 * longue. La base est sur une petite machine ; les journaux montrent des requêtes
 * banales à 12–19 secondes juste avant la coupure.
 *
 * Ce test fige ce qui a été changé : la commande `npm run test:lumi -- --prod` joue
 * ses lots l'un après l'autre et relit la santé de la base avant chacun.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');
const COMMANDE = lire('scripts/qa/lumi/test-lumi.mjs');
const etageProd = COMMANDE.slice(COMMANDE.indexOf('if (PROD) {'), COMMANDE.indexOf('// ── Sorties'));

describe('npm run test:lumi -- --prod : un seul flux contre la production', () => {
  it('aucun lancement en parallèle : ni Promise.all, ni processus détaché', () => {
    expect(etageProd.length).toBeGreaterThan(500);
    expect(COMMANDE).not.toContain('Promise.all');
    expect(COMMANDE).not.toMatch(/\bspawn\(/);
    expect(COMMANDE).toContain("import { spawnSync } from 'node:child_process';");
  });

  it('les lots d’évaluation se suivent, la santé de la base relue avant chacun', () => {
    const boucle = etageProd.slice(etageProd.indexOf('for (const l of lots) {'));
    expect(boucle.indexOf('if (!(await prodRepond(')).toBeGreaterThan(0);
    expect(boucle.indexOf('if (!(await prodRepond(')).toBeLessThan(boucle.indexOf("node('evals/lumi-tools/run.mts'"));
  });

  it('chaque batterie attend que la base réponde ; une base lente arrête tout ce qui suit', () => {
    expect(etageProd).toContain("if (!a('--sans-critiques') && await prodRepond('tests critiques')) {");
    expect(etageProd).toContain("!rapport.prod_lente && existsSync(join(RACINE, 'scripts/qa/lumi/robustesse/run.mts')) && await prodRepond('robustesse')");
    expect(etageProd).toContain("if (!a('--sans-evals') && !rapport.prod_lente) {");
  });

  it('une base lente ne rend jamais « PASS » : le verdict devient « non concluant » et le dit', () => {
    const garde = COMMANDE.slice(COMMANDE.indexOf('async function prodRepond('), COMMANDE.indexOf('function lancer('));
    expect(garde).toContain("fetch('https://lumecrm.net/api/health'");
    expect(garde).toContain("rapport.verdict = rapport.verdict === 'FAIL' ? 'FAIL' : 'NON CONCLUANT';");
    expect(garde).toContain("rien n'a été envoyé");
    expect(COMMANDE).toContain('const SEUIL_BASE_MS = Number(process.env.LUMI_SEUIL_BASE_MS ?? 1500);');
  });

  it('le lanceur d’une passe ne joue qu’une demande à la fois en production', () => {
    expect(lire('evals/lumi-tools/run.mts')).toContain("const PARALLELE = PROD ? 1 :");
  });
});
