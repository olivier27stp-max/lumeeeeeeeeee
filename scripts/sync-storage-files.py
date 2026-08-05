#!/usr/bin/env python3
"""
sync-storage-files.py — copie les FICHIERS du stockage de la prod vers le clone local.

C'est l'angle mort des procédures de clonage : un dump SQL ne copie que
`storage.objects`, c'est-à-dire la *fiche* de chaque fichier. Les fichiers
eux-mêmes vivent hors de la base. Sans cette étape, le clone affiche des
images et pièces jointes cassées **en ayant l'air complet**.

Variables attendues :
  PROD_SRK    clé service_role de la PROD (elle est sur Railway, pas dans
              .env.local qui pointe sur le staging)
  CLONE_DIR   dossier du clone local (contient supabase/ et storage-files/)
"""
import json
import mimetypes
import os
import subprocess
import sys
import urllib.parse
import urllib.request

PROD_URL = 'https://bbzcuzqfgsdvjsymfwmr.supabase.co'
LOCAL_URL = 'http://127.0.0.1:54321'


def local_service_key(clone_dir):
    """Le service de stockage local attend le JWT `service_role`, PAS la clé
    moderne `sb_secret_…` (qui répond « Invalid Compact JWS »). On lit les clés
    de la pile plutôt que de les figer : elles changent d'une machine à l'autre."""
    r = subprocess.run(['npx', '--yes', 'supabase@latest', 'status', '-o', 'json'],
                       cwd=clone_dir, capture_output=True, text=True)
    # `supabase status` préfixe sa sortie de lignes de service et formate le
    # JSON sur plusieurs lignes : on repart de la première accolade.
    i = r.stdout.find('{')
    if i < 0:
        return ''
    try:
        return json.loads(r.stdout[i:]).get('SERVICE_ROLE_KEY', '')
    except json.JSONDecodeError:
        return ''

SRK = os.environ.get('PROD_SRK')
CLONE = os.environ.get('CLONE_DIR')
if not SRK or not CLONE:
    sys.exit('ERREUR: PROD_SRK et CLONE_DIR requis.')
DEST = os.path.join(CLONE, 'storage-files')
LOCAL_KEY = local_service_key(CLONE)
if not LOCAL_KEY:
    sys.exit('ERREUR: clé service_role locale introuvable (supabase status).')


def local_sql(sql):
    r = subprocess.run(
        ['docker', 'run', '--rm', '--network', 'host', '-e', 'PGPASSWORD=postgres',
         'postgres:17', 'psql', '-h', '127.0.0.1', '-p', '54322', '-U', 'postgres',
         '-d', 'postgres', '-tAc', sql],
        capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(r.stderr[-800:])
    return r.stdout.strip()


def prod_object_list():
    """La liste vient de la PROD, pas du local : le local est vidé avant cette
    étape, et c'est l'état de la prod qui fait foi."""
    token = None
    for line in open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env.local')):
        if line.startswith('SUPABASE_ACCESS_TOKEN='):
            token = line.split('=', 1)[1].strip().strip('"').strip("'")
    if not token:
        sys.exit('ERREUR: SUPABASE_ACCESS_TOKEN requis dans .env.local')
    ref = PROD_URL.split('//')[1].split('.')[0]
    req = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{ref}/database/query',
        data=json.dumps({'query':
            "select coalesce(json_agg(json_build_object('b', bucket_id, 'n', name)), '[]'::json) as l "
            "from storage.objects"}).encode(),
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json',
                 'User-Agent': 'curl/8.7.1'},
        method='POST')
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode())[0]['l']


def main():
    rows = prod_object_list()
    print(f'   {len(rows)} fichier(s) en prod à synchroniser.')

    # 1. Téléchargement depuis la prod (cache local : on ne retélécharge pas)
    dl = skip = fail = 0
    for r in rows:
        out = os.path.join(DEST, r['b'], r['n'])
        if os.path.exists(out) and os.path.getsize(out) > 0:
            skip += 1
            continue
        os.makedirs(os.path.dirname(out), exist_ok=True)
        url = f"{PROD_URL}/storage/v1/object/{r['b']}/{urllib.parse.quote(r['n'])}"
        req = urllib.request.Request(url, headers={'Authorization': f'Bearer {SRK}', 'apikey': SRK})
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                open(out, 'wb').write(resp.read())
            dl += 1
        except Exception as e:
            fail += 1
            print(f"      échec téléchargement {r['b']}/{r['n']} : {str(e)[:60]}")
    print(f'   téléchargés {dl} · déjà en cache {skip} · échecs {fail}')

    # 2. Les fiches viennent du dump, mais les fichiers ne sont pas dans le
    #    stockage local : on repart des fiches à zéro et on téléverse, pour que
    #    fiche et fichier soient toujours cohérents.
    local_sql("set session_replication_role=replica; delete from storage.objects;")

    up = ufail = 0
    for r in rows:
        src = os.path.join(DEST, r['b'], r['n'])
        if not os.path.exists(src):
            continue
        ctype = mimetypes.guess_type(src)[0] or 'application/octet-stream'
        req = urllib.request.Request(
            f"{LOCAL_URL}/storage/v1/object/{r['b']}/{urllib.parse.quote(r['n'])}",
            data=open(src, 'rb').read(),
            headers={'Authorization': f'Bearer {LOCAL_KEY}', 'Content-Type': ctype,
                     'x-upsert': 'true'},
            method='POST')
        try:
            urllib.request.urlopen(req, timeout=300)
            up += 1
        except Exception as e:
            ufail += 1
            print(f"      échec téléversement {r['b']}/{r['n']} : {str(e)[:60]}")
    print(f'   téléversés localement {up} · échecs {ufail}')
    return 1 if (fail or ufail) else 0


if __name__ == '__main__':
    sys.exit(main())
