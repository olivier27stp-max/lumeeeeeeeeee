/**
 * accessibilite-mesure.mjs — compte, dans src/, ce que l'audit bloc 3
 * (2026-09-10, C4/C5) a relevé. Réutilisé par
 * tests/accessibilite-statique.test.ts (cliquet : les compteurs ne peuvent
 * que baisser) et à la main :
 *
 *   node scripts/accessibilite-mesure.mjs            → totaux
 *   node scripts/accessibilite-mesure.mjs --fichiers → détail par fichier
 *
 * Heuristiques par expression régulière sur le JSX — approximatives par
 * construction, mais stables : c'est la tendance qui compte.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export function fichiersSrc(racine) {
  const out = [];
  (function marche(d) {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) marche(p);
      else if (/\.tsx$/.test(e)) out.push(p);
    }
  })(join(racine, 'src'));
  return out;
}

/** Balise ouvrante complète à partir d'un index (gère les `>` dans les chaînes/accolades). */
function baliseOuvrante(src, i) {
  let prof = 0, j = i, guillemet = null;
  for (; j < src.length; j++) {
    const c = src[j];
    if (guillemet) { if (c === guillemet) guillemet = null; continue; }
    if (c === '"' || c === "'" || c === '`') { guillemet = c; continue; }
    if (c === '{') prof++;
    else if (c === '}') prof--;
    else if (c === '>' && prof === 0) return src.slice(i, j + 1);
  }
  return src.slice(i, j);
}

export function mesurerSource(src) {
  const m = { labelsSansHtmlFor: 0, champsSansNom: 0, divsCliquables: 0, boutonsIconeSansNom: 0, outlineNoneSansFocus: 0, imgSansAlt: 0 };

  // <label> sans htmlFor qui n'enveloppe pas son champ
  for (const x of src.matchAll(/<label\b/g)) {
    const tag = baliseOuvrante(src, x.index);
    if (/\bhtmlFor=/.test(tag)) continue;
    const fin = src.indexOf('</label>', x.index);
    const corps = fin === -1 ? '' : src.slice(x.index, fin);
    if (/<(input|select|textarea|Input|Select|Textarea)\b/.test(corps)) continue; // enveloppe le champ
    m.labelsSansHtmlFor++;
  }

  // Champs sans id, aria-label ni aria-labelledby (hors hidden)
  for (const x of src.matchAll(/<(input|select|textarea)\b/g)) {
    const tag = baliseOuvrante(src, x.index);
    if (/type=["']hidden["']/.test(tag)) continue;
    if (/\b(id|aria-label|aria-labelledby)=/.test(tag)) continue;
    // Enveloppé par un <label> ouvert juste avant ?
    const avant = src.slice(Math.max(0, x.index - 400), x.index);
    const dernierLabel = avant.lastIndexOf('<label');
    const dernierFerme = avant.lastIndexOf('</label>');
    if (dernierLabel !== -1 && dernierLabel > dernierFerme) continue;
    m.champsSansNom++;
  }

  // <div>/<span> cliquables sans rôle ni tabIndex
  for (const x of src.matchAll(/<(div|span|li|td|tr)\b/g)) {
    const tag = baliseOuvrante(src, x.index);
    if (!/\bonClick=/.test(tag)) continue;
    if (/\brole=/.test(tag) && /\btabIndex=/.test(tag)) continue;
    m.divsCliquables++;
  }

  // Boutons dont le contenu n'est qu'une icône, sans aria-label ni title
  for (const x of src.matchAll(/<button\b/g)) {
    const tag = baliseOuvrante(src, x.index);
    if (/\b(aria-label|aria-labelledby|title)=/.test(tag)) continue;
    const fin = src.indexOf('</button>', x.index + tag.length);
    if (fin === -1) continue;
    const contenu = src.slice(x.index + tag.length, fin).trim();
    // Uniquement un ou plusieurs éléments auto-fermants (icônes), aucun texte ni {expression}
    if (/^(<[A-Z][A-Za-z0-9.]*\b[^>]*\/>\s*)+$/.test(contenu)) m.boutonsIconeSansNom++;
  }

  // outline-none sans focus-visible dans la même classe
  for (const x of src.matchAll(/(className|class)=\{?["'`]([^"'`]*outline-none[^"'`]*)["'`]/g)) {
    if (!/focus-visible:/.test(x[2]) && !/focus:ring|focus:outline/.test(x[2])) m.outlineNoneSansFocus++;
  }

  // <img> sans alt
  for (const x of src.matchAll(/<img\b/g)) {
    const tag = baliseOuvrante(src, x.index);
    if (!/\balt=/.test(tag)) m.imgSansAlt++;
  }
  return m;
}

export function mesurer(racine) {
  const total = { labelsSansHtmlFor: 0, champsSansNom: 0, divsCliquables: 0, boutonsIconeSansNom: 0, outlineNoneSansFocus: 0, imgSansAlt: 0 };
  const parFichier = [];
  for (const f of fichiersSrc(racine)) {
    const m = mesurerSource(readFileSync(f, 'utf8'));
    const somme = Object.values(m).reduce((a, b) => a + b, 0);
    if (somme) parFichier.push({ fichier: relative(racine, f).split('\\').join('/'), ...m, somme });
    for (const k of Object.keys(total)) total[k] += m[k];
  }
  parFichier.sort((a, b) => b.somme - a.somme);
  return { total, parFichier };
}

if (process.argv[1] && /accessibilite-mesure\.mjs$/.test(process.argv[1])) {
  const { total, parFichier } = mesurer(process.cwd());
  console.log(JSON.stringify(total, null, 2));
  if (process.argv.includes('--fichiers')) {
    for (const f of parFichier) console.log(`${String(f.somme).padStart(4)}  ${f.fichier}  L${f.labelsSansHtmlFor} C${f.champsSansNom} D${f.divsCliquables} B${f.boutonsIconeSansNom} O${f.outlineNoneSansFocus} I${f.imgSansAlt}`);
  }
}
