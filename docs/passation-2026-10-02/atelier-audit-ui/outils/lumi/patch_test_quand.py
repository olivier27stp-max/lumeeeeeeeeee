p='tests/automatisations-editeur-launch.test.tsx'
s=open(p,encoding='utf8').read()
a="""    await ouvrir('/automations/nouvelle');
    const carte = bouton('Cliquer pour choisir un autre déclencheur');
    expect(carte?.textContent).toMatch(/Quand\s*Devis envoyé/);"""
n="""    // Le catalogue des autres tests est vide ; ici on veut le VRAI libellé.
    api.charger.mockImplementationOnce(async () => ({
      rules: etat.regles,
      catalogue: { declencheurs: [{ cle: 'quote.sent', fr: 'Devis envoyé', en: 'Quote sent' }], actions: [] },
    }) as never);
    await ouvrir('/automations/nouvelle');
    const carte = bouton('Cliquer pour choisir un autre déclencheur');
    expect(carte?.textContent).toMatch(/Quand\s*Devis envoyé/);"""
assert s.count(a)==1
open(p,'w',encoding='utf8',newline='\n').write(s.replace(a,n)); print('ok')
