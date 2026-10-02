// Fusionne les passes (sorties/modeles/runs/*.json et *.log) : pour chaque test, le DERNIER verdict l'emporte.
// Usage : node verdicts.mjs            → résumé + liste des rouges avec leur première erreur
//         node verdicts.mjs --long     → idem, erreurs plus longues
//         node verdicts.mjs --env      → les cibles « fichier:ligne » des rouges tombés pour cause d'environnement (à relancer)
//         node verdicts.mjs --inconnus → idem pour les rouges sans @defaut et hors environnement
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const DIR = 'D:/lume-uiaudit/sorties/modeles/runs';
const SLASH = String.fromCharCode(92);
const propre = (chemin) => chemin.split(SLASH).join('/').replace(/^.*modeles\//, '');
const tests = new Map();

for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json') || x.endsWith('.log')).sort()) {
  if (f.endsWith('.log')) {
    // Passe interrompue (processus arrêté : pas de JSON) : on relit le journal ligne à ligne.
    for (const l of readFileSync(`${DIR}/${f}`, 'utf8').split(/\r?\n/)) {
      const m = l.match(/^\s+(ok|x)\s+\d+ \[bureau\] › (.+?\.spec\.ts):(\d+):\d+ › (.+) \([\d.]+m?s\)\s*$/);
      if (!m) continue;
      const fichier = propre(m[2]);
      const titre = m[4].split(' › ').at(-1);
      tests.set(`${fichier} › ${titre}`, {
        fichier, ligne: Number(m[3]), titre, ok: m[1] === 'ok', duree: 0,
        erreurs: m[1] === 'ok' ? [] : ['passe interrompue : erreur non relevée'], passe: f, annotations: [], interrompue: true,
      });
    }
    continue;
  }
  let j;
  try { j = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')); } catch { continue; }
  const visiter = (suite, fichier) => {
    for (const s of suite.suites ?? []) visiter(s, fichier || s.file || suite.file);
    for (const sp of suite.specs ?? []) {
      const r = sp.tests?.[0]?.results?.at(-1);
      if (!r || r.status === 'skipped') continue;
      const fich = propre(sp.file || fichier || '');
      const erreurs = (r.errors ?? []).map((e) => (e.message ?? '').replace(/\u001b\[[0-9;]*m/g, ''));
      tests.set(`${fich} › ${sp.title}`, {
        fichier: fich, ligne: sp.line, titre: sp.title, ok: r.status === 'passed', duree: r.duration, erreurs, passe: f,
        annotations: (sp.tests?.[0]?.annotations ?? []).concat(r.annotations ?? []),
      });
    }
  };
  for (const s of j.suites ?? []) visiter(s, s.file);
}

// Signatures d'une panne d'ENVIRONNEMENT (staging saturé, session perdue) — jamais d'un défaut du produit testé.
const ENV = new RegExp([
  'Lock broken by another request', 'statement timeout', 'route\\.fetch: Timeout', 'session qa-auto', 'lien magique',
  '403 POST https://[a-z]+\\.supabase\\.co/rest/v1/orgs', 'fetch failed', 'ECONNRESET', 'Fixture "bureau" timeout',
  'bac à sable illisible', 'passe interrompue', 'upstream', '57014', 'Test timeout of',
  '50[0234] (GET|HEAD|POST|PATCH|DELETE) https://[a-z]+\\.supabase\\.co', '50[0234] (GET|HEAD|POST|PATCH|DELETE) /api/(billing|me|orgs|notifications|feature)',
  'TypeError: Failed to fetch', 'ERR_CONNECTION', 'net::ERR', 'lecture des (règles|adresses) :', 'creerRegle :', 'lireRegle :',
].join('|'));
const tous = [...tests.values()];
const rouges = tous.filter((t) => !t.ok);
const estEnv = (t) => t.erreurs.some((e) => ENV.test(e));
const env = rouges.filter(estEnv);
const inconnus = rouges.filter((t) => !estEnv(t) && !/@defaut/.test(t.titre));
writeFileSync('D:/lume-uiaudit/sorties/modeles/verdicts.json', JSON.stringify(tous, null, 1));

const cibles = (liste) => liste.map((t) => `e2e/automations/modeles/${t.fichier}:${t.ligne}`).join(' ');
if (process.argv.includes('--env')) console.log(cibles(env));
else if (process.argv.includes('--inconnus')) console.log(cibles(inconnus));
else {
  const long = process.argv.includes('--long');
  console.log(`${tous.length} tests · ${tous.length - rouges.length} verts · ${rouges.length} rouges (${env.length} environnement, ${rouges.filter((t) => /@defaut/.test(t.titre) && !estEnv(t)).length} @defaut, ${inconnus.length} à regarder)`);
  const verts = tous.filter((t) => t.ok && /@defaut/.test(t.titre));
  if (verts.length) console.log(`\n@defaut MAIS VERT (à requalifier) :\n${verts.map((t) => `  ${t.fichier} › ${t.titre}`).join('\n')}`);
  for (const t of rouges) {
    const e = (t.erreurs.find((x) => !/Le moniteur/.test(x)) ?? t.erreurs[0] ?? '').split('\n').filter((l) => l.trim()).slice(0, long ? 16 : 5).join('\n      ');
    console.log(`\n${estEnv(t) ? '[ENV] ' : /@defaut/.test(t.titre) ? '[DEF] ' : '[???] '}${t.fichier}:${t.ligne} › ${t.titre}\n      ${e.slice(0, long ? 2200 : 600)}`);
  }
}
