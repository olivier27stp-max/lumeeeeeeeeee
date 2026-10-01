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
 * PRUDENCE SUR LA PROD (leçon du 2026-10-01, où la base est tombée pendant des batteries de tests) :
 * un script à la fois, vingt secondes de pause entre deux (QA_PAUSE_MS), santé de la prod relue avant
 * chacun ; au premier 429 ou dès que la base dépasse 1 500 ms, la passe S'ARRÊTE (code 2) et nomme ce
 * qui n'a pas tourné. Ne jamais la lancer pendant qu'une autre batterie tourne contre la prod.
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

/** La prod répond-elle normalement ? (même règle que `santeProd` de l'outillage, sans ouvrir de client.) */
const prodSaine = async () => {
  try {
    const r = await fetch('https://lumecrm.net/api/health', { signal: AbortSignal.timeout(10_000) });
    const j = await r.json().catch(() => null);
    return r.ok && Number(j?.db_ms ?? 0) <= 1500;
  } catch { return false; }
};
const PAUSE_MS = Number(process.env.QA_PAUSE_MS ?? 20_000);

const debut = new Date();
const resultats = [];
let interrompue = null;
for (const [rang, script] of scripts.entries()) {
  /*
   * UNE vérification à la fois, avec une pause, et seulement si la prod va bien. Le 2026-10-01 cette
   * passe a enchaîné dix scripts sans pause pendant que la base de prod s'effondrait ; elle s'arrête
   * maintenant à la première alerte et dit pourquoi, au lieu de continuer à charger des pages.
   */
  if (rang > 0) await new Promise((r) => setTimeout(r, PAUSE_MS));
  if (!(await prodSaine())) { interrompue = `la prod ne répond pas normalement avant ${script}`; break; }
  console.log(`\n── ${script} ──`);
  const { code, sortie } = await lancer(script);
  if (/\b429\b|ARRÊT : la (prod|base)/.test(sortie)) interrompue = `limite de débit ou prod en difficulté pendant ${script}`;
  const lignes = sortie.split(/\r?\n/).filter((l) => /^[✓✗] /.test(l));
  const verifications = lignes.map((l) => ({ ok: l.startsWith('✓'), texte: l.slice(2).trim() }));
  // Un script qui plante avant d'avoir rien vérifié est un échec, pas un « 0 sur 0 ».
  if (code !== 0 || verifications.length === 0) {
    verifications.push({ ok: false, texte: `le script s’est arrêté (code ${code}) : ${sortie.trim().split(/\r?\n/).slice(-2).join(' / ').slice(0, 300)}` });
  }
  resultats.push({ script, code, verifications });
  if (interrompue) break;
}

const toutes = resultats.flatMap((r) => r.verifications.map((v) => ({ script: r.script, ...v })));
const reussies = toutes.filter((v) => v.ok).length;
const nonLances = scripts.filter((s) => !resultats.some((r) => r.script === s));
const bilan = { site: 'https://lumecrm.net', debut: debut.toISOString(), fin: new Date().toISOString(), total: toutes.length, reussies, echecs: toutes.length - reussies, interrompue, non_lances: nonLances, resultats };
writeFileSync(join(sorties, 'resultats.json'), JSON.stringify(bilan, null, 2));

let md = `# Automatisations — vérifications sur le vrai site\n\n${debut.toISOString()} · ${reussies} / ${toutes.length} réussies\n`;
if (interrompue) md += `\n**Passe INTERROMPUE : ${interrompue}.** Non lancés : ${nonLances.join(', ') || 'aucun'}. Ne pas relancer avant d’avoir lu la santé de la prod.\n`;
for (const r of resultats) {
  md += `\n## ${r.script}\n\n| | Vérification |\n|---|---|\n`;
  for (const v of r.verifications) md += `| ${v.ok ? '✓' : '✗'} | ${v.texte.replace(/\|/g, '/')} |\n`;
}
writeFileSync(join(sorties, 'RAPPORT.md'), md);
if (interrompue) console.log(`\nPASSE INTERROMPUE : ${interrompue}. Non lancés : ${nonLances.join(', ') || 'aucun'}.`);
console.log(`\n${reussies} / ${toutes.length} réussies — ${join(sorties, 'RAPPORT.md')}`);
process.exit(interrompue ? 2 : reussies === toutes.length ? 0 : 1);
