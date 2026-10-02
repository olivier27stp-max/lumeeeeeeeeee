/**
 * Chaque modèle de la bibliothèque, un par un — MOD-024 (carte → aperçu) et
 * MOD-029 (« Utiliser ce modèle »).
 *
 * Pour CHACUN des modèles du catalogue, ce fichier prouve, à l'écran puis en base :
 *  · l'aperçu annonce un nom, une description, un déclencheur et des étapes ;
 *  · la copie arrive en BROUILLON, à soi (ni préréglage ni clé de préréglage),
 *    avec ce nom, ce déclencheur, ces conditions et ces étapes — mot pour mot ;
 *  · tout ce que l'aperçu montrait se retrouve dans la copie ;
 *  · aucun message de la copie ne cite une variable que le serveur ne sait pas remplir ;
 *  · l'éditeur s'ouvre dessus sans erreur (le moniteur du banc veille), avec le
 *    même déclencheur et autant de cartes que d'étapes enregistrées ;
 *  · en interface française, l'aperçu ne contient pas d'anglais (et l'inverse
 *    sur un échantillon, en anglais).
 *
 * Les défauts qui touchent PLUSIEURS modèles (clés techniques dans les
 * conditions, nombre d'étapes annoncé) ont chacun leur test, en fin de fichier :
 * ils ne noient pas le résultat modèle par modèle.
 */
import { MODELES_AUTOMATISATION } from '../../../server/lib/automationTemplates';
import type { ModeleAutomatisation } from '../../../src/lib/automationTemplates';
import { variablesInconnues } from '../../../src/lib/emailBodyText';
import type { Locator, Page } from '@playwright/test';
import {
  test, expect, ouvrirBibliotheque, carteModele, attendreEditeur, cartesEtape, cartesSiArbre, etapesDe, textesDeConfig,
  anglaisDans, francaisDans, clesBrutes, CAPTURES, type EtapeStockee, type LigneRegle,
} from './aides';

// Poste et staging partagés par plusieurs passes : les chargements sont lents par moments.
test.describe.configure({ timeout: 240_000 });

const MODELES = [...MODELES_AUTOMATISATION];

/** Tout blanc retiré, balises et entités HTML aplaties : pour comparer un texte d'écran à un texte stocké. */
const aplatir = (s: string) => s
  .replace(/<[^>]+>/g, ' ')
  // L'aperçu pose « • » devant chaque puce d'un courriel : ce n'est pas du texte du modèle.
  .replace(/•/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/\s+/g, '');

/** Les types d'étape attendus dans la copie, dans l'ordre : ceux du modèle. */
function typesAttendus(m: ModeleAutomatisation): string[] {
  if (m.steps) return m.steps.map((e) => (e.type === 'action' ? `action:${e.action.type}` : e.type));
  return [...(m.delai_secondes !== 0 ? ['attendre'] : []), ...m.actions.map((a) => `action:${a.type}`)];
}

/** Les configs d'action attendues dans la copie, dans l'ordre. */
function configsAttendues(m: ModeleAutomatisation): Array<Record<string, unknown>> {
  if (m.steps) return m.steps.flatMap((e) => (e.type === 'action' ? [e.action.config] : []));
  return m.actions.map((a) => a.config);
}

/** Vérifie la copie en base contre le modèle. */
function verifierCopie(copie: LigneRegle, m: ModeleAutomatisation, orgA: string, nom: string, description: string): void {
  expect(copie).toMatchObject({
    org_id: orgA, name: nom, description, trigger_event: m.declencheur,
    is_active: false, is_preset: false, preset_key: null, deleted_at: null, delay_seconds: 0, folder_id: null,
  });
  expect(copie.conditions ?? {}).toEqual(m.conditions);
  const etapes = etapesDe(copie);
  expect(etapes.map((e) => (e.type === 'action' ? `action:${e.action?.type}` : e.type))).toEqual(typesAttendus(m));
  expect(etapes.flatMap((e) => (e.type === 'action' ? [e.action?.config ?? {}] : []))).toEqual(configsAttendues(m));
  // Un parcours cohérent : identifiants uniques, chaque renvoi mène à une étape qui existe.
  const ids = etapes.map((e) => e.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const e of etapes) {
    for (const cible of [e.suivant, e.alors, e.sinon]) {
      if (cible) expect(ids, `l’étape ${e.id} renvoie vers « ${cible} », qui n’existe pas`).toContain(cible);
    }
  }
  // Un modèle « à délai » : l'attente en tête porte ce délai (ou « X avant le rendez-vous » s'il est négatif).
  if (!m.steps && m.delai_secondes !== 0) {
    const attente = etapes[0];
    if (m.delai_secondes > 0) expect(attente.delai_secondes).toBe(m.delai_secondes);
    else expect({ mode: attente.mode, secondes_avant: attente.secondes_avant }).toEqual({ mode: 'avant_date', secondes_avant: -m.delai_secondes });
  }
}

