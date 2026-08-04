#!/usr/bin/env python3
"""
check-schema-refs.py — Croise le CODE avec le CATALOGUE RÉEL de la base.

Détecte, de façon déterministe (aucune heuristique de jugement) :
  1. colonnes lues        : .select() / .eq() / .order() … sur une colonne inexistante
  2. clés écrites         : .insert()/.update()/.upsert({ col: … }) sur une colonne inexistante
  3. valeurs interdites   : littéral écrit ou comparé hors d'une contrainte CHECK
  4. arguments RPC        : .rpc('fn', { p_x }) dont le paramètre n'existe pas

Pourquoi c'est critique : avec PostgREST, une requête qui cite UNE colonne
inexistante échoue ENTIÈREMENT (400). Comme supabase-js ne lève pas
d'exception, la fonctionnalité meurt en silence. C'est ainsi que les jobs
récurrents, la gamification terrain, les pauses de pointage et l'onboarding
de facturation sont restés cassés sans que personne le voie.

Usage :
    npm run check:schema-refs                 # cible SUPABASE_PROJECT_REF
    npm run check:schema-refs -- --prod       # cible SUPABASE_PROJECT_REF_PROD

Prérequis dans .env.local : SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF.
Sort en code 1 si au moins un écart est trouvé (utilisable en CI).
"""
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROD = '--prod' in sys.argv

CATALOG_SQL = """
select json_build_object(
  'columns', (select json_object_agg(relname, cols) from (
      select c.relname, json_agg(a.attname order by a.attnum) as cols
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
      where n.nspname = 'public' and c.relkind in ('r','v','m')
        and a.attnum > 0 and not a.attisdropped
      group by c.relname) s),
  'checks', (select json_object_agg(key, vals) from (
      select c.relname || '.' || a.attname as key, json_agg(distinct m[1]) as vals
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum = con.conkey[1]
      cross join lateral regexp_matches(pg_get_constraintdef(con.oid), '''([a-z_0-9]+)''::text', 'g') as m
      where n.nspname = 'public' and con.contype = 'c' and array_length(con.conkey, 1) = 1
      group by 1) s2),
  'rpcs', (select json_object_agg(proname, args) from (
      select p.proname, json_agg(distinct pg_get_function_arguments(p.oid)) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' group by p.proname) s3)
) as cat;
"""


def env(name):
    path = os.path.join(ROOT, '.env.local')
    if os.path.exists(path):
        for line in open(path):
            if line.startswith(name + '='):
                return line.split('=', 1)[1].strip().strip('"').strip("'")
    return os.environ.get(name)


def fetch_catalog():
    token = env('SUPABASE_ACCESS_TOKEN')
    ref = env('SUPABASE_PROJECT_REF_PROD' if PROD else 'SUPABASE_PROJECT_REF')
    if not token or not ref:
        sys.exit('ERREUR: SUPABASE_ACCESS_TOKEN et SUPABASE_PROJECT_REF requis dans .env.local')
    req = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{ref}/database/query',
        data=json.dumps({'query': CATALOG_SQL}).encode(),
        headers={
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
            'User-Agent': 'curl/8.7.1',  # sinon Cloudflare renvoie 403
        },
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())[0]['cat'], ref


FROM_RE = re.compile(r"\.from\(\s*'([A-Za-z_][A-Za-z_0-9]*)'\s*\)")
SELECT_RE = re.compile(r"\.select\(\s*[`'\"]([^`'\"]*)[`'\"]")
FILTER_RE = re.compile(
    r"\.(?:eq|neq|gt|gte|lt|lte|like|ilike|is|in|contains|containedBy|overlaps|order|not)\(\s*"
    r"'([A-Za-z_][A-Za-z_0-9]*)'")
