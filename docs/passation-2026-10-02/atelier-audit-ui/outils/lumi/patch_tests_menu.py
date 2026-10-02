import re
def remplacer(p, paires):
    s = open(p, encoding='utf8').read()
    for o, n in paires:
        assert o in s, (p, o)
        s = s.replace(o, n)
    open(p, 'w', encoding='utf8', newline='\n').write(s)

# Le menu « ⋮ » d'une ligne est rendu dans document.body (hors de la carte qui le rognait) :
# les aides cherchent les boutons dans la page entière.
remplacer('tests/automatisations-corbeille.test.tsx', [
    ("container.querySelectorAll('button')", "document.body.querySelectorAll('button')"),
    ("container.querySelectorAll('[role=\"menuitem\"]')", "document.body.querySelectorAll('[role=\"menuitem\"]')"),
])
remplacer('tests/automatisations-liste-launch.test.tsx', [
    ("container.querySelectorAll('button')", "document.body.querySelectorAll('button')"),
])
remplacer('tests/automation/front-automations-ecran.test.tsx', [
    ("const boutons = () => Array.from(conteneur.querySelectorAll('button'));",
     "// Dans la page entière : le menu « ⋮ » d'une ligne est rendu dans document.body.\nconst boutons = () => Array.from(document.body.querySelectorAll('button'));"),
    ("const menuOuvert = () => conteneur.querySelector('[role=\"menu\"]');", "const menuOuvert = () => document.body.querySelector('[role=\"menu\"]');"),
])
print('ok')
