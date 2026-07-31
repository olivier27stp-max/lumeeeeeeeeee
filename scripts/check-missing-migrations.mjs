#!/usr/bin/env node
/**
 * Détecte les migrations dont les effets sont ABSENTS de la base.
 *
 * POURQUOI
 * Deux migrations ont été trouvées non appliquées le 2026-07-31, par hasard,
 * chacune ayant coûté une fonctionnalité pendant des semaines :
 *   * le filtre « factures par vendeur » — perdu sur une collision
 *     d'horodatage, deux fichiers partageant 20260717000000 alors que ce
 *     préfixe est la CLÉ PRIMAIRE du registre des migrations ;
 *   * la table quote_measurement_camera — jamais créée, alors qu'une page
 *     l'interroge dès son ouverture. Horodatage unique : simplement oubliée.
 *
 * Le registre n'aide pas : il compte 250 versions pour 353 fichiers, car les
 * migrations sont appliquées à la main (le dossier n'est pas poussable, cf. les
 * collisions). La SEULE vérité est donc l'état réel de la base.
 *
 * MÉTHODE
 * On extrait de chaque fichier les objets qu'il prétend créer — tables,
 * fonctions, colonnes — et on vérifie leur présence dans le catalogue. Une
 * migration dont AUCUN objet créé n'existe n'a très probablement jamais tourné.
 *
 * LIMITE ASSUMÉE : c'est une heuristique, pas une preuve. Une migration peut
 * avoir été appliquée puis son objet supprimé plus tard par une autre — d'où
 * le classement en « suspectes » et non en « certaines ». Chaque cas doit être
 * vérifié à la main avant toute action. C'est un détecteur, pas un correcteur.
 *
 * USAGE   node --env-file=.env.local scripts/check-missing-migrations.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const DIR = join(ROOT, 'supabase', 'migrations');
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;
const DB_URL = process.env.DB_URL;

if (!DB_URL && !(TOKEN && REF)) {
  console.error("✗ IMPOSSIBLE DE VÉRIFIER : ni DB_URL, ni SUPABASE_ACCESS_TOKEN+SUPABASE_PROJECT_REF.");
  process.exit(2);
}

async function query(sql) {
  if (DB_URL) {
    const { Client } = await import('pg');
    const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();
    try { return (await c.query(sql)).rows; } finally { await c.end(); }
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`API ${res.status}: ${t.slice(0, 200)}`);
  return JSON.parse(t);
}

// ── État réel de la base ───────────────────────────────────────────────────
const [tables, fonctions, colonnes] = await Promise.all([
  query(`select c.relname as n from pg_class c join pg_namespace s on s.oid=c.relnamespace
          where s.nspname='public' and c.relkind in ('r','v','m','p')`),
  query(`select p.proname as n from pg_proc p join pg_namespace s on s.oid=p.pronamespace
          where s.nspname='public'`),
  query(`select c.relname||'.'||a.attname as n
           from pg_attribute a join pg_class c on c.oid=a.attrelid
           join pg_namespace s on s.oid=c.relnamespace
          where s.nspname='public' and a.attnum>0 and not a.attisdropped`),
]);
const setTables = new Set(tables.map((r) => r.n));
const setFn = new Set(fonctions.map((r) => r.n));
const setCol = new Set(colonnes.map((r) => r.n));

// ── Ce que chaque migration prétend créer ──────────────────────────────────
// `(?!\\w+\\.)` écarte les objets d'un AUTRE schéma (app.x, auth.x) : ils ne
// sont pas dans `public` et leur absence de pg_class n'a rien d'anormal.
const RE_TABLE = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?["']?(?!\w+\.)([a-z_0-9]+)/gi;
const RE_FN = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?["']?(?!\w+\.)([a-z_0-9]+)\s*\(/gi;
const RE_COL = /alter\s+table\s+(?:only\s+)?(?:public\.)?["']?([a-z_0-9]+)["']?\s+add\s+column\s+(?:if\s+not\s+exists\s+)?["']?([a-z_0-9]+)/gi;

const fichiers = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

// Objets explicitement SUPPRIMÉS par une migration. Leur absence est alors
// voulue, pas le signe d'une migration manquante — le panneau « director » et
// les tables de mémoire de l'agent ont ainsi été retirés volontairement.
const supprimes = new Set();
for (const f of fichiers) {
  let sql = '';
  try { sql = readFileSync(join(DIR, f), 'utf8'); } catch { continue; }
  const code = sql.split('\n').filter((l) => !/^\s*(--|\/\*|\*)/.test(l)).join('\n');
  for (const m of code.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?["']?([a-z_0-9]+)/gi)) supprimes.add(m[1]);
  for (const m of code.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?["']?([a-z_0-9]+)/gi)) supprimes.add(m[1]);
  for (const m of code.matchAll(/drop\s+column\s+(?:if\s+exists\s+)?["']?([a-z_0-9]+)/gi)) supprimes.add(m[1]);
}

const suspectes = [];

for (const f of fichiers) {
  let sql;
  try { sql = readFileSync(join(DIR, f), 'utf8'); } catch { continue; }
  // On ignore les lignes de commentaire : beaucoup de migrations citent des
  // objets dans leur en-tête explicatif sans les créer.
  const code = sql.split('\n').filter((l) => !/^\s*(--|\/\*|\*)/.test(l)).join('\n');

  const attendus = [];
  for (const m of code.matchAll(RE_TABLE)) attendus.push({ genre: 'table', nom: m[1], present: setTables.has(m[1]) });
  for (const m of code.matchAll(RE_FN)) attendus.push({ genre: 'fonction', nom: m[1], present: setFn.has(m[1]) });
  for (const m of code.matchAll(RE_COL)) attendus.push({ genre: 'colonne', nom: `${m[1]}.${m[2]}`, present: setCol.has(`${m[1]}.${m[2]}`) });

  if (!attendus.length) continue;                 // rien de vérifiable ici
  // On ne retient que les objets ni présents, ni volontairement supprimés.
  const manquants = attendus.filter((a) => {
    if (a.present) return false;
    const court = a.nom.includes('.') ? a.nom.split('.')[1] : a.nom;
    return !supprimes.has(a.nom) && !supprimes.has(court);
  });
  if (!manquants.length) continue;
  if (manquants.length === attendus.filter((a) => !a.present).length
      && manquants.length === attendus.length) {  // AUCUN objet créé n'existe
    suspectes.push({ fichier: f, attendus: attendus.length, manquants });
  }
}

// ── Collisions d'horodatage ────────────────────────────────────────────────
const parPrefixe = {};
for (const f of fichiers) {
  const p = f.slice(0, 14);
  (parPrefixe[p] ??= []).push(f);
}
const collisions = Object.entries(parPrefixe).filter(([, l]) => l.length > 1);

console.log(`Migrations analysées : ${fichiers.length}`);
console.log(`Collisions d'horodatage : ${collisions.length} groupe(s), ${collisions.reduce((a, [, l]) => a + l.length, 0)} fichiers\n`);

if (suspectes.length) {
  console.log(`⚠️  ${suspectes.length} migration(s) dont AUCUN objet créé n'existe en base :\n`);
  for (const s of suspectes) {
    const enCollision = parPrefixe[s.fichier.slice(0, 14)].length > 1;
    console.log(`  ${s.fichier}${enCollision ? '   [EN COLLISION]' : ''}`);
    for (const m of s.manquants.slice(0, 4)) console.log(`      ${m.genre} absente : ${m.nom}`);
    if (s.manquants.length > 4) console.log(`      … et ${s.manquants.length - 4} autre(s)`);
  }
  console.log(`
Ce sont des SUSPECTES, pas des certitudes : un objet peut avoir été supprimé
plus tard par une autre migration. Vérifier chaque cas AVANT d'agir — et, avant
de rejouer une vieille migration, contrôler que toutes ses références existent
encore. Une migration de juillet a cassé la liste des factures parce qu'elle
citait une colonne supprimée depuis.`);
} else {
  console.log('✅ Aucune migration suspecte : tous les objets créés sont présents en base.');
}
process.exit(0);
