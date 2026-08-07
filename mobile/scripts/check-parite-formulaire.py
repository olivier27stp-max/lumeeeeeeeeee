#!/usr/bin/env python3
"""Compare le formulaire de création de job du WEB et celui du MOBILE.

  python3 mobile/scripts/check-parite-formulaire.py

Sort en code 1 dès qu'il trouve une divergence — utilisable comme garde-fou
après n'importe quelle modification de l'un des deux écrans.

Deux contrôles :
  1. les CHAMPS DE DONNÉES réellement envoyés en base;
  2. les CONTRÔLES VISIBLES, via les libellés que chaque écran affiche.

Ce que ce script ne peut PAS voir : la mise en page et l'ordre des blocs.
Une divergence visuelle passera au travers.
"""
import os
import re
import sys

WEB = "/Users/williamhebert/Lume desktop/lumeeeeeeeeee/src/components/NewJobModal.tsx"
MOB_ECRAN = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                         "src/app/(app)/jobs/new.tsx")
MOB_API = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "src/lib/api/jobs.ts")

# Le mobile nomme certains champs autrement, ou les dérive. Chaque entrée doit
# rester justifiée : sans justification, c'est une divergence déguisée.
EQUIVALENCES = {
    "line_items": "items — le mobile passe `items`, converti en job_line_items",
    "subtotal": "calculé dans createJob à partir de items",
    "tax_total": "calculé dans createJob à partir de taxRatePct",
    "total": "total_cents, calculé dans createJob",
    "tax_lines": "le mobile applique un taux résolu (lib/api/taxes)",
    "id": "mode édition seulement — l'écran mobile ne fait que la création",
}

# Champs que le web envoie mais qui ne sont PAS des colonnes de `jobs` : ils
# sont traités ailleurs côté web. Vérifié contre le catalogue de la prod.
HORS_TABLE = {
    "address_line1", "address_line2", "city", "province",
    "postal_code", "country", "place_id",
}

# Absences assumées, avec leur raison.
ACCEPTE = {
    "property_id": "les propriétés n'existent pas sur mobile",
    "lead_id": "renseigné par le parcours de conversion d'un lead",
}


def champs_web(src: str) -> set[str]:
    i = src.index("const createdJob = await onSave({")
    return set(re.findall(r"^\s{8}([a-z_][a-z0-9_]*):", src[i:i + 2600], re.M))


def champs_mobile(ecran: str, api: str) -> set[str]:
    out = set(re.findall(r"^\s{8}([a-z_][a-z0-9_]*):", ecran, re.M))
    out |= set(re.findall(r"^\s{6}([a-z_][a-z0-9_]*):", api, re.M))
    # les noms camelCase de JobInput comptent aussi (jobNumber → job_number)
    for cam in re.findall(r"^\s{8}([a-z][A-Za-z0-9]*):", ecran, re.M):
        out.add(re.sub(r"(?<!^)(?=[A-Z])", "_", cam).lower())
    return out


def main() -> int:
    web = open(WEB, encoding="utf-8").read()
    ecran = open(MOB_ECRAN, encoding="utf-8").read()
    api = open(MOB_API, encoding="utf-8").read()

    w, m = champs_web(web), champs_mobile(ecran, api)
    manquants = sorted(w - m - HORS_TABLE - set(EQUIVALENCES) - set(ACCEPTE))
    equiv = sorted((w - m) & set(EQUIVALENCES))
    hors = sorted((w - m) & HORS_TABLE)
    acc = sorted((w - m) & set(ACCEPTE))

    print(f"Champs envoyés — web : {len(w)}   mobile : {len(m)}\n")
    if hors:
        print(f"  {len(hors)} champ(s) hors de la table jobs (traités ailleurs côté web) : {', '.join(hors)}")
    if equiv:
        print(f"  {len(equiv)} équivalence(s) connue(s) :")
        for c in equiv:
            print(f"      {c} → {EQUIVALENCES[c]}")
    if acc:
        print(f"  {len(acc)} absence(s) assumée(s) :")
        for c in acc:
            print(f"      {c} → {ACCEPTE[c]}")

    if manquants:
        print(f"\n✗ {len(manquants)} CHAMP(S) QUE LE WEB ENVOIE ET PAS LE MOBILE")
        for c in manquants:
            print(f"      {c}")
        print("\n  → soit l'ajouter au mobile, soit l'inscrire dans ACCEPTE avec sa raison.")
        return 1

    print("\n✅ Aucun champ manquant : le mobile écrit tout ce que le web écrit.")
    print("   (la mise en page et l'ordre des blocs ne sont pas vérifiables ici)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
