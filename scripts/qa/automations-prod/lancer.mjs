/**
 * `npm run test:automations:e2e` — la section Automatisations, au vrai navigateur, sur le vrai site.
 *
 * Enchaîne les vérifications de ce dossier (une à la fois : un seul navigateur ouvert sur la prod),
 * dans le bureau de test en bac à sable. Écrit `resultats.json` et `RAPPORT.md` dans QA_SORTIES
 * (sinon le dossier temporaire) et sort en code 1 dès qu'une vérification échoue.
 *
 * À lancer APRÈS un déploiement qui touche les automatisations : c'est la preuve à l'écran. Ce qui
 * bloque un merge AVANT déploiement reste la CI (tests de composant et de route) ; une passe sur le
 * vrai site ne peut, par nature, juger que ce qui est déjà en ligne.
 *
 *   npm run test:automations:e2e              toutes les vérifications
 *   npm run test:automations:e2e -- tablette  seulement les fichiers dont le nom contient « tablette »
 */
import { spawn } from 'node:child_process';
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = dirname(fileURLToPath(import.meta.url));
const sorties = process.env.QA_SORTIES || join(tmpdir(), 'lume-qa-automations-prod');
mkdirSync(sorties, { recursive: true });
const filtre = process.argv[2];
const scripts = readdirSync(ici).filter((f) => /^\d\d-.*\.mjs$/.test(f)).filter((f) => !filtre || f.includes(filtre)).sort();
if (!scripts.length) { console.error('Aucune vérification ne correspond.'); process.exit(2); }

const lancer = (script) => new Promise((fini) => {
  const enfant = spawn(process.execPath, [join(ici, script)], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let sortie = '';
  enfant.stdout.on('data', (d) => { sortie += d; process.stdout.write(d); });
  enfant.stderr.on('data', (d) => { sortie += d; process.stderr.write(d); });
  // Une vérification qui ne rend pas la main en 10 minutes est comptée comme un échec.
  const garde = setTimeout(() => enfant.kill(), 10 * 60_000);
  enfant.on('close', (code) => { clearTimeout(garde); fini({ code, sortie }); });
});

const debut = new Date();
const resultats = [];
for (const script of scripts) {
  console.log(`\n── ${script} ──`);
  const { code, sortie } = await lancer(script);
  const lignes = sortie.split(/\r?\n/).filter((l) => /^[✓✗] /.test(l));
  const verifications = lignes.map((l) => ({ ok: l.startsWith('✓'), texte: l.slice(2).trim() }));
  // Un script qui plante avant d'avoir rien vérifié est un échec, pas un « 0 sur 0 ».
  if (code !== 0 || verifications.length === 0) {
    verifications.push({ ok: false, texte: `le script s’est arrêté (code ${code}) : ${sortie.trim().split(/\r?\n/).slice(-2).join(' / ').slice(0, 300)}` });
  }
  resultats.push({ script, code, verifications });
}

const toutes = resultats.flatMap((r) => r.verifications.map((v) => ({ script: r.script, ...v })));
const reussies = toutes.filter((v) => v.ok).length;
const bilan = { site: 'https://lumecrm.net', debut: debut.toISOString(), fin: new Date().toISOString(), total: toutes.length, reussies, echecs: toutes.length - reussies, resultats };
writeFileSync(join(sorties, 'resultats.json'), JSON.stringify(bilan, null, 2));

let md = `# Automatisations — vérifications sur le vrai site\n\n${debut.toISOString()} · ${reussies} / ${toutes.length} réussies\n`;
for (const r of resultats) {
  md += `\n## ${r.script}\n\n| | Vérification |\n|---|---|\n`;
  for (const v of r.verifications) md += `| ${v.ok ? '✓' : '✗'} | ${v.texte.replace(/\|/g, '/')} |\n`;
}
writeFileSync(join(sorties, 'RAPPORT.md'), md);
console.log(`\n${reussies} / ${toutes.length} réussies — ${join(sorties, 'RAPPORT.md')}`);
process.exit(reussies === toutes.length ? 0 : 1);