EQVAL_RE = re.compile(r"\.eq\(\s*'([A-Za-z_][A-Za-z_0-9]*)'\s*,\s*'([A-Za-z_0-9 .-]+)'\s*\)")
WRITE_RE = re.compile(r"\.(insert|update|upsert)\(\s*\{")
RPC_RE = re.compile(r"\.rpc\(\s*'([A-Za-z_][A-Za-z_0-9]*)'\s*,\s*\{")
KEY_RE = re.compile(r"(?:^|[\{,])\s*([A-Za-z_][A-Za-z_0-9]*)\s*:")
KV_RE = re.compile(r"(?:^|[\{,])\s*([A-Za-z_][A-Za-z_0-9]*)\s*:\s*'([A-Za-z_0-9 .-]+)'")
PSEUDO = {'count', '*'}


def parse_select(expr):
    """Colonnes de premier niveau d'un select(), embeds et alias ignorés."""
    out, depth, buf = [], 0, ''
    for ch in expr:
        if ch == '(':
            depth += 1
            buf = ''
            continue
        if ch == ')':
            depth -= 1
            buf = ''
            continue
        if ch == ',' and depth == 0:
            out.append(buf)
            buf = ''
            continue
        buf += ch
    out.append(buf)
    cols = []
    for raw in out:
        c = raw.strip()
        if not c or c == '*':
            continue
        if ':' in c:
            c = c.split(':', 1)[1].strip()
        c = c.split('.')[0].split('->')[0].strip()
        if c and c != '*' and re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*', c):
            cols.append(c)
    return cols


def obj_body(text, brace_pos):
    """Corps du littéral d'objet à profondeur 1 (objets imbriqués masqués)."""
    depth, out, i = 0, [], brace_pos
    while i < len(text) and i < brace_pos + 4000:
        ch = text[i]
        if ch == '{':
            depth += 1
            if depth == 1:
                i += 1
                continue
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return ''.join(out)
        if depth == 1:
            out.append(ch)
        elif depth > 1:
            out.append(' ')
        i += 1
    return ''.join(out)


