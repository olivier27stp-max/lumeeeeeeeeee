#!/usr/bin/env python3
"""
Synchronisation incrémentale des fichiers du Storage de la PROD.

Appelé par `lume-backup.sh`. Reçoit :
  argv[1]  le dossier de travail où doit se trouver l'arborescence Storage
           (déjà peuplé par le cache déchiffré du passage précédent, ou vide)
  argv[2]  un JSON de la liste des objets, lu depuis `storage.objects`

Pourquoi lire la liste dans la BASE plutôt que par l'API `list` du Storage :
l'API ne descend pas récursivement dans les préfixes, elle renvoie des
« dossiers » qu'il faudrait re-parcourir un par un. La table `storage.objects`
donne tout d'un coup, avec l'eTag qui sert de test de changement.

Incrémental : un objet dont l'eTag n'a pas bougé n'est PAS retéléchargé. Le
premier passage récupère tout ; les suivants ne prennent que les nouveautés.

La prod n'est jamais écrite : uniquement des GET sur /storage/v1/object.
"""
import hashlib
import json
import os
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

INDEX = ".index.json"


def charger_config():
    """Identifiants hors dépôt, chmod 600. Jamais affichés."""
    conf = pathlib.Path(os.environ.get("LUME_BACKUP_CONF", pathlib.Path.home() / ".config/lume-backup")) / "env"
    vals = {}
    for ligne in conf.read_text().splitlines():
        if "=" in ligne and not ligne.startswith("#"):
            cle, valeur = ligne.split("=", 1)
            vals[cle.strip()] = valeur.strip()
    return vals["LUME_PROD_URL"].rstrip("/"), vals["LUME_PROD_SERVICE_ROLE_KEY"]


def telecharger(base, cle, bucket, nom, destination):
    url = f"{base}/storage/v1/object/{urllib.parse.quote(bucket)}/{urllib.parse.quote(nom)}"
    requete = urllib.request.Request(url, headers={"Authorization": f"Bearer {cle}", "apikey": cle})
    with urllib.request.urlopen(requete, timeout=300) as reponse:
        destination.parent.mkdir(parents=True, exist_ok=True)
        # Par blocs : un fichier de 50 Mo (la limite du bucket `attachments`)
        # ne doit pas passer entièrement en mémoire.
        empreinte = hashlib.sha256()
        with open(destination, "wb") as sortie:
            while True:
                bloc = reponse.read(1 << 20)
                if not bloc:
                    break
                sortie.write(bloc)
                empreinte.update(bloc)
    return empreinte.hexdigest()


def main():
    racine = pathlib.Path(sys.argv[1])
    objets = json.loads(pathlib.Path(sys.argv[2]).read_text())
    base, cle = charger_config()
    racine.mkdir(parents=True, exist_ok=True)

    chemin_index = racine / INDEX
    try:
        index = json.loads(chemin_index.read_text())
    except Exception:
        # Cache absent ou illisible : on retombe sur un téléchargement complet
        # plutôt que de risquer une archive incomplète.
        index = {}

    nouvel_index = {}
    repris, telecharges, echecs = 0, 0, []

    for objet in objets:
        bucket, nom = objet["b"], objet["n"]
        etag, taille = objet.get("e"), objet.get("s")
        identifiant = f"{bucket}/{nom}"
        fichier = racine / bucket / nom

        ancien = index.get(identifiant)
        if ancien and ancien.get("etag") == etag and fichier.is_file() and fichier.stat().st_size == (taille or 0):
            nouvel_index[identifiant] = ancien
            repris += 1
            continue

        try:
            sha = telecharger(base, cle, bucket, nom, fichier)
        except urllib.error.HTTPError as e:
            # Un objet référencé en base mais absent du stockage ne doit pas
            # faire échouer toute la sauvegarde : on le signale et on continue.
            echecs.append(f"{identifiant} (HTTP {e.code})")
            continue
        except Exception as e:  # réseau, délai dépassé
            echecs.append(f"{identifiant} ({type(e).__name__})")
            continue
        nouvel_index[identifiant] = {"etag": etag, "taille": taille, "sha256": sha}
        telecharges += 1

    # Objets disparus de la prod : on les retire aussi du cache, sinon il
    # enflerait indéfiniment et l'archive décrirait un état qui n'existe plus.
    attendus = {f"{o['b']}/{o['n']}" for o in objets}
    supprimes = 0
    for identifiant in list(index):
        if identifiant not in attendus:
            obsolete = racine / identifiant
            if obsolete.is_file():
                obsolete.unlink()
                supprimes += 1
    for repertoire in sorted((p for p in racine.rglob("*") if p.is_dir()), reverse=True):
        if not any(repertoire.iterdir()):
            repertoire.rmdir()

    chemin_index.write_text(json.dumps(nouvel_index, indent=1, sort_keys=True))

    print(json.dumps({
        "objets_attendus": len(objets),
        "repris_du_cache": repris,
        "telecharges": telecharges,
        "supprimes": supprimes,
        "echecs": echecs,
    }))
    # Un objet manquant est une anomalie : le script appelant en fait un ÉCHEC.
    return 1 if echecs else 0


if __name__ == "__main__":
    sys.exit(main())
