// Résumé d'un resultats.json de Playwright : node resume.mjs <fichier.json> [longueur]
import { readFileSync } from 'node:fs';
const r = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const lon = Number(process.argv[3] || 900);
const out = [];
const walk = (s, fichier) => {
  for (const sp of s.specs || []) for (const t of sp.tests) {
    const res = t.results[t.results.length - 1];
    out.push({ fichier: fichier || s.file, titre: sp.title, statut: res?.status, duree: res?.duration,
      erreurs: (res?.errors || []).map((e) => (e.message || '').replace(/\u001b\[[0-9;]*m/g, '').slice(0, lon)) });
  }
  for (const c of s.suites || []) walk(c, fichier || s.file);
};
r.suites.forEach((s) => walk(s, s.file));
for (const o of out) console.log(`${o.statut === 'passed' ? 'OK ' : 'XX '} ${Math.round((o.duree || 0) / 1000)}s  ${o.titre}`);
console.log('');
for (const o of out.filter((x) => x.statut !== 'passed')) {
  console.log('──', o.titre);
  for (const e of o.erreurs) console.log(e.split('\n').slice(0, 14).join('\n'), '\n');
}
console.log(`${out.filter((x) => x.statut === 'passed').length} verts / ${out.length}`);