/** Les variables citées par la copie que le serveur ne sait pas remplir. */
function variablesInconnuesDe(etapes: EtapeStockee[]): string[] {
  const inconnues = new Set<string>();
  for (const e of etapes) {
    if (e.type !== 'action') continue;
    for (const texte of textesDeConfig(e.action?.config)) for (const v of variablesInconnues(texte)) inconnues.add(`${e.action?.type} : [${v}]`);
  }
  return [...inconnues];
}

/**
 * La ligne que l'aperçu ET la carte de l'éditeur posent sous une étape `log_activity`
 * (« Note dans l'historique ») depuis #870 : un mot de l'interface, pas un texte du modèle.
 */
const ETAPE_TECHNIQUE = { fr: 'Étape technique, automatique', en: 'Technical step, automatic' };

/**
 * Les modèles dont le canevas de l'éditeur ne montre PAS une carte par étape : leurs branches
 * « Si » se rejoignent, et le canevas redessine la suite une fois par chemin (défaut ouvert).
 * Leur test porte ` @defaut` : il reste rouge sur cette seule attente.
 */
const CANEVAS_DEDOUBLE: ReadonlySet<string> = new Set(['pack_relance_devis']);

const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * La carte « Quand » de l'éditeur : le déclencheur annoncé par l'aperçu, puis — depuis que la carte
 * résume les réglages du déclencheur sous son nom — uniquement des réglages que l'aperçu annonçait
 * lui aussi dans sa ligne « Conditions ».
 */
async function verifierCarteQuand(page: Page, mot: 'Quand' | 'When', declencheur: string, conditionsApercu: string[]): Promise<void> {
  const carte = page.getByRole('button', { name: new RegExp(`^${mot} ${echapper(declencheur)}( |$)`) });
  await expect(carte).toHaveCount(1);
  const lignes = await carte.locator('span[title]').allTextContents();
  expect(lignes[0], 'le déclencheur de la carte « Quand »').toBe(declencheur);
  expect(lignes.length, 'la carte « Quand » porte le déclencheur et au plus une ligne de réglages').toBeLessThanOrEqual(2);
  for (const reglage of (lignes[1] ?? '').split(' · ').filter(Boolean)) {
    expect(conditionsApercu, `la carte « Quand » annonce « ${reglage} », que l’aperçu ne disait pas`).toContain(reglage);
  }
}

/** Les conditions annoncées par l'aperçu (« Conditions : A · B ») ; vide pour « Aucune condition. ». */
async function conditionsDeLApercu(fenetre: Locator, fr: boolean): Promise<string[]> {
  const ligne = (await fenetre.getByText(fr ? 'Déclencheur' : 'Trigger', { exact: true }).locator('xpath=following-sibling::p[2]').innerText()).trim();
  if (ligne === (fr ? 'Aucune condition.' : 'No conditions.')) return [];
  expect(ligne, 'la ligne des conditions de l’aperçu').toMatch(fr ? /^Conditions : / : /^Conditions: /);
  return ligne.replace(fr ? /^Conditions : / : /^Conditions: /, '').split(' · ');
}

