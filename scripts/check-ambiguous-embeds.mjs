/**
 * Croise les jointures PostgREST du code avec les paires de tables ayant
 * PLUSIEURS clés étrangères entre elles.
 *
 * Depuis le durcissement multi-tenant du 30 juillet, 138 paires ont deux clés :
 * l'originale et une composite (col, org_id) qui porte l'isolation. PostgREST
 * ne peut plus choisir et répond PGRST201 / HTTP 300 — la requête ne renvoie
 * AUCUNE donnée.
 *
 * Deux fonctionnalités ont ainsi été trouvées cassées dans les journaux de
 * production : la planification des jobs récurrents et le moteur
 * d'automatisation. Ce script cherche les autres.
 *
 * ⚠️ NE PAS CORRIGER AUTOMATIQUEMENT. Choisir la clé au hasard parmi celles qui
 * existent renverrait des données FAUSSES, en silence — bien pire que l'erreur
 * actuelle, qui au moins se voit. Exemple réel : `quotes` a QUATRE clés vers
 * `clients` (client_id et lead_id, chacune avec sa jumelle composite). Une
 * requête qui veut le client et reçoit le lead ne lève aucune erreur.
 *
 * Pour chaque cas, lire la requête, comprendre quelle relation elle vise, puis
 * nommer explicitement la clé :
 *     .select('*, parent!nom_de_la_fk(...)')
 * Les clés candidates se listent ainsi :
 *     select conname, conkey from pg_constraint
 *      where conrelid='public.<enfant>'::regclass
 *        and confrelid='public.<parent>'::regclass;
 *
 * USAGE  node --env-file=.env.local scripts/check-ambiguous-embeds.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const t = process.env.SUPABASE_ACCESS_TOKEN, r = process.env.SUPABASE_PROJECT_REF;
const ROOT = process.cwd();

async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${r}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const x = await res.text();
  if (!res.ok) throw new Error(x.slice(0, 200));
  return JSON.parse(x);
}

const paires = await q(`
  select c.conrelid::regclass::text as enfant, c.confrelid::regclass::text as parent
    from pg_constraint c
   where c.contype='f' and c.connamespace='public'::regnamespace
   group by 1,2 having count(*) > 1`);
const ambigu = new Set(paires.map((p) => `${p.enfant.replace('public.', '')}|${p.parent.replace('public.', '')}`));

function walk(d, out = []) {
  for (const e of readdirSync(d)) {
    if (e === 'node_modules' || e === 'dist' || e.startsWith('.')) continue;
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

// .from('enfant') ... .select('..., parent(...)')  — jointure imbriquée
const RE_FROM_SELECT = /\.from\s*\(\s*['"]([a-z_0-9]+)['"]\s*\)[\s\S]{0,200}?\.select\s*\(\s*[`'"]([^`'"]*)[`'"]/g;
// Une jointure : `nom(` ou `nom!hint(` — on capture le nom et l'éventuel indice
const RE_EMBED = /([a-z_0-9]+)(![a-z_0-9]+)?(![a-z]+)?\s*\(/g;

const trouves = [];
for (const dir of ['src', 'server']) {
  let fichiers = []; try { fichiers = walk(join(ROOT, dir)); } catch { continue; }
  for (const f of fichiers) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(RE_FROM_SELECT)) {
      const [, enfant, sel] = m;
      const ligne = src.slice(0, m.index).split('\n').length;
      for (const e of sel.matchAll(RE_EMBED)) {
        const [, parent, indice] = e;
        if (parent === 'select' || parent === 'count') continue;
        if (!ambigu.has(`${enfant}|${parent}`)) continue;
        // Un indice nommant la clé (!xxx_fkey) lève déjà l'ambiguïté.
        const leve = indice && /_fkey|_same_org/.test(indice);
        if (leve) continue;
        trouves.push({ fichier: relative(ROOT, f), ligne, enfant, parent });
      }
    }
  }
}

console.log(`paires de tables ambiguës en base : ${ambigu.size}`);
console.log(`jointures du code qui tombent dessus SANS lever l'ambiguïté : ${trouves.length}\n`);
for (const x of trouves) {
  console.log(`  ${x.fichier}:${x.ligne}  ${x.enfant} → ${x.parent}`);
}
if (trouves.length) {
  console.log(`
Chacune renvoie PGRST201 / HTTP 300 : la requête ne rapporte AUCUNE donnée.
Corriger une par une, en lisant la requête pour savoir quelle relation elle
vise. Ne jamais choisir la clé automatiquement.`);
}
process.exit(trouves.length ? 1 : 0);
