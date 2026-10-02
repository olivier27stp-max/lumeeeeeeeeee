# -*- coding: utf-8 -*-
import io
p = 'D:/lume-uiaudit/wt-lumi/AUTOMATIONS_UI_AUDIT.md'
s = io.open(p, encoding='utf-8', newline='').read()
nl = '\r\n' if '\r\n' in s else '\n'
liste_majeurs = nl.join([
    "| Liste | « Client inactif » publié EN LOT sans confirmation, alors que l’interrupteur de la même ligne annonce le nombre de clients visés et demande confirmation | `liste/07-lot` |",
    "| Liste | Corriger un texto d’une automatisation à l’ancien format qui en a deux réécrit aussi l’autre | `liste/05-lignes` |",
    "| Liste | Rôle « voir sans modifier » : le menu et la Vue d’ensemble mènent à « Accès restreint » | `liste/12-permissions` |",
    "| Liste | Onglet « À vérifier » : au-delà de 200 échecs récents une automatisation en échec en sort ; si la lecture des échecs tombe, l’écran dit « Aucune erreur — tout roule » | `liste/10-volume`, `/03` |",
    "| Liste | Menu « ⋮ » d’une ligne : depuis qu’il est rendu hors du tableau (#859, mon correctif), la touche Tab ne l’atteint plus après son bouton | `liste/11-clavier` |",
])
valeurs = {
    '{{DEFAUTS_TOTAL}}': 'environ 220',
    '{{ROUGES_TOTAL}}': '236',
    '{{LISTE_TESTS}}': '205', '{{LISTE_OK}}': '156', '{{LISTE_DEF}}': '49', '{{LISTE_AUTRES}}': '0',
    '{{TOTAL_TESTS}}': '1 058', '{{TOTAL_OK}}': '822', '{{TOTAL_AUTRES}}': '0',
    '{{MARQUES_RETIREES}}': '81',
    '{{LISTE_MAJEURS}}': liste_majeurs,
}
for k, v in valeurs.items():
    if k not in s:
        raise SystemExit('absent : ' + k)
    s = s.replace(k, v)
a = "**A. Les défauts sortis de la passe complète** — environ 220 défauts, 236 tests rouges."
if s.count(a) != 1:
    raise SystemExit('phrase A absente')
s = s.replace(a, "**A. Les défauts sortis de la passe complète** — environ 220 défauts pour 236 tests rouges (une même racine est parfois vue par deux chemins).")
if '{{' in s:
    raise SystemExit('jeton restant')
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
