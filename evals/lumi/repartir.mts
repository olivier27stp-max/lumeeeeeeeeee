/**
 * Répartit les cas préparés d'un compte en N lots, pour N comptes en parallèle
 * (la prod limite Lumi à 60 tours par heure et par personne).
 *
 * Les cas d'un même fichier restent mélangés entre les lots (tourniquet) : chaque
 * lot voit toutes les catégories, donc les sous-agents se réchauffent pareil.
 * Ni base ni réseau.
 *
 *   npx tsx evals/lumi/repartir.mts --source evals/lumi/cas-resolus/proprietaire --lots 4
 *   → evals/lumi/cas-resolus/proprietaire-lot1 … -lot4 (un fichier `cas.json` par lot)
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const arg = (nom: string, defaut = '') => { const i = process.argv.indexOf(`--${nom}`); return i >= 0 ? (process.argv[i + 1] ?? defaut) : defaut; };
const source = arg('source');
const n = Math.max(1, Number(arg('lots', '4')) || 4);
if (!source) throw new Error('--source <dossier des cas préparés> requis');

const cas: unknown[] = [];
for (const f of readdirSync(source).filter((x) => x.endsWith('.json')).sort()) {
  const contenu = JSON.parse(readFileSync(join(source, f), 'utf8')) as unknown;
  if (!Array.isArray(contenu)) throw new Error(`${f} : un tableau de cas est attendu`);
  cas.push(...contenu);
}
const lots: unknown[][] = Array.from({ length: n }, () => []);
cas.forEach((c, i) => lots[i % n].push(c));
lots.forEach((lot, i) => {
  const dossier = `${source}-lot${i + 1}`;
  rmSync(dossier, { recursive: true, force: true });
  mkdirSync(dossier, { recursive: true });
  writeFileSync(join(dossier, 'cas.json'), JSON.stringify(lot, null, 2));
  console.log(`${dossier} : ${lot.length} cas`);
});
console.log(`${cas.length} cas répartis en ${n} lots.`);
