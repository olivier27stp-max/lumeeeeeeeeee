/**
 * Catalogue des déclencheurs — une boucle sur les 28 (DEC-01 à DEC-28).
 *
 * Pour CHACUN, par l'interface : le choisir dans le tiroir, remplir chacun de
 * ses champs (les siens + les 2 filtres d'étiquettes), enregistrer, puis
 *  · la base (`automation_rules.trigger_event`, `conditions`) porte EXACTEMENT
 *    ce que l'écran montre — rien de plus, rien de moins ;
 *  · après rechargement, la carte « Quand » et le panneau réaffichent la même
 *    configuration, champ par champ.
 *
 * Les attentes sont écrites à la main par déclencheur (`_catalogue.ts` + la
 * table SAISIES ci-dessous) : un test qui passerait quoi qu'il s'affiche ne
 * prouverait rien.
 *
 * Bureau A : les 25 déclencheurs sans drapeau. Bureau B (drapeaux actifs) :
 * les 3 sous drapeau — « Paiement échoué », « Facture consultée par le
 * client », « Client inactif ».
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect, creerRegle, lireRegle, type Bureau } from '../_outils/banc';
import { DECLENCHEURS_ATTENDUS, FAMILLES, FILTRE_A, FILTRE_SANS, type DeclencheurAttendu } from './_catalogue';
import { donnees, ouvrirEditeur, carteDeclencheur, tiroirDeclencheurs, panneauDeclencheur, ouvrirTiroirDeclencheurs, type Donnees } from './_donnees';

test.afterEach(async ({ context }) => { await context.unrouteAll({ behavior: 'ignoreErrors' }); });

const PATCH_REGLE = (page: Page) => page.waitForResponse(
  (s) => s.request().method() === 'PATCH' && /\/api\/automations\/rules\/[0-9a-f-]{36}$/.test(s.url()), { timeout: 60_000 });

/** Ce qu'on saisit dans un champ, ce que la base doit porter, ce que l'écran doit redire. */
interface Saisie {
  /** Libellé FR du champ (début de l'étiquette). */
  libelle: string;
  cle: string;
  /** Geste : remplit le champ. */
  remplir: (champ: Locator, d: Donnees) => Promise<void>;
  /** Valeur attendue en base pour cette clé. */
  enBase: (d: Donnees) => unknown;
  /** Ce que le contrôle affiche (texte de l'option choisie, ou valeur du champ). */
  affiche: (d: Donnees) => string;
  /** Le bout de résumé sous la carte « Quand ». */
  resume: (d: Donnees) => string;
}

const texte = (libelle: string, cle: string, valeur: string): Saisie => ({
  libelle, cle,
  remplir: (c) => c.fill(valeur),
  enBase: () => valeur,
  affiche: () => valeur,
  resume: () => `${libelle} : ${valeur}`,
});
const nombre = (libelle: string, cle: string, valeur: number): Saisie => ({
  libelle, cle,
  remplir: (c) => c.fill(String(valeur)),
  enBase: () => valeur,
  affiche: () => String(valeur),
  resume: () => `${libelle} : ${valeur}`,
});
const choix = (libelle: string, cle: string, valeur: string, libelleOption: string): Saisie => ({
  libelle, cle,
  remplir: async (c) => { await c.selectOption({ label: libelleOption }); },
  enBase: () => valeur,
  affiche: () => libelleOption,
  resume: () => libelleOption,
});
const etape = (libelle: string, cle: string, nomEtape: string): Saisie => ({
  libelle, cle,
  remplir: async (c, d) => { await c.selectOption({ label: `${d.pipeline.name} · ${nomEtape}` }); },
  enBase: (d) => d.etapes.find((e) => e.name_fr === nomEtape)?.id,
  affiche: (d) => `${d.pipeline.name} · ${nomEtape}`,
  resume: (d) => `${d.pipeline.name} · ${nomEtape}`,
});

