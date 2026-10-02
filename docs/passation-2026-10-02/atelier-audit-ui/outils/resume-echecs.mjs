// Résume les échecs d'une passe Playwright à partir des dossiers de résultats (error-context.md).
//   node resume-echecs.mjs <dossier resultats> [filtre de nom]
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const racine = process.argv[2];
const filtre = process.argv[3] ?? '';
const lignes = [];
for (const d of readdirSync(racine).sort()) {
  const f = join(racine, d, 'error-context.md');
  if (!existsSync(f)) continue;
  const t = readFileSync(f, 'utf8');
  const nom = (t.match(/^- Name: (.*)$/m)?.[1] ?? d).trim();
  if (filtre && !nom.includes(filtre) && !d.includes(filtre)) continue;
  const lieu = (t.match(/^- Location: (.*)$/m)?.[1] ?? '').trim();
  const debut = t.indexOf('# Error details');
  const fin = t.indexOf('# Page snapshot') > 0 ? t.indexOf('# Page snapshot') : t.indexOf('# Test source');
  const erreur = t.slice(debut + 15, fin > debut ? fin : debut + 1500).replace(/```/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const utile = erreur.filter((l) => !/^(Call log:|- waiting for|- Expect "|\d+ × )/.test(l)).slice(0, 7).map((l) => l.slice(0, 260));
  lignes.push({ nom, lieu, defaut: nom.includes('@defaut'), utile });
}
const parFichier = new Map();
for (const l of lignes) {
  const fichier = l.nom.split(' >> ')[0];
  if (!parFichier.has(fichier)) parFichier.set(fichier, []);
  parFichier.get(fichier).push(l);
}
console.log(`# ${lignes.length} échecs (${lignes.filter((l) => l.defaut).length} marqués @defaut)\n`);
for (const [fichier, ls] of parFichier) {
  console.log(`## ${fichier} — ${ls.length}`);
  for (const l of ls) {
    console.log(`- ${l.defaut ? '[@defaut] ' : '[SANS marque] '}${l.nom.split(' >> ').slice(1).join(' › ')}  (${l.lieu.split(/[\\/]/).pop()})`);
    for (const u of l.utile) console.log(`    ${u}`);
  }
  console.log('');
}
