/**
 * Cohérence des NOMS des déclencheurs, en français puis en anglais.
 *
 * Le même déclencheur doit porter le même libellé :
 *  · dans le tiroir de choix, sur la carte « Quand » du canevas, en titre du
 *    panneau de réglage (prouvé déclencheur par déclencheur en français par
 *    `02-catalogue-declencheurs.spec.ts`) ;
 *  · dans la liste des automatisations (la ligne sous le nom) ;
 *  · et, interface en anglais, partout — sans libellé français qui traîne ni
 *    clé technique du type `quote.sent`.
 */
import type { Page } from '@playwright/test';
import { test, expect, creerRegle, ouvrirListe, type Bureau } from '../_outils/banc';
import { DECLENCHEURS_ATTENDUS, FAMILLES, FILTRE_A, FILTRE_SANS, MOTIF_CLE_TECHNIQUE, SANS_DRAPEAU, SOUS_DRAPEAU, type DeclencheurAttendu } from './_catalogue';
import {
  donnees, ouvrirEditeur, carteDeclencheur, tiroirDeclencheurs, panneauDeclencheur, ouvrirTiroirDeclencheurs, ETAPE_NOTIF, ecritureRegle,
  champsDuBureau, nomsDesDonneesDuBureau, sansLesDonnees,
} from './_donnees';

test.afterEach(async ({ context }) => { await context.unrouteAll({ behavior: 'ignoreErrors' }); });

/** Mots qui ne doivent pas paraître dans une interface anglaise (accents compris). */
const FRANCAIS = /[éèêàùçôîû]|\b(Quand|Seulement|facultatif|Enregistrer|Annuler|Changer|Filtres|Devis|Facture|étiquette|Aucun|Chaque|Première|Montant|Quelle|Combien|mois|jours|heures|Déclencheurs?|Rechercher|prospect|Rendez-vous|Opportunité)\b/;

async function creerUneParDeclencheur(bureau: Parameters<typeof creerRegle>[0], org: string, marque: string, liste: DeclencheurAttendu[]) {
  for (const d of liste) {
    await creerRegle(bureau, org, { name: `${marque} libellé ${d.id}`, trigger_event: d.cle, conditions: d.defaut, steps: ETAPE_NOTIF });
  }
}