const FILTRES_ETIQUETTES: Saisie[] = [
  texte(FILTRE_A.fr, FILTRE_A.cle, 'VIP'),
  texte(FILTRE_SANS.fr, FILTRE_SANS.cle, 'Ne pas relancer'),
];

/** Les saisies des champs PROPRES de chaque déclencheur qui en a. */
const SAISIES: Record<string, Saisie[]> = {
  'quote.viewed': [
    choix('Quand déclencher', 'ouverture', 'chaque', 'Chaque ouverture'),
    nombre('Montant minimum ($)', 'montant__gte', 500),
    nombre('Montant maximum ($)', 'montant__lte', 2500.5),
    {
      libelle: 'Contient le service', cle: 'service_id',
      remplir: async (c) => { await c.selectOption({ label: 'QA Lavage de vitres' }); },
      enBase: (d) => d.services.find((s) => s.name === 'QA Lavage de vitres')?.id,
      affiche: () => 'QA Lavage de vitres',
      resume: () => 'QA Lavage de vitres',
    },
    etape('L’opportunité est à l’étape', 'stage_id', 'Soumission ouverte'),
    texte('Le client a l’étiquette', 'etiquette', 'VIP'),
  ],
  'invoice.viewed': [choix('Quand déclencher', 'ouverture', 'chaque', 'Chaque consultation')],
  'client.tagged': [texte('Quelle étiquette', 'tag', 'Été 🌞 2026')],
  'client.untagged': [texte('Quelle étiquette', 'tag', 'Été 🌞 2026')],
  'client.inactive': [
    nombre('Aucun job terminé depuis (mois)', 'mois', 12),
    nombre('Au plus, par heure', 'max_par_heure', 40),
  ],
  'date.reached': [
    {
      libelle: 'Quelle date surveiller', cle: 'champ_id',
      remplir: async (c) => { await c.selectOption({ label: 'Client · QA Date' }); },
      enBase: (d) => d.champs.qa_date.id,
      affiche: () => 'Client · QA Date',
      resume: () => 'Client · QA Date',
    },
    nombre('Combien de jours avant', 'jours_avant', 7),
  ],
  'deal.stage_entered': [etape('Quelle étape', 'stage_id', 'Contacté')],
  'deal.stage_idle': [etape('Quelle étape', 'stage_id', 'Contacté')],
};

/** Le contrôle d'un champ du panneau, par le début de son étiquette (l'astérisque ou « (facultatif) » suit). */
function champ(panneau: Locator, libelle: string): Locator {
  const motif = new RegExp(`^${libelle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( \\*| \\(facultatif\\))$`);
  return panneau.getByLabel(motif);
}

/** Ce que le contrôle MONTRE : le texte de l'option choisie d'un menu, la valeur d'un champ. */
async function valeurAffichee(c: Locator): Promise<string> {
  return c.evaluate((el) => (el instanceof HTMLSelectElement ? (el.selectedOptions[0]?.textContent ?? '') : (el as HTMLInputElement).value));
}

