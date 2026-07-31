/**
 * Cherche les objets CASSES en base : ceux qui existent mais echouent quand on
 * les utilise. C'est une classe d'erreurs distincte de « l'objet est absent ».
 *
 * Deux cas reels trouves le 2026-07-31 :
 *   * record_email_opt_out() mettait a jour `public.leads`, table SUPPRIMEE du
 *     schema. Le desabonnement des courriels echouait donc en 42P01 — et comme
 *     l'erreur survenait apres l'insertion dans email_opt_outs, elle annulait
 *     AUSSI cette insertion. Aucun desabonnement n'etait conserve.
 *   * create_lead_quick() inserait dans la meme table disparue.
 *
 * ⚠️ LA SORTIE DEMANDE UN TRI — beaucoup de faux positifs :
 *   * une reference `from public.ma_fonction()` est prise pour une table ;
 *   * une reference peut se trouver dans une branche jamais atteinte, auquel
 *     cas la fonction marche parfaitement au quotidien.
 *
 * La seule preuve est l'EXECUTION. Pour chaque suspecte, verifier d'abord si le
 * code l'appelle (`grep -rl "<nom>" src/ server/`), puis l'appeler pour de vrai
 * dans une transaction annulee :
 *     begin; select public.<fonction>(...); rollback;
 *
 * USAGE  node --env-file=.env.local scripts/check-broken-objects.mjs
 */
const t = process.env.SUPABASE_ACCESS_TOKEN, r = process.env.SUPABASE_PROJECT_REF;
const pause = (ms) => new Promise((s) => setTimeout(s, ms));
async function q(sql, muet = false) {
  await pause(150);
  const res = await fetch(`https://api.supabase.com/v1/projects/${r}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const x = await res.text();
  if (!res.ok) { if (muet) return { __err: x }; throw new Error(x.slice(0, 200)); }
  return JSON.parse(x);
}

// ── 1. Les vues s'executent-elles vraiment ? ────────────────────────────────
const vues = await q(`select c.relname as n from pg_class c join pg_namespace s on s.oid=c.relnamespace
                       where s.nspname='public' and c.relkind in ('v','m') order by 1`);
console.log(`── Vues (${vues.length}) ──`);
let vuesKo = 0;
for (const v of vues) {
  const res = await q(`select 1 from public."${v.n}" limit 1`, true);
  if (res.__err) {
    const msg = (JSON.parse(res.__err).message || '').replace(/\s+/g, ' ').slice(0, 110);
    console.log(`  ✗ ${v.n} — ${msg}`);
    vuesKo++;
  }
}
console.log(vuesKo ? `  ${vuesKo} vue(s) cassee(s)` : '  toutes exécutables');

// ── 2. Fonctions referencant une table inexistante ──────────────────────────
const tables = new Set((await q(`select c.relname as n from pg_class c join pg_namespace s on s.oid=c.relnamespace
  where s.nspname='public' and c.relkind in ('r','v','m','p')`)).map((x) => x.n));
const fns = await q(`select p.proname as n, p.prosrc as src from pg_proc p
  join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.prokind='f'`);
console.log(`\n── Fonctions référençant une table absente (${fns.length} analysées) ──`);
const RE = /\b(?:from|join|into|update)\s+public\.([a-z_0-9]+)/gi;
let fnKo = 0;
for (const f of fns) {
  const manquantes = new Set();
  for (const m of String(f.src || '').matchAll(RE)) if (!tables.has(m[1])) manquantes.add(m[1]);
  if (manquantes.size) { console.log(`  ✗ ${f.n}() → ${[...manquantes].join(', ')}`); fnKo++; }
}
console.log(fnKo ? `  ${fnKo} fonction(s) concernée(s)` : '  aucune');

// ── 3. Contraintes CHECK que les donnees actuelles violeraient ──────────────
// (les contraintes validees ne peuvent pas etre violees par l'existant, mais
//  une valeur par defaut peut etre hors de la liste autorisee — c'est le cas
//  rencontre avec stage='Qualified')
console.log(`\n── Valeurs par défaut hors des contraintes CHECK ──`);
const defauts = await q(`
  select c.relname as tbl, a.attname as col,
         pg_get_expr(d.adbin, d.adrelid) as defaut,
         (select string_agg(pg_get_constraintdef(k.oid), ' | ')
            from pg_constraint k
           where k.conrelid = c.oid and k.contype='c'
             and pg_get_constraintdef(k.oid) ilike '%'||a.attname||'%') as contrainte
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace s on s.oid = c.relnamespace and s.nspname='public'
    join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where c.relkind='r' and a.attnum>0 and not a.attisdropped`);
let defKo = 0;
for (const d of defauts) {
  if (!d.contrainte) continue;
  const m = String(d.defaut).match(/^'([^']+)'/);
  if (!m) continue;
  const val = m[1];
  // La contrainte cite-t-elle cette valeur ?
  if (/= ANY|IN \(/i.test(d.contrainte) && !d.contrainte.includes(`'${val}'`)) {
    console.log(`  ✗ ${d.tbl}.${d.col} défaut='${val}' absent de : ${d.contrainte.replace(/\s+/g, ' ').slice(0, 95)}`);
    defKo++;
  }
}
console.log(defKo ? `  ${defKo} défaut(s) incompatible(s)` : '  aucun');
