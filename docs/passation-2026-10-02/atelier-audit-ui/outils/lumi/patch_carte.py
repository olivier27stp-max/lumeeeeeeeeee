p = 'server/lib/support/carte-app.ts'
b = open(p, 'rb').read()
s = b.decode('utf8')
a = " Canevas : la carte « Quand » s'ouvre sur ses réglages,"
assert s.count(a) == 1, s.count(a)
n = (" Une automatisation NEUVE (« Partir de zéro ») n'existe en base qu'à la première modification : d'ici là l'éditeur affiche « Pas encore enregistrée », "
     "puis « Modifié », « Enregistrement… » et « Enregistré ». Elle part avec le déclencheur « Devis envoyé », écrit sur la carte « Quand » (cliquer pour en choisir un autre)."
     " Dans la liste, Échap ferme le menu « … » d'une ligne et le menu « Créer »."
     + a)
open(p, 'wb').write(s.replace(a, n).encode('utf8'))
print('ok')