function boucle(liste: DeclencheurAttendu[], org: (b: Bureau) => string) {
  for (const decl of liste) {
    test(`[${decl.id}][EDT-058][EDT-068][EDT-074] « ${decl.fr} » : choisi, réglé, enregistré — la base et l’écran disent la même chose, avant et après rechargement`, async ({ page, bureau, marque }) => {
      test.setTimeout(240_000);
      const d = await donnees(bureau);
      const depart = decl.cle === 'lead.created' ? 'job.completed' : 'lead.created';
      const regle = await creerRegle(bureau, org(bureau), {
        name: `${marque} ${decl.fr}`, trigger_event: depart,
        steps: [{ id: 'e1', type: 'action', action: { type: 'create_notification', config: { title: 'Suivi QA' } }, suivant: null }],
      });
      await ouvrirEditeur(page, regle.id);

      // ── 1. Le choisir dans le tiroir : sous sa famille, avec son titre et son aide. ──
      await ouvrirTiroirDeclencheurs(page);
      const tiroir = tiroirDeclencheurs(page);
      const famille = FAMILLES.find((f) => f.cle === decl.famille);
      const section = tiroir.locator('section').filter({ has: page.getByRole('heading', { name: famille?.fr ?? '', exact: true }) });
      const item = section.getByRole('button', { name: `${decl.fr} ${decl.aide_fr}`, exact: true });
      await expect(item, `« ${decl.fr} » doit être offert sous « ${famille?.fr} », avec son aide`).toBeVisible();
      await expect(item).toBeEnabled();
      const reponse = PATCH_REGLE(page);
      await item.click();
      expect((await reponse).status(), 'le changement de déclencheur est accepté').toBe(200);
      await expect(tiroir).toBeHidden();

      // ── 2. La carte « Quand » porte son nom ; la base porte sa clé et ses réglages d'office. ──
      const carte = carteDeclencheur(page);
      await expect(carte).toContainText(decl.fr);
      let enBase = await lireRegle(bureau, regle.id);
      expect(enBase?.trigger_event).toBe(decl.cle);
      expect(enBase?.conditions ?? {}, 'réglages posés d’office au choix du déclencheur').toEqual(decl.defaut);

      const saisies = [...(SAISIES[decl.cle] ?? []), ...(decl.filtresEtiquettes ? FILTRES_ETIQUETTES : [])];

      if (decl.cle === 'webhook.received') {
        // Aucun réglage : le clic sur la carte rouvre le tiroir, pas un panneau vide.
        await carte.click();
        await expect(tiroirDeclencheurs(page)).toBeVisible();
        await expect(panneauDeclencheur(page)).toBeHidden();
        await tiroirDeclencheurs(page).getByRole('button', { name: 'Fermer' }).click();
        await page.reload();
        await expect(carteDeclencheur(page)).toContainText(decl.fr, { timeout: 90_000 });
        expect((await lireRegle(bureau, regle.id))?.conditions ?? {}).toEqual({});
        return;
      }

      // ── 3. Le panneau : son titre, son aide, chacun de ses champs — puis on les remplit. ──
      await carte.click();
      const panneau = panneauDeclencheur(page);
      await expect(panneau).toBeVisible();
      await expect(panneau.getByText(decl.fr, { exact: true })).toBeVisible();
      await expect(panneau.getByText(decl.aide_fr, { exact: true })).toBeVisible();

      // Le compte exact des champs offerts : ni champ en trop, ni champ manquant.
      const etiquettesAttendues = [
        ...decl.champs.map((c) => `${c.fr}${c.obligatoire ? ' *' : ' (facultatif)'}`),
        ...(decl.filtresEtiquettes ? [`${FILTRE_A.fr} (facultatif)`, `${FILTRE_SANS.fr} (facultatif)`] : []),
      ];
      if (decl.cle === 'custom_field.changed') etiquettesAttendues.unshift('Quel champ (facultatif)');
      // Les étiquettes des champs du déclencheur précèdent la section « Filtres » (dont les libellés sont masqués).
      const etiquettesVues = await panneau.locator('label:not(.sr-only)').allInnerTexts();
      expect(etiquettesVues.map((t) => t.replace(/\s+/g, ' ').trim())).toEqual(etiquettesAttendues);

      for (const c of decl.champs) {
        const controle = champ(panneau, c.fr);
        await expect(controle, `champ « ${c.fr} »`).toBeVisible();
        const defaut = decl.defaut[c.cle];
        if (c.type === 'choix') {
          // Les options exactes, dans l'ordre, après l'option vide.
          const options = await controle.locator('option').allInnerTexts();
          expect(options.slice(1)).toEqual((c.options ?? []).map((o) => o.fr));
          const opt = (c.options ?? []).find((o) => o.cle === defaut);
          if (opt) expect(await valeurAffichee(controle)).toBe(opt.fr);
        } else if (defaut !== undefined) {
          await expect(controle).toHaveValue(String(defaut));
        } else if (c.type === 'nombre' || c.type === 'etiquette') {
          await expect(controle).toHaveValue('');
        }
        if (c.aide_fr) await expect(panneau.getByText(c.aide_fr, { exact: true })).toBeVisible();
      }

      if (decl.cle === 'custom_field.changed') {
        // Hors catalogue : « Quel champ » puis « Quand il devient » (liste : une option du champ).
        await panneau.getByLabel(/^Quel champ/).selectOption({ label: 'QA Liste' });
        const devient = panneau.getByLabel(/^Quand il devient/);
        await expect(devient).toBeVisible();
        await devient.selectOption({ label: 'Hiver' });
      }
      for (const s of saisies) await s.remplir(champ(panneau, s.libelle), d);

      const enregistre = PATCH_REGLE(page);
      await panneau.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      expect((await enregistre).status(), 'les réglages sont acceptés').toBe(200);
      await expect(page.getByText('Réglages enregistrés')).toBeVisible();
      await expect(panneau).toBeHidden();

      // ── 4. La base : exactement ce qui a été saisi. ──
      const attendu: Record<string, unknown> = {};
      for (const s of saisies) attendu[s.cle] = s.enBase(d);
      if (decl.cle === 'custom_field.changed') {
        attendu.field_id = { eq: d.champs.qa_liste.id };
        attendu.new_value = { eq: d.champs.qa_liste.options.find((o) => o.label === 'Hiver')?.id };
      }
      enBase = await lireRegle(bureau, regle.id);
      expect(enBase?.trigger_event).toBe(decl.cle);
      expect(enBase?.conditions).toEqual(attendu);
      for (const v of Object.values(attendu)) expect(v, 'aucune valeur attendue indéfinie (donnée de test absente)').toBeDefined();

      // ── 5. Le résumé sous la carte redit les réglages, en clair. ──
      const resume = [
        ...(decl.cle === 'custom_field.changed' ? ['QA Liste → Hiver'] : []),
        ...saisies.map((s) => s.resume(d)),
      ].join(' · ');
      await expect(carte).toContainText(resume);

      // ── 6. Rechargement : la carte et le panneau réaffichent la même configuration. ──
      await page.reload();
      await expect(carteDeclencheur(page)).toContainText(decl.fr, { timeout: 90_000 });
      await expect(carteDeclencheur(page)).toContainText(resume, { timeout: 30_000 });
      await carteDeclencheur(page).click();
      const relu = panneauDeclencheur(page);
      await expect(relu).toBeVisible();
      await expect(relu.getByText(decl.fr, { exact: true })).toBeVisible();
      for (const s of saisies) {
        const controle = champ(relu, s.libelle);
        await expect.poll(() => valeurAffichee(controle), { message: `« ${s.libelle} » relu`, timeout: 30_000 }).toBe(s.affiche(d));
      }
      if (decl.cle === 'custom_field.changed') {
        await expect.poll(() => valeurAffichee(relu.getByLabel(/^Quel champ/)), { timeout: 30_000 }).toBe('QA Liste');
        await expect.poll(() => valeurAffichee(relu.getByLabel(/^Quand il devient/)), { timeout: 30_000 }).toBe('Hiver');
      }
      // Rien n'a bougé en base du seul fait d'avoir rechargé et rouvert.
      expect((await lireRegle(bureau, regle.id))?.conditions).toEqual(attendu);
    });
  }
}

test.describe('catalogue — bureau A (aucun drapeau) : les 25 déclencheurs offerts', () => {
  boucle(DECLENCHEURS_ATTENDUS.filter((x) => !x.drapeau), (b) => b.orgA);
});

test.describe('catalogue — bureau B (drapeaux actifs) : les 3 déclencheurs sous drapeau', () => {
  test.use({ compte: 'proprioB' });
  boucle(DECLENCHEURS_ATTENDUS.filter((x) => x.drapeau), (b) => b.orgB);
});
