/**
 * Vérifie le jeu de cas SANS appeler le modèle : schéma, identifiants uniques,
 * outil existant, paramètres attendus déclarés par l'outil, couverture
 * (3 cas par action sensible, 1 par autre action, 1 par lecture).
 *
 *   npx tsx evals/lumi-tools/valider.mts [--section facturation]
 */
import { chargerCas, type Cas } from './run.mts';
import { TOOLS_BY_NAME } from '../../server/lib/agent/tools';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ICI = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : ''; };
const SECTION = arg('--section');
const parSection = JSON.parse(readFileSync(join(ICI, 'outils-par-section.json'), 'utf8')) as Record<string, Array<{ nom: string; genre: string; sensible: boolean }>>;

const erreurs: string[] = [];
const cas = chargerCas().filter((c) => !SECTION || c.section === SECTION);
const ids = new Set<string>();
const parOutil = new Map<string, Cas[]>();

for (const c of cas) {
  const ou = `${c.id}`;
  if (!c.id || ids.has(c.id)) erreurs.push(`${ou} : id manquant ou en double`);
  ids.add(c.id);
  if (!['action', 'lecture', 'clarification'].includes(c.type)) erreurs.push(`${ou} : type inconnu`);
  if (!['fr', 'en'].includes(c.langue)) erreurs.push(`${ou} : langue inconnue`);
  if (!c.q || c.q.length < 8) erreurs.push(`${ou} : question vide`);
  if (!parSection[c.section]) erreurs.push(`${ou} : section inconnue ${c.section}`);
  // `outil` d'une clarification = l'outil dont le cas relève (pour la couverture), jamais proposé.
  const t = c.outil ? TOOLS_BY_NAME[c.outil] : null;
  if (!c.outil || !t) { erreurs.push(`${ou} : outil inconnu ${c.outil}`); continue; }
  if (c.type === 'action' && t.kind !== 'write') erreurs.push(`${ou} : ${c.outil} est une lecture, pas une action`);
  if (c.type === 'lecture' && t.kind !== 'read') erreurs.push(`${ou} : ${c.outil} est une écriture, pas une lecture`);
  const props = (t.declaration.parameters as any)?.properties ?? {};
  const toutesLesCles = new Set<string>();
  const parcourir = (p: any) => { for (const [k, v] of Object.entries(p ?? {})) { toutesLesCles.add(k); parcourir((v as any)?.properties); parcourir((v as any)?.items?.properties); } };
  parcourir(props);
  for (const k of Object.keys(c.params ?? {})) if (!toutesLesCles.has(k)) erreurs.push(`${ou} : paramètre ${k} non déclaré par ${c.outil}`);
  for (const i of c.interdits ?? []) if (!TOOLS_BY_NAME[i]) erreurs.push(`${ou} : interdit inconnu ${i}`);
  for (const v of c.voisins ?? []) if (!TOOLS_BY_NAME[v]) erreurs.push(`${ou} : voisin inconnu ${v}`);
  if (c.type === 'clarification' && c.params) erreurs.push(`${ou} : une clarification n'a pas de paramètres attendus`);
  if (!parOutil.has(c.outil)) parOutil.set(c.outil, []);
  parOutil.get(c.outil)!.push(c);
}

let attendu = 0;
for (const [section, outils] of Object.entries(parSection)) {
  if (SECTION && section !== SECTION) continue;
  for (const o of outils) {
    const n = o.genre === 'lecture' ? 1 : o.sensible ? 3 : 1;
    attendu += n;
    const liste = parOutil.get(o.nom) ?? [];
    if (liste.length < n) erreurs.push(`couverture : ${o.nom} (${section}) a ${liste.length} cas, il en faut ${n}`);
    if (o.sensible && o.genre !== 'lecture' && liste.length) {
      if (!liste.some((c) => c.langue === 'en')) erreurs.push(`couverture : ${o.nom} — aucun cas en anglais`);
      if (!liste.some((c) => c.type === 'clarification' || (c.interdits ?? []).length)) erreurs.push(`couverture : ${o.nom} — aucun cas de désambiguïsation ou de clarification`);
      if (liste.some((c) => !c.sensible)) erreurs.push(`couverture : ${o.nom} — cas sans « sensible: true »`);
    }
  }
}

console.log(`${cas.length} cas (attendus ${attendu})${SECTION ? ` — section ${SECTION}` : ''}`);
if (erreurs.length) { console.log(erreurs.join('\n')); process.exit(1); }
console.log('OK');
