#!/usr/bin/env python3
"""
sync-acl-from-prod.py — aligne les PRIVILÈGES du staging sur ceux de la prod.

Étape indispensable après un clonage (`db:clone-staging`). Un projet Supabase
neuf accorde par défaut TOUS les droits à `authenticated` sur les nouvelles
tables ; or un dump ne peut qu'AJOUTER des privilèges, jamais en retirer. Sans
cette passe, la copie est **plus permissive que la prod** : `authenticated`
obtient INSERT/UPDATE/DELETE là où la prod ne donne que SELECT.

Ce que ça fait, pour chaque table / vue / séquence / fonction :
    REVOKE ALL      (remise à zéro)
    GRANT …         (exactement ce que la prod accorde)

⚠️ Les privilèges par COLONNE sont réappliqués APRÈS le REVOKE : un
   `revoke all on table` les efface aussi (173 colonnes concernées ici).
⚠️ L'entrée `=X/postgres` d'un ACL désigne PUBLIC (grantee vide) — l'oublier
   laisse 31 fonctions divergentes.

Usage : python3 scripts/sync-acl-from-prod.py [--dry-run]
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRY = '--dry-run' in sys.argv

PRIV = {'a': 'INSERT', 'r': 'SELECT', 'w': 'UPDATE', 'd': 'DELETE', 'D': 'TRUNCATE',
        'x': 'REFERENCES', 't': 'TRIGGER', 'X': 'EXECUTE', 'U': 'USAGE',
        'C': 'CREATE', 'c': 'CONNECT', 'T': 'TEMPORARY', 'm': 'MAINTAIN'}
ROLES = 'public, postgres, anon, authenticated, service_role, supabase_auth_admin'

ACL_SQL = """
select json_build_object(
  'rel', (select json_agg(json_build_object('kind', c.relkind,
            'ident', quote_ident(n.nspname)||'.'||quote_ident(c.relname), 'acl', c.relacl::text))
          from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relkind in ('r','v','m','S') and c.relacl is not null),
  'col', (select json_agg(json_build_object(
            'ident', quote_ident(n.nspname)||'.'||quote_ident(c.relname),
            'col', a.attname, 'acl', a.attacl::text))
          from pg_attribute a join pg_class c on c.oid=a.attrelid
          join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and a.attnum>0 and not a.attisdropped and a.attacl is not null),
  'fn', (select json_agg(json_build_object('sig', p.oid::regprocedure::text, 'acl', p.proacl::text))
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proacl is not null)
) as acl;
"""


def env(name):
    path = os.path.join(ROOT, '.env.local')
    if os.path.exists(path):
        for line in open(path):
            if line.startswith(name + '='):
                return line.split('=', 1)[1].strip().strip('"').strip("'")
    return os.environ.get(name)


def query(ref, sql):
    req = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{ref}/database/query',
        data=json.dumps({'query': sql}).encode(),
        headers={'Authorization': f'Bearer {env("SUPABASE_ACCESS_TOKEN")}',
                 'Content-Type': 'application/json',
                 'User-Agent': 'curl/8.7.1'},
        method='POST')
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode())


def parse(aclstr):
    """'{role=privs/grantor,...}' → [(grantee, [PRIVILÈGE, …])] ; grantee vide = PUBLIC."""
    out = []
    for item in re.findall(r'(?:^|,)([^,]*=[^,]*?/[^,]+)', aclstr.strip('{}')):
        grantee, rest = item.split('=', 1)
        names = [PRIV[c] for c in rest.split('/')[0] if c in PRIV]
        if names:
            out.append((grantee.strip('"').strip() or 'PUBLIC', names))
    return out


def main():
    staging, prod = env('SUPABASE_PROJECT_REF'), env('SUPABASE_PROJECT_REF_PROD')
    password = env('SUPABASE_DB_PASSWORD')
    if not (staging and prod and password):
        sys.exit('ERREUR: SUPABASE_PROJECT_REF, SUPABASE_PROJECT_REF_PROD et '
                 'SUPABASE_DB_PASSWORD requis dans .env.local')
    if staging == prod:
        sys.exit('REFUS: la cible est la PROD. Remets SUPABASE_PROJECT_REF sur le staging.')

    d = query(prod, ACL_SQL)[0]['acl']
    lines = ["-- Privilèges alignés sur la prod (généré par sync-acl-from-prod.py)."]
    for r in d['rel'] or []:
        kind = {'r': 'table', 'v': 'table', 'm': 'table', 'S': 'sequence'}[r['kind']]
        lines.append(f"revoke all on {kind} {r['ident']} from {ROLES};")
        for g, p in parse(r['acl']):
            lines.append(f"grant {', '.join(p)} on {kind} {r['ident']} to {g};")
    for c in d['col'] or []:                      # APRÈS les revoke : sinon effacés
        for g, p in parse(c['acl']):
            cols = ', '.join(f'{x} ({c["col"]})' for x in p)
            lines.append(f"grant {cols} on table {c['ident']} to {g};")
    for f in d['fn'] or []:
        lines.append(f"revoke all on function {f['sig']} from {ROLES};")
        for g, p in parse(f['acl']):
            lines.append(f"grant {', '.join(p)} on function {f['sig']} to {g};")

    sql = '\n'.join(lines) + '\n'
    print(f'{len(lines) - 1} instructions générées depuis la prod ({prod}).')
    if DRY:
        print('[dry-run] rien appliqué.')
        return 0

    host = None
    for h in ('aws-0-ca-central-1.pooler.supabase.com', 'aws-1-ca-central-1.pooler.supabase.com'):
        probe = subprocess.run(
            ['docker', 'run', '--rm', '-e', f'PGPASSWORD={password}', 'postgres:17', 'psql',
             '-h', h, '-p', '5432', '-U', f'postgres.{staging}', '-d', 'postgres', '-tAc', 'select 1'],
            capture_output=True)
        if probe.returncode == 0:
            host = h
            break
    if not host:
        sys.exit('ERREUR: aucun pooler ne répond pour le staging.')

    with tempfile.TemporaryDirectory() as tmp:
        open(os.path.join(tmp, 'acl.sql'), 'w').write(sql)
        res = subprocess.run(
            ['docker', 'run', '--rm', '-e', f'PGPASSWORD={password}', '-v', f'{tmp}:/s', 'postgres:17',
             'psql', '-h', host, '-p', '5432', '-U', f'postgres.{staging}', '-d', 'postgres',
             '--single-transaction', '-v', 'ON_ERROR_STOP=1', '-f', '/s/acl.sql'],
            capture_output=True, text=True)
    if res.returncode != 0:
        print(res.stderr[-2000:], file=sys.stderr)
        sys.exit('ÉCHEC de l\'alignement des privilèges.')
    print(f'✅ Privilèges alignés sur le staging ({staging}).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
