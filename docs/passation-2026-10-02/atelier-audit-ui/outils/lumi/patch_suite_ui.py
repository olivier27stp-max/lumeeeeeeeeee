p='tests/automations-suite/ui/71-ui-editeur.test.ts'
s=open(p,encoding='utf8').read()
n1=s.count("{ name: /Choisir le déclencheur/ }")
assert n1==3, n1
s=s.replace("{ name: /Choisir le déclencheur/ }","{ name: /Cliquer pour choisir un autre déclencheur/ }")
a="o.page.getByText(/chose\(s\) à corriger avant de publier/)"
assert s.count(a)==1, s.count(a)
s=s.replace(a,"o.page.getByText(/choses? à corriger avant de publier/)")
open(p,'w',encoding='utf8',newline='\n').write(s); print('ok')
