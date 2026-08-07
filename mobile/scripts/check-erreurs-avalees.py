#!/usr/bin/env python3
"""Cherche les erreurs Supabase AVALÉES dans le code mobile.

supabase-js ne lève jamais d'exception : il renvoie {data, error}. Une erreur
qu'on ne lit pas transforme une panne en écran vide, sans trace nulle part.
C'est ce motif qui a produit l'essentiel des ~200 bugs trouvés côté web.

Trois gravités :
  1. ERREUR JAMAIS LUE   — `const { data } = await supabase...` : le champ
     error n'est même pas déstructuré. Le pire : rien ne peut le détecter.
  2. ERREUR AVALÉE       — `if (error) return []` / `return null` : la panne
     devient un résultat vide, indiscernable d'une absence de données.
  3. PROMESSE MUETTE     — `.catch(() => {})` / `.then(undefined, () => {})`.

Usage : check-erreurs-avalees.py <racine>
"""
import os
import re
import sys

RACINE = sys.argv[1] if len(sys.argv) > 1 else "."

# `const { data } = await supabase` sans `error`
JAMAIS_LUE = re.compile(r"const\s*\{\s*data(?:\s*:\s*\w+)?\s*\}\s*=\s*await\s+supabase")
# `if (error) return []` ou `return null` ou `return;`
AVALEE = re.compile(r"if\s*\(\s*\w*[Ee]rror\w*\s*\)\s*return\s*(\[\]|null|undefined|;|\{\})")
# `.catch(() => …)` sans corps utile
MUETTE = re.compile(r"\.catch\(\s*\(\s*\)\s*=>\s*(\{\s*\}|null|undefined|\[\])\s*\)|\.then\(\s*undefined\s*,\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)")

trouve = {"jamais_lue": [], "avalee": [], "muette": []}

for dp, dirs, names in os.walk(RACINE):
    dirs[:] = [d for d in dirs if d not in ("node_modules", ".expo", "ios", "android", ".git", "dist")]
    for n in names:
        if not n.endswith((".ts", ".tsx")):
            continue
        chemin = os.path.join(dp, n)
        rel = os.path.relpath(chemin, RACINE)
        txt = open(chemin, encoding="utf-8", errors="ignore").read()
        lignes = txt.split("\n")
        for i, ligne in enumerate(lignes, 1):
            if JAMAIS_LUE.search(ligne):
                trouve["jamais_lue"].append((rel, i, ligne.strip()[:96]))
            if AVALEE.search(ligne):
                trouve["avalee"].append((rel, i, ligne.strip()[:96]))
            if MUETTE.search(ligne):
                trouve["muette"].append((rel, i, ligne.strip()[:96]))

TITRES = {
    "jamais_lue": "ERREUR JAMAIS LUE — le champ `error` n'est pas déstructuré",
    "avalee": "ERREUR AVALÉE — la panne devient un résultat vide",
    "muette": "PROMESSE MUETTE — l'échec est ignoré",
}

total = sum(len(v) for v in trouve.values())
print(f"Racine : {RACINE}\n{total} occurrence(s) au total\n")
for cat in ("jamais_lue", "avalee", "muette"):
    lot = trouve[cat]
    print(f"═══ {len(lot)} · {TITRES[cat]} ═══")
    for rel, i, l in sorted(lot):
        print(f"  {rel}:{i}")
        print(f"      {l}")
    print()
