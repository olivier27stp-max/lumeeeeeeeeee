/**
 * Genere un instantane FIDELE du schema, depuis pg_catalog (lecture seule).
 * Remplace complete_schema.sql, fige au 13 juin et responsable de 4 findings
 * faux pendant l'audit du 31 juillet.
 *
 * Ce n'est pas un dump executable : c'est un REFERENTIEL DE LECTURE, genere,
 * horodate, et explicitement marque comme non rejouable — pour qu'on ne le
 * confonde plus jamais avec la source de verite du deploiement.
 */
import { writeFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, r = process.env.SUPABASE_PROJECT_REF;
const pause = (ms) => new Promise((s) => setTimeout(s, ms));
async function q(sql) {
  await pause(200);
  for (let i = 0; i < 4; i++) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${r}/database/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }) });
    const x = await res.text();
    if (res.ok) return JSON.parse(x);
    if (res.status === 429 || res.status >= 500) { await pause(2500 * (i + 1)); continue; }
    throw new Error(`HTTP ${res.status}: ${x.slice(0, 200)}`);
  }
  throw new Error('retries epuises');
}

const stamp = process.argv[3];
let out = `# Instantané du schéma — référentiel de lecture

> ⚠️ **Ce fichier n'est PAS exécutable et n'est PAS la source de vérité du
> déploiement.** C'est une photographie de \`pg_catalog\`, générée pour qu'on
> dispose enfin d'un référentiel FIABLE — l'ancien \`complete_schema.sql\` était
> figé au 13 juin, en retard de 121 migrations, et a produit **quatre findings
> faux** pendant l'audit du 31 juillet (vues sans \`security_invoker\`,
> \`search_path\` mutable, contraintes \`NOT VALID\`, tables sans clé primaire —
> tous démentis par la base réelle).
>
> **Régénérer avec** \`scripts/gen-schema-snapshot.mjs\` après tout changement
> structurel. Un référentiel périmé est pire qu'aucun référentiel.

**Généré le ${stamp} depuis la production (\`bbzcuzqfgsdvjsymfwmr\`).**

`;

const tables = await q(`
  select c.relname as t, c.relrowsecurity as rls, c.relforcerowsecurity as force_rls,
         (select count(*) from pg_policy p where p.polrelid=c.oid) as policies,
         c.reltuples::bigint as lignes_est
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r' order by c.relname`);

out += `## 1. Tables (${tables.length})\n\n`;
out += `| Table | RLS | FORCE | Policies | Lignes (est.) |\n|---|---|---|---|---|\n`;
for (const x of tables) {
  out += `| \`${x.t}\` | ${x.rls ? '✅' : '❌'} | ${x.force_rls ? '✅' : '❌'} | ${x.policies} | ${x.lignes_est < 0 ? '?' : x.lignes_est} |\n`;
}

const cols = await q(`
  select c.relname as t, a.attname as col, format_type(a.atttypid,a.atttypmod) as typ,
         a.attnotnull as nn, coalesce(pg_get_expr(d.adbin,d.adrelid),'') as def
    from pg_attribute a
    join pg_class c on c.oid=a.attrelid
    join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
    left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
   where c.relkind='r' and a.attnum>0 and not a.attisdropped
   order by c.relname, a.attnum`);
const byT = {};
for (const x of cols) (byT[x.t] ??= []).push(x);
out += `\n## 2. Colonnes\n\n`;
for (const [tname, list] of Object.entries(byT)) {
  out += `### \`${tname}\`\n\n`;
  for (const x of list) out += `- \`${x.col}\` ${x.typ}${x.nn ? ' NOT NULL' : ''}${x.def ? ' DEFAULT ' + x.def : ''}\n`;
  out += '\n';
}

const pol = await q(`
  select tablename as t, policyname as p, cmd, permissive, roles::text as roles,
         coalesce(qual,'') as using_expr, coalesce(with_check,'') as check_expr
    from pg_policies where schemaname='public' order by tablename, policyname`);
