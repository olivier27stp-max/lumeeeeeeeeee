/**
 * Lit les constats de l'audit (docs/audits/outils-lumi/*.md) : une ligne de
 * tableau = un constat, rattaché aux outils cités dans sa colonne « Outil ».
 * La sévérité vient de la colonne « Sévérité » ou du titre de section.
 *   npx tsx scripts/audit/constats-outils-lumi.mts [--json sortie.json]
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TOOLS_BY_NAME } from '../../server/lib/agent/tools';

const RACINE = resolve(import.meta.dirname, '../..');
const DOSSIER = resolve(RACINE, 'docs/audits/outils-lumi');
const NOMS = Object.keys(TOOLS_BY_NAME).sort((a, b) => b.length - a.length);

export interface Constat { fichier: string; ligne: number; severite: string; outils: string[]; constat: string; correction: string; texte: string }

const SEV: Array<[RegExp, string]> = [[/critique/i, 'critique'], [/[ée]lev[ée]/i, 'élevé'], [/moyen/i, 'moyen'], [/\bbas\b|faible|mineur/i, 'bas']];
const severiteDe = (t: string) => SEV.find(([r]) => r.test(t))?.[1] ?? null;

export function lireConstats(): Constat[] {
  const out: Constat[] = [];
  for (const f of readdirSync(DOSSIER).filter((x) => x.endsWith('.md')).sort()) {
    const lignes = readFileSync(resolve(DOSSIER, f), 'utf8').split(/\r?\n/);
    let severiteSection = 'moyen';
    let entete: string[] = [];
    lignes.forEach((l, i) => {
      if (/^#{2,4}\s/.test(l)) { severiteSection = severiteDe(l) ?? severiteSection; return; }
      if (!l.startsWith('|')) { entete = l.trim() ? entete : []; return; }
      const cellules = l.split('|').slice(1, -1).map((c) => c.trim());
      if (cellules.every((c) => /^:?-+:?$/.test(c))) return;
      if (!entete.length) { entete = cellules.map((c) => c.toLowerCase()); return; }
      const col = (nom: RegExp) => { const k = entete.findIndex((e) => nom.test(e)); return k > -1 ? cellules[k] ?? '' : ''; };
      const outilsTexte = col(/outil|action|domaine/);
      const outils = NOMS.filter((n) => new RegExp(`(^|[^a-z_])${n}([^a-z_]|$)`).test(outilsTexte));
      out.push({
        fichier: f, ligne: i + 1,
        severite: severiteDe(col(/s[ée]v[ée]rit[ée]/)) ?? severiteSection,
        outils, constat: col(/constat|probl|bug/), correction: col(/correction|fix/), texte: l,
      });
    });
  }
  return out;
}

if (process.argv[1] && /constats-outils-lumi\.mts$/.test(process.argv[1])) {
  const c = lireConstats();
  const i = process.argv.indexOf('--json');
  if (i > 0) writeFileSync(process.argv[i + 1], JSON.stringify(c, null, 1));
  const parSev: Record<string, number> = {};
  for (const x of c) parSev[x.severite] = (parSev[x.severite] ?? 0) + 1;
  console.log(`${c.length} constats`, parSev, `sans outil reconnu : ${c.filter((x) => !x.outils.length).length}`);
}