/** Dans la liste : cherche l'automatisation de ce déclencheur et rend le texte de sa ligne (nom + ligne du dessous). */
async function ligneDeLaListe(page: Page, marque: string, d: DeclencheurAttendu, libelleRecherche: string): Promise<string> {
  const nom = `${marque} libellé ${d.id}`;
  await page.getByLabel(libelleRecherche, { exact: true }).fill(nom);
  const bouton = page.getByRole('button', { name: new RegExp(`^${nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });
  await expect(bouton, `ligne de « ${d.id} » dans la liste`).toHaveCount(1);
  return (await bouton.innerText()).replace(/\s+/g, ' ').trim();
}

test.describe('libellés — français', () => {
  test('[LST-070][DEC-01][DEC-28] liste des automatisations : sous le nom, chaque déclencheur porte le libellé du tiroir (les 28, y compris ceux sous drapeau) — jamais une clé technique', async ({ page, bureau, marque }) => {
    test.setTimeout(300_000);
    await donnees(bureau);
    await creerUneParDeclencheur(bureau, bureau.orgA, marque, DECLENCHEURS_ATTENDUS);
    await ouvrirListe(page);
    for (const d of DECLENCHEURS_ATTENDUS) {
      const texte = await ligneDeLaListe(page, marque, d, 'Rechercher');
      expect.soft(texte, `ligne de ${d.id} (${d.cle})`).toBe(`${marque} libellé ${d.id} ${d.fr} · 1 étape`);
      expect.soft(texte).not.toMatch(MOTIF_CLE_TECHNIQUE);
    }
  });

  test('[LST-070][DEC-15] « Anniversaire client » : la ligne sous le nom ne présente pas l’anniversaire comme « Nouveau prospect · 12 mois après » @defaut', async ({ page, bureau }) => {
    await donnees(bureau);
    const { data: preset } = await bureau.admin.from('automation_rules').select('id, name, trigger_event, delay_seconds, steps')
      .eq('org_id', bureau.orgA).eq('name', 'Client Anniversary').eq('is_preset', true).is('deleted_at', null).maybeSingle();
    expect(preset, 'le préréglage « Client Anniversary » existe dans le bureau').toBeTruthy();
    expect(preset?.trigger_event).toBe('lead.created');
    await ouvrirListe(page);
    await page.getByLabel('Rechercher', { exact: true }).fill('Anniversaire client');
    const bouton = page.getByRole('button', { name: /^Anniversaire client/ });
    await expect(bouton).toHaveCount(1);
    const texte = (await bouton.innerText()).replace(/\s+/g, ' ').trim();
    // Un « anniversaire client » calé sur l'entrée du PROSPECT (12 mois après sa création) n'est pas l'anniversaire
    // d'un client : soit le déclencheur est le bon (premier job, conversion), soit le libellé dit ce qui se passe vraiment.
    expect(texte, `ligne affichée : « ${texte} »`).not.toContain('Nouveau prospect · 12 mois après');
  });
});

test.describe('libellés — anglais', () => {
  test.use({ langue: 'en' });

  test('[EDT-058][EDT-057][EDT-056] tiroir en anglais : familles, titres et aides des 25 déclencheurs, recherche, fermeture — aucun mot français, aucune clé technique', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} drawer`, trigger_event: 'webhook.received', steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    await expect(carteDeclencheur(page)).toContainText('When');
    await expect(carteDeclencheur(page)).toContainText('Incoming webhook');
    await carteDeclencheur(page).click();
    const tiroir = tiroirDeclencheurs(page);
    await expect(tiroir).toBeVisible();
    await expect(tiroir.getByRole('heading', { name: 'Triggers', exact: true })).toBeVisible();
    await expect(tiroir.getByText('What starts the automation')).toBeVisible();
    await expect(tiroir.getByRole('searchbox', { name: 'Search Triggers' })).toHaveAttribute('placeholder', 'Search…');
    await expect(tiroir.getByRole('button', { name: 'Close', exact: true })).toBeVisible();

    const vu = await tiroir.locator('section').evaluateAll((sections) => sections.map((s) => ({
      famille: s.querySelector('h3')?.textContent?.trim() ?? '',
      items: Array.from(s.querySelectorAll('li button')).map((b) => ({
        titre: b.querySelector('span > span')?.textContent?.trim() ?? '',
        aide: b.querySelectorAll('span > span')[1]?.textContent?.trim() ?? '',
      })),
    })));
    const attendu = FAMILLES
      .map((f) => ({ famille: f.en, items: SANS_DRAPEAU.filter((d) => d.famille === f.cle).map((d) => ({ titre: d.en, aide: d.aide_en })) }))
      .filter((g) => g.items.length > 0);
    expect(vu).toEqual(attendu);
    const texte = await tiroir.innerText();
    expect(texte).not.toMatch(MOTIF_CLE_TECHNIQUE);
    expect(texte.match(FRANCAIS)?.[0] ?? null, 'mot français dans le tiroir anglais').toBeNull();

    await tiroir.getByRole('searchbox', { name: 'Search Triggers' }).fill('zzzz');
    await expect(tiroir.getByText('Nothing matches that search.')).toBeVisible();
  });

  /** L'objet (`custom_fields.object_type`) derrière le nom anglais de la fiche d'un déclencheur. */
  const TYPE_OBJET: Record<string, string> = { Client: 'client', Quote: 'quote', Invoice: 'invoice', Job: 'job', Pipeline: 'deal' };

  /** Ce que le bureau porte au moment du test : les noms de ses données, et les objets qui ont des champs personnalisés. */
  async function contexteDuBureau(bureau: Bureau, org: string): Promise<{ noms: string[]; objetsAvecChamps: Set<string> }> {
    return {
      noms: await nomsDesDonneesDuBureau(bureau, org),
      objetsAvecChamps: new Set((await champsDuBureau(bureau, org)).map((c) => c.object_type)),
    };
  }

  /** Pour chaque déclencheur, en anglais : la carte, le titre du panneau, les étiquettes de ses champs. */
  async function parcourirEnAnglais(page: Page, liste: DeclencheurAttendu[], ctx: { noms: string[]; objetsAvecChamps: Set<string> }): Promise<void> {
    for (const d of liste) {
      await test.step(`${d.id} ${d.en}`, async () => {
        await ouvrirTiroirDeclencheurs(page);
        const ecriture = ecritureRegle(page);
        await tiroirDeclencheurs(page).getByRole('button', { name: `${d.en} ${d.aide_en}`, exact: true }).click();
        expect((await ecriture).status()).toBe(200);
        const carte = carteDeclencheur(page);
        await expect(carte).toContainText(d.en);
        const texteCarte = (await carte.innerText()).replace(/\s+/g, ' ');
        expect.soft(texteCarte, `carte de ${d.id}`).not.toMatch(MOTIF_CLE_TECHNIQUE);
        expect.soft(texteCarte.match(FRANCAIS)?.[0] ?? null, `mot français sur la carte de ${d.id} : « ${texteCarte} »`).toBeNull();

        if (d.cle === 'webhook.received') return;   // aucun réglage : pas de panneau
        await carte.click();
        const panneau = panneauDeclencheur(page);
        await expect(panneau).toBeVisible();
        await expect(panneau.getByText(d.en, { exact: true })).toBeVisible();
        await expect(panneau.getByText(d.aide_en, { exact: true })).toBeVisible();
        const etiquettes = (await panneau.locator('label:not(.sr-only)').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
        const attendues = [
          ...(d.cle === 'custom_field.changed' ? ['Which field (optional)'] : []),
          ...d.champs.map((c) => `${c.en}${c.obligatoire ? ' *' : ' (optional)'}`),
          ...(d.filtresEtiquettes ? [`${FILTRE_A.en} (optional)`, `${FILTRE_SANS.en} (optional)`] : []),
        ];
        // Bureau aux drapeaux actifs : la case « Stop if… » s'ajoute à la liste des étiquettes.
        expect.soft(etiquettes.filter((e) => !e.startsWith('Stop if')), `champs de ${d.id}`).toEqual(attendues);
        for (const c of d.champs.filter((x) => x.type === 'choix')) {
          const options = await panneau.getByLabel(new RegExp(`^${c.en}`)).locator('option').allInnerTexts();
          expect.soft(options.slice(1), `options de « ${c.en} »`).toEqual((c.options ?? []).map((o) => o.en));
        }
        if (d.objet_en) {
          // La section « Filters » n'est offerte que si le bureau a des champs personnalisés sur la fiche de ce
          // déclencheur (PanneauDeclencheur) : avec des champs, son texte est là ; sans champ, pas de section du tout.
          const aide = panneau.getByText(`Only if the record’s fields (${d.objet_en}) meet these conditions when the event happens.`);
          if (ctx.objetsAvecChamps.has(TYPE_OBJET[d.objet_en])) await expect.soft(aide, `section « Filters » de ${d.id}`).toBeVisible();
          else await expect.soft(panneau.getByRole('region', { name: 'Filters' }), `${d.id} : aucun champ sur la fiche (${d.objet_en}) dans ce bureau, donc pas de section « Filters »`).toHaveCount(0);
        }
        await expect.soft(panneau.getByRole('button', { name: 'Change trigger…', exact: true })).toBeVisible();
        await expect.soft(panneau.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
        await expect.soft(panneau.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
        const textePanneau = await panneau.innerText();
        expect.soft(textePanneau, `panneau de ${d.id}`).not.toMatch(MOTIF_CLE_TECHNIQUE);
        // Les noms des champs personnalisés, des options, des services, des étapes et des étiquettes viennent des DONNÉES
        // du bureau (en français, et un autre lot peut y avoir ajouté les siennes) : on les retire, et on juge le texte fixe.
        const fixe = sansLesDonnees(textePanneau, ctx.noms);
        const fautif = fixe.split('\n').find((l) => FRANCAIS.test(l)) ?? null;
        expect.soft(fautif, `texte français dans le panneau de ${d.id}`).toBeNull();
      });
    }
  }

  test('[EDT-032][EDT-064][EDT-065][EDT-068][EDT-073][EDT-074] en anglais, les 25 déclencheurs : carte « When », titre, aide et champs du panneau — aucun mot français, aucune clé technique', async ({ page, bureau, marque }) => {
    test.setTimeout(600_000);
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} english`, trigger_event: 'webhook.received', steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    // « Appel reçu de l'extérieur » est le point de départ : on le revisite en dernier.
    const ordre = [...SANS_DRAPEAU.filter((d) => d.cle !== 'webhook.received'), ...SANS_DRAPEAU.filter((d) => d.cle === 'webhook.received')];
    const ctx = await contexteDuBureau(bureau, bureau.orgA);
    // Le bureau A a des champs sur chacune des cinq fiches : la section « Filters » est donc jugée pour chacune.
    expect([...ctx.objetsAvecChamps]).toEqual(expect.arrayContaining(['client', 'deal', 'job', 'quote', 'invoice']));
    await parcourirEnAnglais(page, ordre, ctx);
  });

  test('[LST-070] liste en anglais : sous le nom, le libellé anglais du déclencheur pour les 28 — ni français, ni clé technique', async ({ page, bureau, marque }) => {
    test.setTimeout(300_000);
    await donnees(bureau);
    await creerUneParDeclencheur(bureau, bureau.orgA, marque, DECLENCHEURS_ATTENDUS);
    await page.goto('/automations');
    await expect(page.getByRole('heading', { name: 'Workflows list' })).toBeVisible({ timeout: 90_000 });
    for (const d of DECLENCHEURS_ATTENDUS) {
      const texte = await ligneDeLaListe(page, marque, d, 'Search');
      expect.soft(texte, `ligne de ${d.id} (${d.cle})`).toBe(`${marque} libellé ${d.id} ${d.en} · 1 step`);
    }
  });

  test.describe('bureau aux drapeaux actifs', () => {
    test.use({ compte: 'proprioB' });

    test('[EDT-058][EDT-068][EDT-071] en anglais, les 3 déclencheurs sous drapeau et la case « Stop if… » : tiroir, carte, panneau — aucun mot français', async ({ page, bureau, marque }) => {
      test.setTimeout(300_000);
      await donnees(bureau);
      const regle = await creerRegle(bureau, bureau.orgB, { name: `${marque} english flags`, trigger_event: 'webhook.received', steps: ETAPE_NOTIF });
      await ouvrirEditeur(page, regle.id);
      await parcourirEnAnglais(page, SOUS_DRAPEAU, await contexteDuBureau(bureau, bureau.orgB));

      // La case de sortie, en anglais, sur les 5 déclencheurs concernés.
      const CASES: Array<[string, string]> = [
        ['quote.sent', 'Stop if the quote is accepted, declined or cancelled'],
        ['invoice.sent', 'Stop if the invoice is paid or cancelled'],
        ['invoice.overdue', 'Stop if the invoice is paid or cancelled'],
        ['appointment.created', 'Stop if the appointment is cancelled'],
        ['deal.stage_entered', 'Stop if the deal changes stage'],
      ];
      for (const [cle, libelle] of CASES) {
        const d = DECLENCHEURS_ATTENDUS.find((x) => x.cle === cle) as DeclencheurAttendu;
        await ouvrirTiroirDeclencheurs(page);
        const ecriture = ecritureRegle(page);
        await tiroirDeclencheurs(page).getByRole('button', { name: `${d.en} ${d.aide_en}`, exact: true }).click();
        expect((await ecriture).status()).toBe(200);
        await expect(carteDeclencheur(page)).toContainText(d.en);
        await carteDeclencheur(page).click();
        await expect.soft(panneauDeclencheur(page).getByRole('checkbox', { name: new RegExp(`^${libelle}`) }), `case de ${cle}`).toBeVisible();
        await expect.soft(panneauDeclencheur(page).getByText('Checked before every step that follows a delay. The reason appears in the history.')).toBeVisible();
      }
    });
  });
});