test.describe('chaque modèle — français', () => {
  for (const m of MODELES) {
    test(`[MOD-024][MOD-029] « ${m.nom.fr} » (${m.id}) : l’aperçu dit ce que la copie contient ; elle arrive en brouillon et s’ouvre dans l’éditeur${CANEVAS_DEDOUBLE.has(m.id) ? ' @defaut' : ''}`, async ({ page, bureau, copies }) => {
      const fenetre = await ouvrirBibliotheque(page);
      const carte = carteModele(fenetre, m.nom.fr);
      await expect(carte).toHaveCount(1);
      await expect(carte).toContainText(`${m.nb_etapes} ${m.nb_etapes > 1 ? 'étapes' : 'étape'}`);
      await carte.click();

      // ── L'aperçu ──
      await expect(fenetre.getByRole('heading', { name: m.nom.fr, exact: true })).toBeVisible();
      await expect(fenetre.getByText(m.description.fr, { exact: true })).toBeVisible();
      const declencheurAffiche = (await fenetre.getByText('Déclencheur', { exact: true }).locator('xpath=following-sibling::p[1]').innerText()).trim();
      expect(declencheurAffiche, 'le déclencheur est affiché par sa clé technique').not.toMatch(/^[a-z_]+\.[a-z_]+$/);
      const conditionsApercu = await conditionsDeLApercu(fenetre, true);
      expect(conditionsApercu.length === 0, 'l’aperçu annonce des conditions si et seulement si le modèle en a').toBe(Object.keys(m.conditions).length === 0);
      const lignes = fenetre.getByRole('listitem');
      await expect(lignes).toHaveCount(m.nb_etapes);
      const paragraphes = (await lignes.locator('p').allInnerTexts()).filter((t) => t.trim());
      // Les étapes que l'aperçu intitule « Note dans l'historique » (relevé AVANT de quitter la fenêtre).
      const notesApercu = await lignes.filter({ hasText: 'Note dans l’historique' }).count();
      await expect(fenetre).not.toContainText('<div');
      await expect(fenetre).not.toContainText('undefined');

      // ── Utiliser ce modèle ──
      await fenetre.getByRole('button', { name: 'Utiliser ce modèle', exact: true }).click();
      await expect(page.getByText('Automatisation créée en brouillon')).toBeVisible();
      await attendreEditeur(page);

      // ── En base ──
      const creees = await copies.nouvelles();
      expect(creees, 'une seule règle créée').toHaveLength(1);
      const copie = creees[0];
      expect(page.url().endsWith(`/automations/${copie.id}`)).toBe(true);
      verifierCopie(copie, m, bureau.orgA, m.nom.fr, m.description.fr);
      const etapes = etapesDe(copie);
      expect(variablesInconnuesDe(etapes), 'variables que le serveur ne sait pas remplir').toEqual([]);

      // Tout ce que l'aperçu montrait est dans la copie. Une étape « Note dans l'historique » (`log_activity`)
      // n'a pas de texte : l'aperçu y écrit « Étape technique, automatique » — une fois par étape de ce type, pas plus.
      const notes = etapes.filter((e) => e.type === 'action' && e.action?.type === 'log_activity').length;
      expect(paragraphes.filter((p) => p.trim() === ETAPE_TECHNIQUE.fr), '« Étape technique, automatique » : une ligne par étape technique de la copie').toHaveLength(notes);
      expect(notesApercu, 'étapes de l’aperçu intitulées « Note dans l’historique »').toBe(notes);
      const corpus = etapes.flatMap((e) => textesDeConfig(e.action?.config)).map(aplatir);
      for (const p of paragraphes.filter((x) => x.trim() !== ETAPE_TECHNIQUE.fr)) {
        const cherche = aplatir(p);
        expect(corpus.some((c) => c.includes(cherche) || cherche.includes(c)), `l’aperçu montrait « ${p.slice(0, 80)} », absent de la copie`).toBe(true);
      }

      // ── L'éditeur ──
      await expect(page.getByRole('button', { name: m.nom.fr, exact: true })).toBeVisible();
      await verifierCarteQuand(page, 'Quand', declencheurAffiche, conditionsApercu);
      const nbEtapes = etapes.filter((e) => e.type !== 'fin').length;
      await expect(cartesEtape(page), `${nbEtapes} étapes enregistrées ; un canevas qui redessine chaque suite de « Si » en montrerait ${cartesSiArbre(etapes)}`).toHaveCount(nbEtapes);
      await expect(page.getByRole('switch', { name: 'Publier l’automatisation' })).toHaveAttribute('aria-checked', 'false');
      await expect(page.getByText('Brouillon', { exact: true })).toBeVisible();
      // Le résumé d'une carte ne montre jamais de balisage.
      await expect(page.getByRole('main')).not.toContainText('<div');
      await expect(page.getByRole('main')).not.toContainText('style=');
    });
  }
});

