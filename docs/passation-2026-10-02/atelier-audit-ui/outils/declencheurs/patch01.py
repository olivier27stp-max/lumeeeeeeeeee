import io
p='e2e/automations/declencheurs/01-tiroir-declencheurs.spec.ts'
s=io.open(p,encoding='utf-8').read()
i=s.index("  test('[EDT-056] « Fermer » referme le tiroir sans rien changer ; Échap aussi @defaut'")
j=s.index("  test('[EDT-058] rechoisir le déclencheur déjà en place")
nouveau = """  test('[EDT-056] « Fermer » referme le tiroir sans rien changer', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} fermer`, trigger_event: 'webhook.received', steps: ETAPE });
    await ouvrirEditeur(page, regle.id);
    await carteDeclencheur(page).click();
    const tiroir = tiroirDeclencheurs(page);
    await expect(tiroir).toBeVisible();
    await tiroir.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(tiroir).toBeHidden();
    await expect(carteDeclencheur(page)).toContainText('Appel reçu de l’extérieur');
    expect((await lireRegle(bureau, regle.id))?.trigger_event).toBe('webhook.received');
  });

  test('[EDT-056] Échap referme le tiroir (ouvert par erreur, on en sort au clavier) @defaut', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} échap`, trigger_event: 'webhook.received', steps: ETAPE });
    await ouvrirEditeur(page, regle.id);
    await carteDeclencheur(page).click();
    const tiroir = tiroirDeclencheurs(page);
    await expect(tiroir).toBeVisible();
    await tiroir.getByRole('searchbox').focus();
    await page.keyboard.press('Escape');
    await expect(tiroir).toBeHidden({ timeout: 5000 });
  });

"""
s=s[:i]+nouveau+s[j:]
s=s.replace("      expect(rep.status()).toBe(201);","      expect(rep.ok(), `création : ${rep.status()}`).toBe(true);")
io.open(p,'w',encoding='utf-8',newline='\n').write(s)