out += `## 3. Policies RLS (${pol.length})\n\n`;
let cur = '';
for (const x of pol) {
  if (x.t !== cur) { out += `\n### \`${x.t}\`\n\n`; cur = x.t; }
  out += `- **${x.p}** — ${x.cmd}, ${x.permissive}, roles=${x.roles}\n`;
  if (x.using_expr) out += `  - USING: \`${x.using_expr.replace(/\s+/g, ' ').slice(0, 300)}\`\n`;
  if (x.check_expr) out += `  - WITH CHECK: \`${x.check_expr.replace(/\s+/g, ' ').slice(0, 300)}\`\n`;
}

const fns = await q(`
  select p.proname as n, pg_get_function_arguments(p.oid) as args,
         pg_get_function_result(p.oid) as ret, p.prosecdef as secdef,
         coalesce(array_to_string(p.proconfig,', '),'') as cfg,
         coalesce(array_to_string(p.proacl,' | '),'(défaut PUBLIC)') as acl
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prokind='f' order by p.proname`);
out += `\n\n## 4. Fonctions (${fns.length})\n\n`;
out += `Corps non inclus — ils divergent, et c'est précisément ce qui a trompé\nl'audit. Lire le corps réel avec :\n\`select prosrc from pg_proc where proname = '...'\`\n\n`;
out += `| Fonction | SECURITY DEFINER | search_path | Droits |\n|---|---|---|---|\n`;
for (const x of fns) {
  const acl = x.acl.replace(/postgres=[^|]*\|?\s*/g, '').replace(/\s*\|\s*$/, '').trim() || '—';
  out += `| \`${x.n}(${x.args.slice(0, 70)})\` → ${x.ret} | ${x.secdef ? '⚠️ oui' : 'non'} | ${x.cfg || '❌ aucun'} | ${acl} |\n`;
}

const views = await q(`
  select c.relname as v, coalesce(array_to_string(c.reloptions,','),'') as opts
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('v','m') order by c.relname`);
out += `\n## 5. Vues (${views.length})\n\n`;
for (const x of views) out += `- \`${x.v}\`${x.opts ? ' — ' + x.opts : ' — ⚠️ aucune option'}\n`;

const cons = await q(`
  select conrelid::regclass::text as t, conname as c, contype, convalidated as ok,
         pg_get_constraintdef(oid) as def
    from pg_constraint where connamespace='public'::regnamespace
   order by 1,2`);
out += `\n## 6. Contraintes (${cons.length})\n\n`;
cur = '';
for (const x of cons) {
  if (x.t !== cur) { out += `\n### \`${x.t}\`\n\n`; cur = x.t; }
  out += `- \`${x.c}\` — ${x.def.slice(0, 220)}${x.ok ? '' : ' ⚠️ **NOT VALID**'}\n`;
}

const trg = await q(`
  select c.relname as t, tg.tgname as g, p.proname as f
    from pg_trigger tg join pg_class c on c.oid=tg.tgrelid
    join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
    join pg_proc p on p.oid=tg.tgfoid
   where not tg.tgisinternal order by c.relname, tg.tgname`);
out += `\n## 7. Triggers (${trg.length})\n\n`;
for (const x of trg) out += `- \`${x.t}\` → **${x.g}** (\`${x.f}()\`)\n`;

const crons = await q(`select jobname as j, schedule as s, active as a from cron.job order by jobname`);
out += `\n## 8. Tâches planifiées (${crons.length})\n\n`;
for (const x of crons) out += `- \`${x.j}\` — \`${x.s}\` — ${x.a ? 'actif' : '⚠️ INACTIF'}\n`;

writeFileSync(process.argv[2], out);
console.log(`ecrit: ${process.argv[2]}`);
console.log(`  ${tables.length} tables · ${pol.length} policies · ${fns.length} fonctions · ${views.length} vues · ${cons.length} contraintes · ${trg.length} triggers · ${crons.length} crons`);