def main():
    cat, ref = fetch_catalog()
    cols = {t: set(c) for t, c in cat['columns'].items()}
    checks = cat['checks'] or {}
    rpc_args = {}
    for name, sigs in (cat['rpcs'] or {}).items():
        names = set()
        for sig in sigs:
            for part in sig.split(','):
                part = part.strip()
                if not part:
                    continue
                tok = part.split()[0]
                if tok in ('IN', 'OUT', 'INOUT', 'VARIADIC') and len(part.split()) > 1:
                    tok = part.split()[1]
                if re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*', tok):
                    names.add(tok)
        rpc_args[name] = names

    # Faux positifs vérifiés un par un (voir scripts/schema-refs-allowlist.json)
    allow = set()
    allow_path = os.path.join(ROOT, 'scripts', 'schema-refs-allowlist.json')
    if os.path.exists(allow_path):
        for e in json.load(open(allow_path)).get('allow', []):
            allow.add((e['file'], e['table'], e['ref']))

    read_f, write_f, value_f, rpc_f = [], [], [], []
    seen = set()
    scanned = 0
    skipped = 0

    for base, dirs, names in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in ('node_modules', '.git', 'dist', 'build', 'mobile')]
        for n in names:
            if not n.endswith(('.ts', '.tsx', '.mjs')):
                continue
            rel = os.path.relpath(os.path.join(base, n), ROOT)
            if not (rel.startswith('src/') or rel.startswith('server/')):
                continue
            scanned += 1
            text = open(os.path.join(base, n), encoding='utf-8', errors='ignore').read()
            line_at = lambda p: text.count('\n', 0, p) + 1

            def add(bucket, key, row, allow_ref=None):
                nonlocal skipped
                if key in seen:
                    return
                seen.add(key)
                if (rel, key[1], allow_ref if allow_ref else key[2]) in allow:
                    skipped += 1
                    return
                bucket.append(row)

            for m in FROM_RE.finditer(text):
                table = m.group(1)
                if table not in cols:
                    continue
                nxt = FROM_RE.search(text, m.end())
                end = min(nxt.start() if nxt else len(text), m.end() + 1500)
                win = text[m.end():end]

                for sm in SELECT_RE.finditer(win):
                    for c in parse_select(sm.group(1)):
                        if c not in cols[table] and c not in PSEUDO:
                            add(read_f, (rel, table, c, 'r'),
                                (rel, line_at(m.end() + sm.start()), table, c))
                for fm in FILTER_RE.finditer(win):
                    c = fm.group(1)
                    if c not in cols[table] and c not in PSEUDO:
                        add(read_f, (rel, table, c, 'r'),
                            (rel, line_at(m.end() + fm.start()), table, c))
                for em in EQVAL_RE.finditer(win):
                    allowed = checks.get(f'{table}.{em.group(1)}')
                    if allowed and em.group(2) not in allowed:
                        add(value_f, (rel, table, em.group(1), em.group(2)),
                            (rel, line_at(m.end() + em.start()), table, em.group(1),
                             em.group(2), sorted(allowed)),
                            allow_ref=f'{em.group(1)}={em.group(2)}')
                for wm in WRITE_RE.finditer(win):
                    brace = m.end() + wm.end() - 1
                    body = obj_body(text, brace)
                    for km in KEY_RE.finditer(body):
                        k = km.group(1)
                        if k not in cols[table]:
                            add(write_f, (rel, table, k, 'w'),
                                (rel, line_at(brace), table, k, wm.group(1)))
                    for km in KV_RE.finditer(body):
                        allowed = checks.get(f'{table}.{km.group(1)}')
                        if allowed and km.group(2) not in allowed:
                            add(value_f, (rel, table, km.group(1), km.group(2)),
                                (rel, line_at(brace), table, km.group(1),
                                 km.group(2), sorted(allowed)),
                                allow_ref=f'{km.group(1)}={km.group(2)}')

            for rm in RPC_RE.finditer(text):
                fn = rm.group(1)
                if fn not in rpc_args:
                    continue
                for km in KEY_RE.finditer(obj_body(text, rm.end() - 1)):
                    if km.group(1) not in rpc_args[fn]:
                        add(rpc_f, (rel, fn, km.group(1), 'a'),
                            (rel, line_at(rm.start()), fn, km.group(1), sorted(rpc_args[fn])))

    total = len(read_f) + len(write_f) + len(value_f) + len(rpc_f)
    print(f"Catalogue : {ref} — {len(cols)} relations, {len(checks)} contraintes CHECK, "
          f"{len(rpc_args)} fonctions. {scanned} fichiers analysés"
          + (f", {skipped} faux positif(s) connu(s) ignoré(s).\n" if skipped else ".\n"))

    if read_f:
        print(f'✗ COLONNES LUES INEXISTANTES ({len(read_f)})')
        for f, l, t, c in sorted(read_f):
            print(f'    {f}:{l}  {t}.{c}')
    if write_f:
        print(f'\n✗ CLÉS ÉCRITES INEXISTANTES ({len(write_f)})')
        for f, l, t, c, verb in sorted(write_f):
            print(f'    {f}:{l}  {t}.{c}  [{verb}]')
    if value_f:
        print(f'\n✗ VALEURS HORS CONTRAINTE CHECK ({len(value_f)})')
        for f, l, t, c, v, allowed in sorted(value_f):
            print(f"    {f}:{l}  {t}.{c} = '{v}'  → autorisé : {allowed}")
    if rpc_f:
        print(f'\n✗ ARGUMENTS RPC INCONNUS ({len(rpc_f)})')
        for f, l, fn, k, allowed in sorted(rpc_f):
            print(f'    {f}:{l}  {fn}(… {k} …)  → attendus : {allowed}')

    if total == 0:
        print('✅ Aucun écart : toute colonne, valeur et argument cité par le code existe en base.')
        return 0

    print(f'\n{total} écart(s). Rappel : une seule colonne inexistante fait échouer '
          'TOUTE la requête — vérifier chaque cas avant de corriger (un embed ou un '
          'repli volontaire peut être un faux positif).')
    return 1


if __name__ == '__main__':
    sys.exit(main())
