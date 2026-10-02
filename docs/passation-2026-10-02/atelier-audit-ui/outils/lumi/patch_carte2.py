p = 'server/lib/support/carte-app.ts'
s = open(p, 'rb').read().decode('utf8')
a = " Dans la liste, Échap ferme le menu « … » d'une ligne et le menu « Créer »."
assert s.count(a) == 1, s.count(a)
n = a + (" Une automatisation à la CORBEILLE ouverte par son adresse ne s'édite pas : l'écran dit « Cette automatisation est à la corbeille »,"
         " avec « Restaurer » (elle revient en brouillon) et « Mes automatisations ».")
open(p, 'wb').write(s.replace(a, n).encode('utf8'))
print('ok')