test.describe('chaque modèle — échantillon en anglais', () => {
  test.use({ langue: 'en' });
  const ECHANTILLON = ['welcome_new_lead', 'pack_relance_facture', 'job_reminder_1d', 'payment_confirmation', 'quote_opened_notify', 'google_review', 'pack_rendez_vous'];

  for (const id of ECHANTILLON) {
    const m = MODELES.find((x) => x.id === id)!;
    test(`[MOD-024][MOD-029] (anglais) « ${m.nom.en} » (${m.id}) : aperçu sans français, copie en brouillon, éditeur ouvert`, async ({ page, bureau, copies }) => {
      await page.goto('/automations');
      await expect(page.getByRole('heading', { name: 'Workflows list' })).toBeVisible({ timeout: 90_000 });
      await page.getByRole('button', { name: 'Create workflow' }).click();
      await page.getByRole('menuitem', { name: /Start from a template/ }).click();
      const fenetre = page.getByRole('dialog', { name: 'Template library' });
      await expect(fenetre.getByText(/Showing \d+ templates/)).toBeVisible({ timeout: 30_000 });
      const carte = carteModele(fenetre, m.nom.en);
      await expect(carte).toContainText(`${m.nb_etapes} ${m.nb_etapes > 1 ? 'steps' : 'step'}`);
      await carte.click();
      await expect(fenetre.getByRole('heading', { name: m.nom.en, exact: true })).toBeVisible();
      await expect(fenetre.getByText(m.description.en, { exact: true })).toBeVisible();
      await expect(fenetre.getByRole('listitem')).toHaveCount(m.nb_etapes);

      await fenetre.getByRole('button', { name: 'Use this template', exact: true }).click();
      await expect(page.getByText('Automation created as a draft')).toBeVisible();
      await attendreEditeur(page);
      const creees = await copies.nouvelles();
      expect(creees).toHaveLength(1);
      // La langue des MESSAGES du bureau est le français : le nom et la description stockés le sont aussi.
      verifierCopie(creees[0], m, bureau.orgA, m.nom.fr, m.description.fr);
      await expect(cartesEtape(page)).toHaveCount(etapesDe(creees[0]).filter((e) => e.type !== 'fin').length);
      await expect(page.getByText('Draft', { exact: true })).toBeVisible();
    });
  }

  test('[MOD-024] (anglais) aucun aperçu ne montre de texte français (notifications et tâches d’équipe comprises)', async ({ page }) => {
    test.setTimeout(300_000);
    await page.goto('/automations');
    await expect(page.getByRole('heading', { name: 'Workflows list' })).toBeVisible({ timeout: 90_000 });
    await page.getByRole('button', { name: 'Create workflow' }).click();
    await page.getByRole('menuitem', { name: /Start from a template/ }).click();
    const fenetre = page.getByRole('dialog', { name: 'Template library' });
    await expect(fenetre.getByText(/Showing \d+ templates/)).toBeVisible({ timeout: 30_000 });
    const fautifs: string[] = [];
    for (const m of MODELES) {
      await carteModele(fenetre, m.nom.en).click();
      await expect(fenetre.getByRole('heading', { name: m.nom.en, exact: true })).toBeVisible();
      const mots = francaisDans(await fenetre.innerText());
      if (mots.length) {
        fautifs.push(`${m.nom.en} → ${mots.slice(0, 8).join(', ')}`);
        if (fautifs.length === 1) await page.screenshot({ path: `${CAPTURES}/mod-024-anglais-texte-francais.png`, fullPage: true });
      }
      await fenetre.getByRole('button', { name: 'Back', exact: true }).click();
    }
    expect(fautifs, `aperçus anglais qui montrent du français :\n${fautifs.join('\n')}`).toEqual([]);
  });

  test('[MOD-029] (anglais) la copie porte le nom que l’aperçu annonçait @defaut', async ({ page, copies }) => {
    const m = MODELES.find((x) => x.id === 'agreement_signed')!;
    await page.goto('/automations');
    await expect(page.getByRole('heading', { name: 'Workflows list' })).toBeVisible({ timeout: 90_000 });
    await page.getByRole('button', { name: 'Create workflow' }).click();
    await page.getByRole('menuitem', { name: /Start from a template/ }).click();
    const fenetre = page.getByRole('dialog', { name: 'Template library' });
    await carteModele(fenetre, m.nom.en).click();
    await expect(fenetre.getByRole('heading', { name: m.nom.en, exact: true })).toBeVisible();
    await fenetre.getByRole('button', { name: 'Use this template', exact: true }).click();
    await attendreEditeur(page);
    await page.screenshot({ path: `${CAPTURES}/mod-029-anglais-nom-francais.png` });
    expect(await copies.nouvelles()).toHaveLength(1);
    // L'aperçu annonçait « Contract signed » : l'éditeur ouvre « Contrat signé ».
    await expect(page.getByRole('button', { name: m.nom.en, exact: true })).toBeVisible();
  });

  test('[MOD-024] (anglais) les textes montrés dans l’aperçu sont ceux que les clients recevront @defaut', async ({ page, bureau }) => {
    // Le bureau écrit à ses clients en FRANÇAIS (company_settings.default_language).
    const { data } = await bureau.admin.from('company_settings').select('default_language').eq('org_id', bureau.orgA).single();
    expect(data?.default_language).toBe('fr');
    const m = MODELES.find((x) => x.id === 'thank_you_after_job')!;
    const texto = String(m.actions.find((a) => a.type === 'send_sms')?.config.body ?? '');
    await page.goto('/automations');
    await expect(page.getByRole('heading', { name: 'Workflows list' })).toBeVisible({ timeout: 90_000 });
    await page.getByRole('button', { name: 'Create workflow' }).click();
    await page.getByRole('menuitem', { name: /Start from a template/ }).click();
    const fenetre = page.getByRole('dialog', { name: 'Template library' });
    await carteModele(fenetre, m.nom.en).click();
    await expect(fenetre.getByRole('heading', { name: m.nom.en, exact: true })).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/mod-024-anglais-texte-pas-celui-envoye.png` });
    // Le texto qui partira est le français ; l'aperçu doit le montrer (ou dire qu'il montre une traduction).
    const apercu = aplatir(await fenetre.innerText());
    expect(apercu.includes(aplatir(texto)) || /translation|French|will be sent in/i.test(await fenetre.innerText())).toBe(true);
  });
});

test.describe('chaque modèle — défauts transverses', () => {
  test('[MOD-024] en interface française, aucun aperçu ne montre d’anglais', async ({ page }) => {
    test.setTimeout(300_000);
    const fenetre = await ouvrirBibliotheque(page);
    const fautifs: string[] = [];
    for (const m of MODELES) {
      await carteModele(fenetre, m.nom.fr).click();
      await expect(fenetre.getByRole('heading', { name: m.nom.fr, exact: true })).toBeVisible();
      const mots = anglaisDans(await fenetre.innerText());
      if (mots.length) fautifs.push(`${m.nom.fr} → ${mots.join(', ')}`);
      await fenetre.getByRole('button', { name: 'Retour', exact: true }).click();
    }
    expect(fautifs, `aperçus français qui montrent de l’anglais :\n${fautifs.join('\n')}`).toEqual([]);
  });

  test('[MOD-024] aucun aperçu ne montre de clé technique brute (conditions du déclencheur, « Si … »)', async ({ page }) => {
    test.setTimeout(300_000);
    const fenetre = await ouvrirBibliotheque(page);
    const fautifs: string[] = [];
    for (const m of MODELES) {
      await carteModele(fenetre, m.nom.fr).click();
      await expect(fenetre.getByRole('heading', { name: m.nom.fr, exact: true })).toBeVisible();
      // Le bloc du déclencheur et les intitulés d'étape (pas les textes de message).
      const bloc = await fenetre.getByText('Déclencheur', { exact: true }).locator('xpath=..').innerText();
      const intitules = await fenetre.getByRole('listitem').locator('> div').allInnerTexts();
      const cles = clesBrutes([bloc, ...intitules].join('\n'));
      if (cles.length) {
        fautifs.push(`${m.nom.fr} → ${cles.join(' ; ')}`);
        if (fautifs.length === 1) await page.screenshot({ path: `${CAPTURES}/mod-024-cles-brutes.png` });
      }
      await fenetre.getByRole('button', { name: 'Retour', exact: true }).click();
    }
    expect(fautifs, `aperçus qui montrent une clé technique :\n${fautifs.join('\n')}`).toEqual([]);
  });

  test('[MOD-024] le nombre d’étapes annoncé sur la carte est celui que l’éditeur montre', async ({ page, copies }) => {
    const m = MODELES.find((x) => x.id === 'welcome_new_lead')!;
    const fenetre = await ouvrirBibliotheque(page);
    await expect(carteModele(fenetre, m.nom.fr)).toContainText(`${m.nb_etapes} étapes`);
    await carteModele(fenetre, m.nom.fr).click();
    await fenetre.getByRole('button', { name: 'Utiliser ce modèle', exact: true }).click();
    await attendreEditeur(page);
    expect(await copies.nouvelles()).toHaveLength(1);
    await page.screenshot({ path: `${CAPTURES}/mod-024-nombre-etapes.png`, fullPage: true });
    await expect(cartesEtape(page)).toHaveCount(m.nb_etapes);
  });

  test('[MOD-029] le même modèle utilisé deux fois donne deux copies distinctes, la seconde nommée « … (2) »', async ({ page, copies }) => {
    const fenetre = await ouvrirBibliotheque(page);
    await carteModele(fenetre, 'Merci après la job').click();
    await fenetre.getByRole('button', { name: 'Utiliser ce modèle', exact: true }).click();
    await attendreEditeur(page);
    await page.getByRole('button', { name: 'Mes automatisations' }).click();
    await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toBeVisible();
    await ouvrirBibliotheque(page, true);
    await carteModele(fenetre, 'Merci après la job').click();
    await fenetre.getByRole('button', { name: 'Utiliser ce modèle', exact: true }).click();
    await attendreEditeur(page);
    const creees = await copies.nouvelles();
    expect(creees.map((r) => r.name)).toEqual(['Merci après la job', 'Merci après la job (2)']);
    expect(creees[0].id).not.toBe(creees[1].id);
    expect(creees[1].steps).toEqual(creees[0].steps);
    expect(creees.every((r) => r.is_active === false && r.is_preset === false)).toBe(true);
    // L'éditeur ouvert est celui de la SECONDE copie.
    expect(page.url().endsWith(`/automations/${creees[1].id}`)).toBe(true);
    await expect(page.getByRole('button', { name: 'Merci après la job (2)', exact: true })).toBeVisible();
  });

  test('[MOD-029] la copie ne porte pas, dans la liste, le même nom qu’une automatisation déjà là @defaut', async ({ page, copies }) => {
    // Chaque bureau reçoit « Contrat signé » d'office (préréglage stocké « Contract Signed », affiché traduit).
    const fenetre = await ouvrirBibliotheque(page);
    await carteModele(fenetre, 'Contrat signé').click();
    await fenetre.getByRole('button', { name: 'Utiliser ce modèle', exact: true }).click();
    await attendreEditeur(page);
    expect(await copies.nouvelles()).toHaveLength(1);
    await page.getByRole('button', { name: 'Mes automatisations' }).click();
    await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Rechercher', exact: true }).fill('Contrat signé');
    await expect(page.getByRole('checkbox', { name: /^Cocher Contrat signé/ }).first()).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/mod-029-deux-lignes-meme-nom.png` });
    // Deux lignes au nom strictement identique : impossible de savoir laquelle est la copie.
    await expect(page.getByRole('checkbox', { name: 'Cocher Contrat signé', exact: true })).toHaveCount(1);
  });
});
