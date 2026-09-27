#!/usr/bin/env python3
"""
Remonte les fichiers du Storage depuis une sauvegarde déchiffrée.

    python3 scripts/lume-restore-storage.py <dossier storage/> <url projet> <cle service_role>

Le dossier attendu est celui qui sort de l'archive : storage/<bucket>/<chemin>.
Les buckets doivent exister au préalable — ils sont recréés par `data.sql`
(table storage.buckets), donc restaure la base AVANT de lancer ceci.

Idempotent : `x-upsert: true`, donc on peut relancer sans tout casser si la
connexion coupe au fichier 120 sur 143.
"""
import json
import mimetypes
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

INDEX = ".index.json"


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    racine = pathlib.Path(sys.argv[1])
    base = sys.argv[2].rstrip("/")
    cle = sys.argv[3]
    if not racine.is_dir():
        sys.exit(f"dossier introuvable : {racine}")

    fichiers = [p for p in sorted(racine.rglob("*")) if p.is_file() and p.name != INDEX]
    print(f"{len(fichiers)} fichier(s) à remonter vers {base}")

    envoyes, echecs = 0, []
    for chemin in fichiers:
        relatif = chemin.relative_to(racine)
        bucket = relatif.parts[0]
        nom = "/".join(relatif.parts[1:])
        if not nom:
            continue
        url = f"{base}/storage/v1/object/{urllib.parse.quote(bucket)}/{urllib.parse.quote(nom)}"
        type_mime = mimetypes.guess_type(nom)[0] or "application/octet-stream"
        requete = urllib.request.Request(
            url, data=chemin.read_bytes(), method="POST",
            headers={"Authorization": f"Bearer {cle}", "apikey": cle,
                     "Content-Type": type_mime, "x-upsert": "true"})
        try:
            urllib.request.urlopen(requete, timeout=300)
            envoyes += 1
            if envoyes % 20 == 0:
                print(f"  {envoyes}/{len(fichiers)}…")
        except urllib.error.HTTPError as e:
            corps = e.read().decode("utf-8", "replace")[:200]
            echecs.append(f"{bucket}/{nom} : HTTP {e.code} {corps}")
        except Exception as e:
            echecs.append(f"{bucket}/{nom} : {type(e).__name__}")

    print(f"\n{envoyes} envoyé(s), {len(echecs)} échec(s)")
    for e in echecs[:20]:
        print("  " + e)
    if echecs:
        print("\nRelance la même commande : l'envoi est idempotent (x-upsert).")
    return 1 if echecs else 0


if __name__ == "__main__":
    sys.exit(main())
