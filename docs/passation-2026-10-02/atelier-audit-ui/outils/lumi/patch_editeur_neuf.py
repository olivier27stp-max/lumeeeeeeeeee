def editer(p, remplacements):
    s = open(p, encoding='utf8').read()
    for o, n, c in remplacements:
        assert s.count(o) == c, (p, o[:70], s.count(o))
        s = s.replace(o, n)
    open(p, 'w', encoding='utf8', newline='\n').write(s)

editer('src/pages/AutomationBuilderPage.tsx', [
    ("En attendant, bâtis-la avec « Choisir le déclencheur » et le « + ».'", "En attendant, bâtis-la avec la carte « Quand » et le « + ».'", 1),
    ("Meanwhile, build it with “Choose the trigger” and “+”.'", "Meanwhile, build it with the “When” card and “+”.'", 1),
])
editer('tests/automatisations-editeur-launch.test.tsx', [
    ("cliquer(bouton('Choisir le déclencheur'));", "cliquer(bouton('Cliquer pour choisir un autre déclencheur'));", 2),
    ("""  it('ouvrir /automations/nouvelle ne crée rien', async () => {
    await ouvrir('/automations/nouvelle');
    expect(container.textContent).toContain('Nouvelle automatisation');
    expect(api.creer).not.toHaveBeenCalled();
    expect(api.modifier).not.toHaveBeenCalled();
  });
""", """  it('ouvrir /automations/nouvelle ne crée rien', async () => {
    await ouvrir('/automations/nouvelle');
    expect(container.textContent).toContain('Nouvelle automatisation');
    expect(api.creer).not.toHaveBeenCalled();
    expect(api.modifier).not.toHaveBeenCalled();
  });

  // Audit du 2026-10-01, vu sur lumecrm.net : l'écran d'une automatisation
  // neuve disait « Enregistré » (0 ligne en base), accueillait par une alerte
  // rouge, et titrait « Choisir le déclencheur » au-dessus de « Devis envoyé ».
  it('une automatisation neuve dit « Pas encore enregistrée », jamais « Enregistré »', async () => {
    await ouvrir('/automations/nouvelle');
    expect(container.textContent).toContain('Pas encore enregistrée');
    expect(container.querySelector('header')?.textContent).not.toMatch(/Enregistré(?!e)/);
  });

  it('un canevas vide n’accueille pas par une alerte rouge « à corriger avant de publier »', async () => {
    await ouvrir('/automations/nouvelle');
    expect(container.textContent).not.toMatch(/à corriger avant de publier/);
    expect(container.textContent).toContain('Ajouter une première étape');
  });

  it('le déclencheur en place est dit en clair : « Quand — Devis envoyé », avec l’invitation à en changer', async () => {
    await ouvrir('/automations/nouvelle');
    const carte = bouton('Cliquer pour choisir un autre déclencheur');
    expect(carte?.textContent).toMatch(/Quand\s*Devis envoyé/);
    expect(container.textContent).not.toContain('Choisir le déclencheur');
  });

  it('après la première sauvegarde, l’indicateur passe à « Enregistré »', async () => {
    await ouvrir('/automations/nouvelle');
    cliquer(bouton('Cliquer pour choisir un autre déclencheur'));
    cliquer(bouton('Facture envoyée'));
    await attendre();
    expect(api.creer).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain('Pas encore enregistrée');
  });
""", 1),
])
print('ok')
