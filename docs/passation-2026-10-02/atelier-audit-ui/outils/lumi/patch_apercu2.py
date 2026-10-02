p='server/routes/emails.ts'
s=open(p,encoding='utf8').read()
a="    const avecExemples = (t: string) => remplacerParExemples(t, type, langueEntreprise(company) === 'fr');"
assert s.count(a)==1
n="""    /* Un courriel d'automatisation écrit ses variables autrement qu'un modèle
       de facture ([client_first_name], [company_name]…) : sans la table des
       automatisations, l'aperçu « réel » laissait « Bonjour [client_first_name] »
       entre crochets alors que l'aperçu compact de la liste affichait « Marie ». */
    const avecExemples = (t: string) => {
      const rendu = remplacerParExemples(t, type, langueEntreprise(company) === 'fr');
      return type ? rendu : remplacerVariables(rendu);
    };"""
s=s.replace(a,n)
a2="import { remplacerParExemples } from '../../src/lib/variablesCourriel';"
assert s.count(a2)==1
s=s.replace(a2,a2+"\nimport { remplacerVariables } from '../../src/lib/emailBodyText';")
open(p,'w',encoding='utf8',newline='\n').write(s); print('ok')
