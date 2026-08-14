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
 * TROIS SOURCES DE FAUX POSITIFS ONT ETE SUPPRIMEES (2026-08-13). Le detecteur
 * criait au loup a chaque execution — 12 fonctions et 2 defauts signales, tous
 * faux. Un detecteur qu'on prend l'habitude d'ignorer ne sert plus a rien :
 *   * `from public.ma_fonction()` est un appel de fonction valide, pas une
 *     table : les fonctions sont desormais exclues ;
 *   * les commentaires etaient analyses, donc un « (retire) update
 *     public.leads » signalait le code DEJA nettoye : ils sont retires avant
 *     analyse, avec les litteraux texte ;
 *   * les contraintes CHECK etaient rapprochees par recherche du nom de colonne
 *     dans leur texte, donc `linked_entity_type` etait attribuee a `type` : le
 *     rapprochement passe maintenant par conkey.
 *
 * ⚠️ UN FAUX POSITIF LEGITIME SUBSISTE, et il est irreductible : une reference
 * peut vivre dans une branche jamais atteinte, auquel cas la fonction marche
 * parfaitement au quotidien.
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

// `from public.ma_fonction()` est une syntaxe VALIDE — c'est un appel de
// fonction, pas une table. Sans cette liste, les 10 fonctions appelées de cette
// façon (current_org_ids, check_all_invariants, search_global_source…) étaient
// signalées comme des tables manquantes à chaque exécution.
const fonctions = new Set((await q(`select p.proname as n from pg_proc p
  join pg_namespace s on s.oid=p.pronamespace where s.nspname='public'`)).map((x) => x.n));

const fns = await q(`select p.proname as n, p.prosrc as src from pg_proc p
  join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.prokind='f'`);
console.log(`\n── Fonctions référençant une table absente (${fns.length} analysées) ──`);
const RE = /\b(?:from|join|into|update)\s+public\.([a-z_0-9]+)/gi;

/**
 * Retire commentaires et littéraux avant l'analyse.
 *
 * Un commentaire documentant un retrait — « (retiré 2026-08-02) update
 * public.leads : la table leads a été supprimée » — était lu comme une
 * référence vivante. Le détecteur signalait donc précisément le code qui avait
 * DÉJÀ été nettoyé, ce qui est le pire signal possible.
 */
function codeSeul(src) {
  return String(src || '')
    .replace(/--[^\n]*/g, ' ')        // commentaires de ligne
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // commentaires de bloc
    .replace(/'(?:[^']|'')*'/g, "''"); // littéraux texte
}

let fnKo = 0;
for (const f of fns) {
  const src = codeSeul(f.src);
  // `to_regclass('public.x')` teste l'existence de la table AVANT de s'en
  // servir : la référence est alors volontairement défensive et ne peut pas
  // échouer. Trois fonctions du produit s'en servent pour survivre à une
  // migration pas encore appliquée (current_org_id, has_org_role,
  // purge_expired_portal_tokens) — les signaler revenait à reprocher au code
  // d'être prudent.
  // Extrait de la source BRUTE : codeSeul() vide les littéraux, or le nom de la
  // table vit précisément dans le littéral de to_regclass.
  const protegees = new Set(
    [...String(f.src || '').matchAll(/to_regclass\(\s*'(?:public\.)?([a-z_0-9]+)'/gi)].map((m) => m[1]),
  );
  const manquantes = new Set();
  for (const m of src.matchAll(RE)) {
    if (!tables.has(m[1]) && !fonctions.has(m[1]) && !protegees.has(m[1])) manquantes.add(m[1]);
  }
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
         -- Le rapprochement se fait par la COLONNE réellement couverte par la
         -- contrainte (conkey), pas par recherche du nom dans son texte : un
         -- un ilike sur le nom rattachait la contrainte portant sur
         -- linked_entity_type à la colonne type, deux colonnes distinctes dont
         -- l'une contient le nom de l'autre. D'où deux faux positifs permanents.
         (select string_agg(pg_get_constraintdef(k.oid), ' | ')
            from pg_constraint k
           where k.conrelid = c.oid and k.contype='c'
             and a.attnum = any(k.conkey)) as contrainte
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
  // Une contrainte peut couvrir plusieurs colonnes (conkey est un tableau). On
  // ne compare la valeur par défaut qu'au fragment portant sur CETTE colonne,
  // sinon une liste voisine ferait passer un vrai défaut incompatible.
  const fragments = d.contrainte.split('|').filter((f) => new RegExp(`\\b${d.col}\\b`).test(f));
  const pertinent = fragments.length ? fragments.join(' | ') : null;
  if (!pertinent) continue;
  // La contrainte cite-t-elle cette valeur ?
  if (/= ANY|IN \(/i.test(pertinent) && !pertinent.includes(`'${val}'`)) {
    console.log(`  ✗ ${d.tbl}.${d.col} défaut='${val}' absent de : ${pertinent.replace(/\s+/g, ' ').slice(0, 95)}`);
    defKo++;
  }
}
console.log(defKo ? `  ${defKo} défaut(s) incompatible(s)` : '  aucun');
