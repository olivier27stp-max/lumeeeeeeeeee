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


CLE = re.compile(r"^\s*([A-Za-z_$][\w$]*)\s*:\s*(.*)$")


def dictionnaire(chemin: str) -> dict[str, str]:
    """Aplatit un fr.ts en {chemin.pointé: texte}."""
    out: dict[str, str] = {}
    pile: list[str] = []
    for brute in open(chemin, encoding="utf-8"):
        ligne = brute.rstrip("\n")
        nue = ligne.strip()
        if not nue or nue.startswith(("//", "/*", "*")):
            continue
        m = CLE.match(ligne)
        if m:
            cle, reste = m.group(1), m.group(2).strip()
            if reste.startswith("{"):
                pile.append(cle)
                if not reste[1:].strip():
                    continue
            else:
                val = reste.rstrip(",").strip()
                if len(val) >= 2 and val[0] in "'\"`" and val[-1] == val[0]:
                    out[".".join(pile + [cle])] = val[1:-1]
                continue
        for ch in nue:
            if ch == "}" and pile:
                pile.pop()
    return out


def normaliser(s: str) -> str:
    """Compare le SENS, pas la ponctuation ni la casse."""
    s = s.lower().replace("\\'", "'").replace("’", "'")
    s = re.sub(r"\{[a-z]+\}", "", s)
    return re.sub(r"[^a-zà-ÿ0-9']+", " ", s).strip()


# Libellés du web dont l'absence sur mobile est assumée — chacun avec sa raison.
# Sans raison, c'est une divergence qu'on cache.
LIBELLES_ACCEPTES = {
    # L'assignation d'équipe existe sur mobile, mais dans son propre bloc en
    # haut du formulaire plutôt que dans la carte « Règle ».
    "assigner une équipe", "sélectionner une équipe", "non assigné",
    "chargement des équipes", "impossible de charger les équipes",
    "voir le calendrier",
    # L'app mobile tutoie (« Choisis une visite… ») là où le web vouvoie.
    "choisissez une visite dans la liste pour modifier ses produits et services",
    "sélectionnez d'abord les mois de passage dans calendrier du plan de service",
    # Chaîne restée en anglais dans le dictionnaire du web.
    "request a payment on file",
    # Le web affiche l'état de configuration des taxes dans son bloc
    # facturation; le mobile résout le taux silencieusement (lib/api/taxes).
    "taxes", "aucune taxe configurée", "chargement des taxes",
    "aller aux paramètres de taxes",
    # Titres de blocs et sous-totaux propres à la mise en page web.
    "visite", "visites", "produits services", "facturation et paiement",
    "total avant taxes", "total du job", "le total du job est entièrement couvert",
    # Étiquettes d'accessibilité de boutons-icônes (le mobile a les mêmes
    # boutons, sans libellé lisible).
    "retirer cette visite", "ajouter une visite ce mois ci", "année du plan",
    "ajouter une visite",
    # Boutons portés par le composant LineItemsEditor, que ce script ne lit pas
    # (il ne regarde que l'écran). Ils existent bien sur mobile.
    "ajouter du catalogue", "ajouter une ligne",
    # Titre du bloc web « Assignation » : le mobile l'appelle « Équipe assignée ».
    "assignation",
}


def libelles_visibles(src: str, dico: dict[str, str], prefixes: tuple[str, ...]) -> set[str]:
    """Textes français que l'écran affiche : littéraux + clés résolues."""
    out: set[str] = set()
    for m in re.finditer(r"language === 'fr' \? '([^']{3,60})'", src):
        out.add(normaliser(m.group(1)))
    for m in re.finditer(r"\bt\.([a-zA-Z]+)\.([a-zA-Z_]+)\b", src):
        cle = f"{m.group(1)}.{m.group(2)}"
        if cle in dico:
            out.add(normaliser(dico[cle]))
    for m in re.finditer(r"\bc\.([a-zA-Z_]+)\b", src):
        for p in prefixes:
            if f"{p}.{m.group(1)}" in dico:
                out.add(normaliser(dico[f"{p}.{m.group(1)}"]))
    return {s for s in out if len(s) > 2}


def bloc_plan_web(src: str) -> str:
    """Le seul bloc « plan de service » du web — comparer tout le formulaire
    produirait surtout du bruit (le mobile gère client, propriété et
    validations par ses propres écrans, avec ses propres formulations)."""
    debut = src.index("{isServicePlan && (")
    fin = src.index("{language === 'fr' ? 'Facturation et paiements'", debut)
    fin = src.index("</Box>", fin)
    return src[debut:fin]


def bloc_plan_mobile(src: str) -> str:
    debut = src.index("{jobType === 'recurring' ? (")
    fin = src.rindex("t.mobilePlan.autoChargeHint")
    return src[debut:fin]


def comparer_libelles(web: str, ecran: str) -> list[str]:
    dw = dictionnaire("/Users/williamhebert/Lume desktop/lumeeeeeeeeee/src/i18n/fr.ts")
    dm = dictionnaire(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                   "src/lib/i18n/fr.ts"))
    lw = libelles_visibles(bloc_plan_web(web), dw, ("modals",))
    lm = libelles_visibles(bloc_plan_mobile(ecran), dm, ("mobileJobs", "mobilePlan", "modals"))
    return sorted(s for s in lw - lm if s not in LIBELLES_ACCEPTES)


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

    echec = False
    if manquants:
        print(f"\n✗ {len(manquants)} CHAMP(S) QUE LE WEB ENVOIE ET PAS LE MOBILE")
        for c in manquants:
            print(f"      {c}")
        print("  → soit l'ajouter au mobile, soit l'inscrire dans ACCEPTE avec sa raison.")
        echec = True
    else:
        print("\n✅ Champs : le mobile écrit tout ce que le web écrit.")

    absents = comparer_libelles(web, ecran)
    if absents:
        print(f"\n✗ {len(absents)} LIBELLÉ(S) AFFICHÉ(S) PAR LE WEB ET PAS PAR LE MOBILE")
        for s in absents:
            print(f"      « {s} »")
        print("  → soit ajouter le contrôle, soit l'inscrire dans LIBELLES_ACCEPTES.")
        echec = True
    else:
        print("✅ Contrôles : le mobile affiche tous les libellés du web.")

    print("\n   Non vérifiable ici : la mise en page et l'ordre des blocs.")
    return 1 if echec else 0


if __name__ == "__main__":
    sys.exit(main())
