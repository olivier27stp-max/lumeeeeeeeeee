/**
 * Éditeur de COURRIEL pleine page (`EmailPreviewEditor`), ouvert par « Modifier »
 * dans la ligne dépliée d'une automatisation à l'ancien format — MSG-012 à MSG-037.
 *
 * Ce que ce fichier prouve : le courriel s'ouvre lisible (aucune balise), se
 * ferme par ses quatre chemins avec une confirmation quand du travail serait
 * perdu ; l'objet et chaque ligne s'enregistrent mot pour mot (accents, émojis,
 * « < & " ») et se relisent identiques ; un objet ou un corps vide est refusé
 * avec une phrase claire ; chaque bouton « Insérer » vise le bon champ ; une
 * variable qui n'existe pas est signalée ; « Aperçu réel » montre le rendu du
 * serveur ; « M'envoyer un essai » dit ce qu'il a fait et le bac à sable le
 * retient ; rien n'est tronqué en silence.
 */
import type { Locator, Page } from '@playwright/test';
import { MODELES_AUTOMATISATION } from '../../../server/lib/automationTemplates';
import {
  test, expect, ouvrirListe, creerRegle, lireRegle, deplierMessages, CAPTURES, type Bureau, type LigneRegle,
} from './aides';

// Poste et staging partagés par plusieurs passes : les chargements sont lents par moments.
test.describe.configure({ timeout: 240_000 });

const ENVELOPPE = '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">';
const P = (t: string) => `<p style="color:#333;line-height:1.6;">${t}</p>`;
const OBJET = 'Votre rendez-vous du [appointment_date]';
const CORPS = `${ENVELOPPE}<h2 style="color:#1a1a1a;font-size:18px;">Votre rendez-vous approche</h2>${P('Bonjour [client_first_name],')}${P('Nous serons chez vous le [appointment_date].')}<ul style="padding-left:18px;line-height:1.6;"><li>Libérez l’entrée</li><li>Attachez le chien</li></ul>${P('Merci, [company_name]')}</div>`;
const LIGNES = ['Votre rendez-vous approche', 'Bonjour [client_first_name],', 'Nous serons chez vous le [appointment_date].', '- Libérez l’entrée', '- Attachez le chien', 'Merci, [company_name]'];

/** Ce qu'un lecteur voit d'un corps HTML : une ligne par bloc, « - » devant une puce. */
function lignesVisibles(html: string): string[] {
  return html
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/(h[1-6]|p|li|div)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .split('\n').map((l) => l.trim()).filter(Boolean);
}

async function regleCourriel(bureau: Bureau, marque: string, config: Record<string, unknown> = { subject: OBJET, body: CORPS }): Promise<LigneRegle> {
  return creerRegle(bureau, bureau.orgA, { name: `${marque} courriel`, actions: [{ type: 'send_email', config }] });
}

const courrielEnBase = async (bureau: Bureau, id: string): Promise<{ subject: string; body: string }> => {
  const c = (await lireRegle(bureau, id))?.actions?.find((a) => a.type === 'send_email')?.config ?? {};
  return { subject: String(c.subject ?? ''), body: String(c.body ?? '') };
};

/** La fenêtre de l'éditeur. Elle n'a ni rôle ni nom accessible : on l'atteint par son sous-titre. */
const editeur = (page: Page): Locator => page
  .getByText(/^(Cliquez sur le texte pour le modifier|Click the text to edit it)$/)
  .locator('xpath=ancestor::div[contains(@class,"fixed")][1]');
const objet = (page: Page): Locator => page.getByRole('textbox', { name: /^(Objet du courriel|Email subject)$/ });
const blocs = (page: Page): Locator => editeur(page).getByRole('textbox', { name: /^(Titre|Paragraphe|Puce|Title|Paragraph|Bullet)$/ });
const enregistrer = (page: Page): Locator => editeur(page).getByRole('button', { name: /^(Enregistrer|Save)$/ });
const croix = (page: Page): Locator => editeur(page).getByRole('button', { name: /^(Fermer|Close)$/ }).first();
const fermerPied = (page: Page): Locator => editeur(page).getByRole('button', { name: /^(Fermer|Close)$/ }).last();
const ongletApercu = (page: Page): Locator => editeur(page).getByRole('button', { name: /^(Aperçu réel|Real preview)$/ });
const ongletModifier = (page: Page): Locator => editeur(page).getByRole('button', { name: /^(Modifier|Edit)$/ });
const cadre = (page: Page) => page.frameLocator('iframe[title="Aperçu du courriel"], iframe[title="Email preview"]');
/**
 * Le titre du courriel dans l'aperçu « réel ». Depuis #859 l'aperçu est le VRAI gabarit d'envoi
 * (`rendreCourrielClient`, server/routes/emails.ts) : il porte, caché (`display:none`), le texte de
 * pré-en-tête que la boîte de réception affiche — donc les premières lignes du courriel une seconde
 * fois. Un texte de l'aperçu se vise par son rôle ou en entier (`exact`), jamais par un fragment.
 */
const titreApercu = (page: Page): Locator => cadre(page).getByRole('heading', { name: 'Votre rendez-vous approche', exact: true });
const dialogue = (page: Page): Locator => page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({ hasText: /Fermer quand même|Close anyway/ });

/** Le traceur de Playwright injecte un script dans l'iframe `sandbox=""` de l'aperçu : Chrome le bloque et le dit en console. Artefact d'outil, prouvé par outils/modeles/preuve-iframe.mjs. */
const ARTEFACT_IFRAME = /Blocked script execution in 'about:srcdoc'/;

async function ouvrirEditeur(page: Page, marque: string, dejaSurLaListe = false): Promise<void> {
  if (!dejaSurLaListe) await ouvrirListe(page);
  await deplierMessages(page, marque);
  await page.getByRole('button', { name: /^(Modifier|Edit)$/ }).first().click();
  await expect(editeur(page)).toBeVisible();
  await expect(objet(page)).toBeVisible();
}

async function texteDesBlocs(page: Page): Promise<string[]> {
  const n = await blocs(page).count();
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const b = blocs(page).nth(i);
    const puce = (await b.getAttribute('aria-label')) === 'Puce' || (await b.getAttribute('aria-label')) === 'Bullet';
    out.push(`${puce ? '- ' : ''}${await b.inputValue()}`);
  }
  return out;
}

test.describe('courriel — bloc compact et ouverture', () => {
  test('[MSG-012] le bloc compact montre l’objet et les trois premières lignes avec des exemples ; « Modifier » ouvre l’éditeur sur le texte de la base', async ({ page, bureau, marque }) => {
    await regleCourriel(bureau, marque);
    await ouvrirListe(page);
    await deplierMessages(page, marque);
    await expect(page.getByText('Courriel envoyé au client', { exact: true })).toBeVisible();
    await expect(page.getByText('Votre rendez-vous du 14 août 2026', { exact: true })).toBeVisible();
    await expect(page.getByText('Bonjour Marie,', { exact: true })).toBeVisible();
    await expect(page.getByText('Nous serons chez vous le 14 août 2026.', { exact: true })).toBeVisible();
    await expect(page.getByText('…', { exact: true })).toBeVisible();
    // La 4e ligne n'est pas dans le bloc compact.
    await expect(page.getByText('Attachez le chien')).toHaveCount(0);
    await page.getByRole('button', { name: 'Modifier', exact: true }).click();
    await expect(editeur(page)).toBeVisible();
    await expect(editeur(page).getByText(`${marque} courriel`)).toBeVisible();
    await expect(objet(page)).toHaveValue(OBJET);
    expect(await texteDesBlocs(page)).toEqual(LIGNES);
    await expect(blocs(page).nth(0)).toHaveAttribute('aria-label', 'Titre');
    await expect(blocs(page).nth(3)).toHaveAttribute('aria-label', 'Puce');
    // Aucune balise visible, nulle part.
    await expect(editeur(page)).not.toContainText('<p');
    await expect(editeur(page)).not.toContainText('style=');
    // Rien n'a été touché : l'éditeur le dit, et « Enregistrer » est grisé.
    await expect(editeur(page).getByText('Aucune modification')).toBeVisible();
    await expect(enregistrer(page)).toBeDisabled();
    // MSG-034 : « Revenir au texte d'origine » n'existe pas depuis la liste (seulement dans Paramètres → Modèles de courriel).
    await expect(editeur(page).getByRole('button', { name: 'Revenir au texte d’origine' })).toHaveCount(0);
  });

  test('[MSG-034] « Revenir au texte d’origine » est absent de l’éditeur ouvert depuis la liste (présent seulement dans Paramètres)', async ({ page, bureau, marque }) => {
    await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    await blocs(page).nth(1).fill('Texte changé');
    await expect(editeur(page).getByRole('button', { name: /Revenir au texte d’origine|Restore original/ })).toHaveCount(0);
    await expect(editeur(page).getByRole('button')).not.toHaveCount(0);
  });

  test('[MSG-020] l’en-tête et le pied montrés autour du texte sont ceux de l’entreprise (nom, téléphone, courriel)', async ({ page, bureau, marque }) => {
    await regleCourriel(bureau, marque);
    const { data: reglages } = await bureau.admin.from('company_settings').select('company_name, phone, email').eq('org_id', bureau.orgA).single();
    await ouvrirEditeur(page, marque);
    await expect(editeur(page).getByText(String(reglages?.company_name), { exact: true }).first()).toBeVisible();
    await expect(editeur(page).getByText(String(reglages?.phone), { exact: true })).toBeVisible();
    await expect(editeur(page).getByText(String(reglages?.email), { exact: true })).toBeVisible();
    await expect(editeur(page).getByText('Envoyé avec')).toBeVisible();
  });
});

test.describe('courriel — fermer', () => {
  test('[MSG-013][MSG-014][MSG-015][MSG-035] sans modification, ×, « Fermer », Échap et le fond ferment tout de suite', async ({ page, bureau, marque }) => {
    await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    await croix(page).click();
    await expect(editeur(page)).toBeHidden();
    await page.getByRole('button', { name: 'Modifier', exact: true }).click();
    await fermerPied(page).click();
    await expect(editeur(page)).toBeHidden();
    await page.getByRole('button', { name: 'Modifier', exact: true }).click();
    await expect(editeur(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(editeur(page)).toBeHidden();
    await page.getByRole('button', { name: 'Modifier', exact: true }).click();
    await expect(editeur(page)).toBeVisible();
    await page.mouse.click(10, 450);
    await expect(editeur(page)).toBeHidden();
    await expect(dialogue(page)).toHaveCount(0);
  });

  test('[MSG-037][MSG-013][MSG-014][MSG-015][MSG-035] avec une modification, chaque chemin demande confirmation ; « Annuler » garde le texte, « Confirmer » ferme sans rien écrire', async ({ page, bureau, marque }) => {
    const r = await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    await blocs(page).nth(1).fill('Bonjour, texte en cours de frappe');
    await expect(editeur(page).getByText('Modifications non enregistrées')).toBeVisible();
    const chemins: Array<() => Promise<void>> = [
      () => croix(page).click(),
      () => fermerPied(page).click(),
      () => page.keyboard.press('Escape'),
      () => page.mouse.click(10, 450),
    ];
    for (const fermer of chemins) {
      await fermer();
      await expect(page.getByText('Vos modifications ne sont pas enregistrées. Fermer quand même ?')).toBeVisible();
      await page.getByRole('button', { name: 'Annuler', exact: true }).click();
      await expect(page.getByText('Vos modifications ne sont pas enregistrées. Fermer quand même ?')).toBeHidden();
      await expect(editeur(page)).toBeVisible();
      await expect(blocs(page).nth(1)).toHaveValue('Bonjour, texte en cours de frappe');
    }
    await croix(page).click();
    await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
    await expect(editeur(page)).toBeHidden();
    expect(await courrielEnBase(bureau, r.id)).toEqual({ subject: OBJET, body: CORPS });
    // Rouvert : le texte d'origine, pas la saisie abandonnée.
    await page.getByRole('button', { name: 'Modifier', exact: true }).click();
    await expect(blocs(page).nth(1)).toHaveValue('Bonjour [client_first_name],');
  });

  test('[MSG-037][MSG-015] dans la confirmation, Échap annule la confirmation — une seule fois, sans la rouvrir', async ({ page, bureau, marque }) => {
    await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    await objet(page).fill('Objet en cours');
    await page.keyboard.press('Escape');
    const question = page.getByText('Vos modifications ne sont pas enregistrées. Fermer quand même ?');
    await expect(question).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(question).toBeHidden();
    await expect(editeur(page)).toBeVisible();
    await expect(objet(page)).toHaveValue('Objet en cours');
    await expect(question).toHaveCount(0);
  });

  test('[MSG-037] la confirmation dit ce que fait chaque bouton (pas « Êtes-vous sûr ? » / « Confirmer ») @defaut', async ({ page, bureau, marque }) => {
    await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    await objet(page).fill('Objet en cours');
    await croix(page).click();
    await expect(page.getByText('Vos modifications ne sont pas enregistrées. Fermer quand même ?')).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/msg-037-confirmation.png` });
    // Un bouton qui dit ce qu'il fait : « Fermer sans enregistrer », « Continuer à modifier »…
    await expect(page.getByRole('button', { name: /Fermer sans enregistrer|Abandonner|Quitter/ })).toBeVisible({ timeout: 3_000 });
  });

  test('[MSG-013][MSG-015] clavier : le focus entre dans l’éditeur à l’ouverture, y reste avec Tab, et revient sur « Modifier » à la fermeture @defaut', async ({ page, bureau, marque }) => {
    await regleCourriel(bureau, marque);
    await ouvrirListe(page);
    await deplierMessages(page, marque);
    const modifier = page.getByRole('button', { name: 'Modifier', exact: true });
    await modifier.focus();
    await page.keyboard.press('Enter');
    await expect(editeur(page)).toBeVisible();
    const dedans = () => editeur(page).evaluate((el) => el.contains(document.activeElement) && document.activeElement !== document.body);
    expect.soft(await dedans(), 'à l’ouverture, le focus n’est pas dans l’éditeur').toBe(true);
    let sorties = 0;
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Shift+Tab');
      if (!(await dedans())) sorties += 1;
    }
    expect.soft(sorties, 'Maj+Tab fait sortir le focus vers la page derrière la fenêtre').toBe(0);
    const role = await editeur(page).evaluate((el) => el.querySelector('[role="dialog"]') !== null || el.getAttribute('role') === 'dialog');
    expect.soft(role, 'la fenêtre n’a pas role="dialog" : un lecteur d’écran ne sait pas qu’une fenêtre s’est ouverte').toBe(true);
    await page.keyboard.press('Escape');
    await expect(editeur(page)).toBeHidden();
    await expect(modifier).toBeFocused();
  });
});

test.describe('courriel — modifier et enregistrer', () => {
  test('[MSG-019][MSG-020][MSG-036] objet et paragraphe modifiés : succès annoncé, base à jour mot pour mot, relus identiques après rechargement', async ({ page, bureau, marque }) => {
    const r = await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    await objet(page).fill('Rappel : rendez-vous le [appointment_date] à [appointment_time]');
    await blocs(page).nth(2).fill('Nous serons chez vous le [appointment_date], vers [appointment_time].');
    await expect(editeur(page).getByText('Modifications non enregistrées')).toBeVisible();
    await expect(enregistrer(page)).toBeEnabled();
    await enregistrer(page).click();
    await expect(page.getByText('Courriel enregistré')).toBeVisible();
    const attendues = [...LIGNES];
    attendues[2] = 'Nous serons chez vous le [appointment_date], vers [appointment_time].';
    await expect.poll(async () => (await courrielEnBase(bureau, r.id)).subject).toBe('Rappel : rendez-vous le [appointment_date] à [appointment_time]');
    expect(lignesVisibles((await courrielEnBase(bureau, r.id)).body)).toEqual(attendues);
    await page.reload();
    await ouvrirEditeur(page, marque);
    await expect(objet(page)).toHaveValue('Rappel : rendez-vous le [appointment_date] à [appointment_time]');
    expect(await texteDesBlocs(page)).toEqual(attendues);
    await expect(editeur(page).getByText('Aucune modification')).toBeVisible();
    await expect(editeur(page)).not.toContainText('<p');
    // Le reste de la règle n'a pas bougé.
    expect(await lireRegle(bureau, r.id)).toMatchObject({ name: r.name, is_active: false, trigger_event: r.trigger_event });
  });

  test('[MSG-036] après « Enregistrer », l’éditeur reste ouvert et montre que c’est enregistré (il ne disparaît pas tout seul) @defaut', async ({ page, bureau, marque }) => {
    const r = await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    await objet(page).fill('Nouvel objet');
    await enregistrer(page).click();
    await expect(page.getByText('Courriel enregistré')).toBeVisible();
    await expect.poll(async () => (await courrielEnBase(bureau, r.id)).subject).toBe('Nouvel objet');
    await page.screenshot({ path: `${CAPTURES}/msg-036-editeur-ferme-tout-seul.png` });
    // Personne n'a cliqué « Fermer » : la fenêtre doit être là, avec « Aucune modification ».
    await expect(editeur(page)).toBeVisible();
    await expect(editeur(page).getByText('Aucune modification')).toBeVisible();
  });

  test('[MSG-036] après l’enregistrement, la ligne reste dépliée et le bloc compact montre le nouveau texte', async ({ page, bureau, marque }) => {
    await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    await objet(page).fill('Objet tout neuf');
    await blocs(page).nth(1).fill('Bonjour à vous,');
    await enregistrer(page).click();
    await expect(page.getByText('Courriel enregistré')).toBeVisible();
    await expect(page.getByText('Objet tout neuf', { exact: true })).toBeVisible();
    await expect(page.getByText('Bonjour à vous,', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Voir les messages de / }).first()).toHaveAttribute('aria-expanded', 'true');
  });

  test('[MSG-019][MSG-020] accents, émojis, « < & " \' » : enregistrés mot pour mot, relus identiques, jamais interprétés comme du HTML', async ({ page, bureau, marque, moniteur }) => {
    moniteur.attendu(ARTEFACT_IFRAME, 'artefact du traceur Playwright dans l’iframe sandbox');
    const r = await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    const objetSaisi = 'Été 2026 : « offre » <b>50 %</b> & "plus" 😀';
    const ligneSaisie = 'Ça marche? <script>alert(1)</script> & <b>gras</b> "guillemets" \'apostrophe\' — 👍 € £';
    await objet(page).fill(objetSaisi);
    await blocs(page).nth(1).fill(ligneSaisie);
    // L'aperçu réel montre le texte tel quel : pas de gras, pas de script exécuté.
    await ongletApercu(page).click();
    await expect(cadre(page).getByText(ligneSaisie, { exact: true })).toBeVisible();
    await expect(cadre(page).locator('script')).toHaveCount(0);
    await expect(cadre(page).locator('b, strong', { hasText: 'gras' })).toHaveCount(0);
    await ongletModifier(page).click();
    await expect(blocs(page).nth(1)).toHaveValue(ligneSaisie);
    await enregistrer(page).click();
    await expect(page.getByText('Courriel enregistré')).toBeVisible();
    await expect.poll(async () => (await courrielEnBase(bureau, r.id)).subject).toBe(objetSaisi);
    const enBase = await courrielEnBase(bureau, r.id);
    expect(lignesVisibles(enBase.body)[1]).toBe(ligneSaisie);
    expect(enBase.body).not.toContain('<script>');
    expect(enBase.body).not.toContain('<b>');
    await page.reload();
    await ouvrirEditeur(page, marque);
    await expect(objet(page)).toHaveValue(objetSaisi);
    await expect(blocs(page).nth(1)).toHaveValue(ligneSaisie);
  });

  test('[MSG-020] un retour à la ligne tapé dans un paragraphe est conservé (deux lignes à la relecture), rien n’est perdu', async ({ page, bureau, marque }) => {
    const r = await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    await blocs(page).nth(1).fill('Bonjour,\nDeuxième ligne du même paragraphe');
    await enregistrer(page).click();
    await expect(page.getByText('Courriel enregistré')).toBeVisible();
    await expect.poll(async () => lignesVisibles((await courrielEnBase(bureau, r.id)).body)).toEqual([
      LIGNES[0], 'Bonjour,', 'Deuxième ligne du même paragraphe', ...LIGNES.slice(2),
    ]);
  });

  test('[MSG-019][MSG-036] un objet vide est refusé avec une phrase claire ; l’éditeur reste ouvert et rien n’est écrit', async ({ page, bureau, marque }) => {
    const r = await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    await objet(page).fill('   ');
    await enregistrer(page).click();
    await expect(page.getByText('L’objet du courriel ne peut pas être vide.')).toBeVisible();
    await expect(page.getByText('Courriel enregistré')).toHaveCount(0);
    await expect(editeur(page)).toBeVisible();
    expect(await courrielEnBase(bureau, r.id)).toEqual({ subject: OBJET, body: CORPS });
  });

  test('[MSG-020][MSG-021][MSG-036] un courriel vidé de toutes ses lignes est refusé : « Le message ne peut pas être vide. »', async ({ page, bureau, marque }) => {
    const r = await regleCourriel(bureau, marque, { subject: 'Objet', body: `${ENVELOPPE}<h2 style="color:#1a1a1a;font-size:18px;">Seule ligne</h2></div>` });
    await ouvrirEditeur(page, marque);
    await blocs(page).nth(0).hover();
    await editeur(page).getByRole('button', { name: 'Supprimer cette ligne' }).click();
    await expect(editeur(page).getByText('Courriel vide — ajoutez une ligne ci-dessous.')).toBeVisible();
    await enregistrer(page).click();
    await expect(page.getByText('Le message ne peut pas être vide.')).toBeVisible();
    await expect(page.getByText('Courriel enregistré')).toHaveCount(0);
    expect((await courrielEnBase(bureau, r.id)).body).toContain('Seule ligne');
    // Des lignes qui ne contiennent que des espaces : même refus.
    await editeur(page).getByRole('button', { name: 'Paragraphe', exact: true }).click();
    await blocs(page).nth(0).fill('    ');
    await enregistrer(page).click();
    await expect(page.getByText('Le message ne peut pas être vide.').first()).toBeVisible();
    expect((await courrielEnBase(bureau, r.id)).body).toContain('Seule ligne');
  });

  test('[MSG-019][MSG-020] un objet de 300 caractères et un paragraphe de 5 000 s’enregistrent en entier', async ({ page, bureau, marque }) => {
    const r = await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    const longObjet = `Objet ${'o'.repeat(290)} fin`;
    const longTexte = `Début ${'mot '.repeat(1245)}fin.`;
    await objet(page).fill(longObjet);
    await blocs(page).nth(1).fill(longTexte);
    await enregistrer(page).click();
    await expect(page.getByText('Courriel enregistré')).toBeVisible();
    await expect.poll(async () => (await courrielEnBase(bureau, r.id)).subject).toBe(longObjet);
    expect(lignesVisibles((await courrielEnBase(bureau, r.id)).body)[1]).toBe(longTexte.trim());
  });

  test('[MSG-019] un objet très long est signalé (une boîte de réception en coupe l’essentiel après ~70 caractères) @defaut', async ({ page, bureau, marque }) => {
    await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    await objet(page).fill(`Objet ${'o'.repeat(290)} fin`);
    await page.screenshot({ path: `${CAPTURES}/msg-019-objet-long.png` });
    // Un compteur, une limite ou un avertissement : quelque chose doit le dire.
    await expect(editeur(page).getByText(/caractères|trop long|coupé/i)).toBeVisible({ timeout: 3_000 });
  });

  test('[MSG-036] panne à l’enregistrement : l’erreur est dite, la saisie reste, la base n’a pas bougé', async ({ page, bureau, marque, moniteur }) => {
    moniteur.attendu(/503 PATCH .*automation_rules/, 'panne simulée par page.route');
    const r = await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    await page.route('**/rest/v1/automation_rules**', (route) => (route.request().method() === 'PATCH'
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Service indisponible' }) })
      : route.fallback()));
    await objet(page).fill('Objet que la panne ne doit pas perdre');
    await enregistrer(page).click();
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Service indisponible' })).toBeVisible();
    await expect(page.getByText('Courriel enregistré')).toHaveCount(0);
    await expect(editeur(page)).toBeVisible();
    await expect(objet(page)).toHaveValue('Objet que la panne ne doit pas perdre');
    await expect(enregistrer(page)).toBeEnabled();
    expect(await courrielEnBase(bureau, r.id)).toEqual({ subject: OBJET, body: CORPS });
  });
});

test.describe('courriel — mise en forme conservée', () => {
  test('[MSG-020][MSG-036] corriger un mot ne détruit pas le lien « Voir votre soumission » ni le gras d’un autre paragraphe @defaut', async ({ page, bureau, marque }) => {
    // Le courriel d'un préréglage fourni : un lien avec libellé, comme dans « Relance de devis ».
    const corps = `${ENVELOPPE}<h2 style="color:#1a1a1a;font-size:18px;">Bonjour [client_first_name],</h2>${P('On vous a envoyé une soumission hier.')}${P('<strong>Offre valable 30 jours.</strong>')}<p style="color:#333;line-height:1.6;"><a href="[quote_link]">Voir votre soumission</a></p>${P('Merci, [company_name]')}</div>`;
    const r = await regleCourriel(bureau, marque, { subject: 'Votre soumission', body: corps });
    await ouvrirEditeur(page, marque);
    await page.screenshot({ path: `${CAPTURES}/msg-020-lien-devenu-crochet.png` });
    await blocs(page).nth(1).fill('On vous a envoyé une soumission avant-hier.');
    await enregistrer(page).click();
    await expect(page.getByText('Courriel enregistré')).toBeVisible();
    await expect.poll(async () => (await courrielEnBase(bureau, r.id)).body).toContain('avant-hier');
    const enBase = (await courrielEnBase(bureau, r.id)).body;
    expect.soft(enBase, 'le libellé du lien a disparu').toContain('Voir votre soumission');
    expect.soft(enBase, 'le lien n’est plus un lien').toMatch(/<a [^>]*href="\[quote_link\]"/);
    expect.soft(enBase, 'le gras a disparu').toContain('<strong>');
  });

  test('[MSG-020][MSG-036] un courriel qui commence par un paragraphe ne se retrouve pas avec ce paragraphe en titre @defaut', async ({ page, bureau, marque }) => {
    const corps = `${ENVELOPPE}${P('Bonjour [client_first_name],')}${P('Votre facture est prête.')}</div>`;
    const r = await regleCourriel(bureau, marque, { subject: 'Votre facture', body: corps });
    await ouvrirEditeur(page, marque);
    await blocs(page).nth(1).fill('Votre facture est prête, merci!');
    await enregistrer(page).click();
    await expect(page.getByText('Courriel enregistré')).toBeVisible();
    await expect.poll(async () => (await courrielEnBase(bureau, r.id)).body).toContain('merci!');
    expect((await courrielEnBase(bureau, r.id)).body).not.toMatch(/<h2[^>]*>Bonjour/);
  });
});

test.describe('courriel — lignes : ajouter, supprimer, rétablir', () => {
  test('[MSG-023][MSG-024] « Paragraphe » et « Puce » ajoutent une ligne vide en fin de courriel ; ce qu’on y tape s’enregistre dans le bon format', async ({ page, bureau, marque }) => {
    const r = await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    await expect(blocs(page)).toHaveCount(6);
    await editeur(page).getByRole('button', { name: 'Paragraphe', exact: true }).click();
    await expect(blocs(page)).toHaveCount(7);
    await expect(blocs(page).nth(6)).toHaveAttribute('aria-label', 'Paragraphe');
    await expect(blocs(page).nth(6)).toHaveAttribute('placeholder', 'Écrivez ici…');
    await blocs(page).nth(6).fill('À bientôt!');
    await editeur(page).getByRole('button', { name: 'Puce', exact: true }).click();
    await expect(blocs(page).nth(7)).toHaveAttribute('aria-label', 'Puce');
    await blocs(page).nth(7).fill('Dernier point');
    await enregistrer(page).click();
    await expect(page.getByText('Courriel enregistré')).toBeVisible();
    await expect.poll(async () => lignesVisibles((await courrielEnBase(bureau, r.id)).body)).toEqual([...LIGNES, 'À bientôt!', '- Dernier point']);
    const corps = (await courrielEnBase(bureau, r.id)).body;
    expect(corps).toMatch(/<p[^>]*>À bientôt!<\/p>/);
    expect(corps).toMatch(/<ul[^>]*><li>Dernier point<\/li><\/ul>/);
  });

  test('[MSG-023] la ligne ajoutée reçoit le curseur : on peut taper tout de suite @defaut', async ({ page, bureau, marque }) => {
    await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    await editeur(page).getByRole('button', { name: 'Paragraphe', exact: true }).click();
    await expect(blocs(page)).toHaveCount(7);
    await expect(blocs(page).nth(6)).toBeFocused({ timeout: 3_000 });
  });

  test('[MSG-021][MSG-022] la corbeille d’une ligne la retire ; « Annuler » dans le message la remet à sa place', async ({ page, bureau, marque }) => {
    const r = await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    await blocs(page).nth(2).hover();
    await editeur(page).getByRole('button', { name: 'Supprimer cette ligne' }).nth(2).click();
    await expect(blocs(page)).toHaveCount(5);
    expect(await texteDesBlocs(page)).toEqual([...LIGNES.slice(0, 2), ...LIGNES.slice(3)]);
    const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Ligne supprimée' });
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Annuler' }).click();
    await expect(blocs(page)).toHaveCount(6);
    expect(await texteDesBlocs(page)).toEqual(LIGNES);
    // Revenu au texte d'origine : plus rien à enregistrer, et la base n'a pas bougé.
    await expect(editeur(page).getByText('Aucune modification')).toBeVisible();
    expect(await courrielEnBase(bureau, r.id)).toEqual({ subject: OBJET, body: CORPS });
  });

  test('[MSG-021][MSG-036] une ligne supprimée puis « Enregistrer » : elle disparaît de la base, les autres restent', async ({ page, bureau, marque }) => {
    const r = await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    await blocs(page).nth(4).hover();
    await editeur(page).getByRole('button', { name: 'Supprimer cette ligne' }).nth(4).click();
    await enregistrer(page).click();
    await expect(page.getByText('Courriel enregistré')).toBeVisible();
    await expect.poll(async () => lignesVisibles((await courrielEnBase(bureau, r.id)).body)).toEqual([...LIGNES.slice(0, 4), LIGNES[5]]);
  });

  test('[MSG-021] la corbeille d’une ligne est visible quand on l’atteint au clavier ou au toucher (pas seulement au survol) @defaut', async ({ page, bureau, marque }) => {
    await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    const corbeille = editeur(page).getByRole('button', { name: 'Supprimer cette ligne' }).nth(1);
    await blocs(page).nth(1).focus();
    await page.keyboard.press('Tab');
    await expect(corbeille).toBeFocused();
    await page.screenshot({ path: `${CAPTURES}/msg-021-corbeille-invisible-au-clavier.png` });
    await expect(corbeille).toHaveCSS('opacity', '1');
  });
});

test.describe('courriel — boutons « Insérer » et variables', () => {
  const VARIABLES: Array<[string, string, string]> = [
    ['MSG-025', 'Prénom du client', 'client_first_name'],
    ['MSG-026', 'Nom complet', 'client_name'],
    ['MSG-027', 'Votre entreprise', 'company_name'],
    ['MSG-028', 'N° de facture', 'invoice_number'],
    ['MSG-029', 'Montant', 'invoice_total'],
    ['MSG-030', 'N° de soumission', 'quote_number'],
    ['MSG-031', 'Date du RDV', 'appointment_date'],
    ['MSG-032', 'Heure du RDV', 'appointment_time'],
  ];

  test(`${VARIABLES.map(([id]) => `[${id}]`).join('')} chaque bouton insère SA variable : dans l’objet si l’objet a le curseur, dans la ligne cliquée sinon`, async ({ page, bureau, marque }) => {
    const r = await regleCourriel(bureau, marque, { subject: 'Objet', body: `${ENVELOPPE}<h2 style="color:#1a1a1a;font-size:18px;">Titre</h2>${P('Ligne A')}${P('Ligne B')}</div>` });
    await ouvrirEditeur(page, marque);
    await expect(editeur(page).getByText('Insérer :')).toBeVisible();
    let dansObjet = 'Objet';
    let dansLigne = 'Ligne A';
    for (const [, libelle, cle] of VARIABLES) {
      const bouton = editeur(page).getByRole('button', { name: libelle, exact: true });
      await expect(bouton).toHaveAttribute('title', `[${cle}]`);
      await objet(page).click();
      await bouton.click();
      dansObjet += `[${cle}]`;
      await expect(objet(page)).toHaveValue(dansObjet);
      await blocs(page).nth(1).click();
      await bouton.click();
      dansLigne += `[${cle}]`;
      await expect(blocs(page).nth(1)).toHaveValue(dansLigne);
    }
    // Les autres lignes n'ont rien reçu, et aucune de ces variables n'est dite inconnue.
    await expect(blocs(page).nth(0)).toHaveValue('Titre');
    await expect(blocs(page).nth(2)).toHaveValue('Ligne B');
    await expect(editeur(page).getByText(/n’existe pas|n’existent pas/)).toHaveCount(0);
    await enregistrer(page).click();
    await expect(page.getByText('Courriel enregistré')).toBeVisible();
    await expect.poll(async () => (await courrielEnBase(bureau, r.id)).subject).toBe(dansObjet);
    expect(lignesVisibles((await courrielEnBase(bureau, r.id)).body)).toEqual(['Titre', dansLigne, 'Ligne B']);
  });

  test('[MSG-025] sans ligne cliquée, la variable va à la fin de la dernière ligne', async ({ page, bureau, marque }) => {
    await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    await editeur(page).getByRole('button', { name: 'Prénom du client', exact: true }).click();
    await expect(blocs(page).nth(5)).toHaveValue('Merci, [company_name][client_first_name]');
    await expect(objet(page)).toHaveValue(OBJET);
  });

  test('[MSG-025] « Insérer » place la variable là où est le curseur, pas en fin de ligne @defaut', async ({ page, bureau, marque }) => {
    await regleCourriel(bureau, marque, { subject: 'Objet', body: `${ENVELOPPE}<h2 style="color:#1a1a1a;font-size:18px;">Titre</h2>${P('Bonjour , à demain.')}</div>` });
    await ouvrirEditeur(page, marque);
    await blocs(page).nth(1).click();
    await blocs(page).nth(1).evaluate((el: HTMLTextAreaElement) => { el.focus(); el.setSelectionRange(8, 8); });
    await editeur(page).getByRole('button', { name: 'Prénom du client', exact: true }).click();
    await expect(blocs(page).nth(1)).toHaveValue('Bonjour [client_first_name], à demain.');
  });

  test('[MSG-025] sur un courriel sans aucune ligne, « Insérer » fait quelque chose de visible (ou est désactivé) @defaut', async ({ page, bureau, marque }) => {
    await regleCourriel(bureau, marque, { subject: 'Objet', body: `${ENVELOPPE}<h2 style="color:#1a1a1a;font-size:18px;">Seule ligne</h2></div>` });
    await ouvrirEditeur(page, marque);
    await blocs(page).nth(0).hover();
    await editeur(page).getByRole('button', { name: 'Supprimer cette ligne' }).click();
    await expect(blocs(page)).toHaveCount(0);
    const bouton = editeur(page).getByRole('button', { name: 'Prénom du client', exact: true });
    const desactive = await bouton.isDisabled();
    if (!desactive) await bouton.click();
    // Soit le bouton est grisé, soit une ligne apparaît avec la variable.
    expect(desactive || (await blocs(page).count()) > 0, 'le clic n’a rien fait, sans rien dire').toBe(true);
  });

  test('[MSG-025][MSG-017] sur l’onglet « Aperçu réel », les boutons « Insérer » ne modifient pas un texte qu’on ne voit pas @defaut', async ({ page, bureau, marque, moniteur }) => {
    moniteur.attendu(ARTEFACT_IFRAME, 'artefact du traceur Playwright dans l’iframe sandbox');
    await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    await ongletApercu(page).click();
    await expect(cadre(page).locator('body')).toBeVisible();
    const bouton = editeur(page).getByRole('button', { name: 'Prénom du client', exact: true });
    if (await bouton.isVisible() && await bouton.isEnabled()) await bouton.click();
    // Rien n'a été saisi par l'utilisateur dans un champ visible : il ne doit pas y avoir de « modifications non enregistrées ».
    await expect(editeur(page).getByText('Aucune modification')).toBeVisible();
  });

  test('[MSG-033] les boutons de champs (« Client · Prénom »…) insèrent {{objet.cle}} et ne déclenchent aucun avertissement', async ({ page, bureau, marque }) => {
    const r = await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    const bouton = editeur(page).getByRole('button', { name: 'Client · Prénom', exact: true });
    await expect(bouton).toBeVisible();
    const jeton = await bouton.getAttribute('title');
    expect(jeton).toMatch(/^\{\{client\.[a-z_]+\}\}$/);
    await blocs(page).nth(1).click();
    await bouton.click();
    await expect(blocs(page).nth(1)).toHaveValue(`Bonjour [client_first_name],${jeton}`);
    await expect(editeur(page).getByText(/n’existe pas|n’existent pas/)).toHaveCount(0);
    await enregistrer(page).click();
    await expect(page.getByText('Courriel enregistré')).toBeVisible();
    await expect.poll(async () => lignesVisibles((await courrielEnBase(bureau, r.id)).body)[1]).toBe(`Bonjour [client_first_name],${jeton}`);
  });

  test('[MSG-033][MSG-020] la palette « Insérer » laisse la place de lire et d’écrire le courriel (≥ 300 px de haut à 1440 × 900) @defaut', async ({ page, bureau, marque, moniteur }) => {
    moniteur.attendu(ARTEFACT_IFRAME, 'artefact du traceur Playwright dans l’iframe sandbox');
    await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    const nbBoutons = await editeur(page).getByText('Insérer :').locator('xpath=..').getByRole('button').count();
    const zoneTexte = objet(page).locator('xpath=ancestor::div[contains(@class,"overflow-y-auto")][1]');
    const hModifier = (await zoneTexte.boundingBox())?.height ?? 0;
    await page.screenshot({ path: `${CAPTURES}/msg-033-palette-ecrase-le-courriel.png` });
    await ongletApercu(page).click();
    await expect(cadre(page).locator('body')).toBeVisible();
    const essai = editeur(page).getByRole('button', { name: 'M’envoyer un essai' });
    await page.screenshot({ path: `${CAPTURES}/msg-033-palette-ecrase-apercu.png` });
    test.info().annotations.push({ type: 'mesure', description: `${nbBoutons} boutons « Insérer » ; zone du courriel : ${Math.round(hModifier)} px de haut sur 900` });
    expect.soft(hModifier, `${nbBoutons} boutons « Insérer » : il reste ${Math.round(hModifier)} px pour le courriel`).toBeGreaterThanOrEqual(300);
    await expect.soft(essai, '« M’envoyer un essai » est hors de vue sans faire défiler').toBeInViewport({ timeout: 3_000 });
  });

  test('[MSG-019][MSG-020] une variable mal écrite est nommée dans un bandeau (une : singulier ; deux : pluriel) ; un crochet de texte courant ne l’est pas', async ({ page, bureau, marque }) => {
    await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    await blocs(page).nth(1).fill('Bonjour [client_first_nam],');
    await expect(editeur(page).getByText('Cette variable n’existe pas :')).toBeVisible();
    await expect(editeur(page).getByText(/\[client_first_nam\] — votre client verra un blanc, ou le crochet tel quel\. Utilisez les boutons « Insérer » ci-dessous\./)).toBeVisible();
    await objet(page).fill('Facture [invoice-number]');
    await expect(editeur(page).getByText('Ces variables n’existent pas :')).toBeVisible();
    await expect(editeur(page).getByText(/\[invoice-number\], \[client_first_nam\]|\[client_first_nam\], \[invoice-number\]/)).toBeVisible();
    // L'avertissement n'empêche pas d'enregistrer (choix assumé), mais il disparaît quand on corrige.
    await blocs(page).nth(1).fill('Rabais [50 %] pour [client_first_name]');
    await objet(page).fill('Facture [invoice_number]');
    await expect(editeur(page).getByText(/n’existe pas|n’existent pas/)).toHaveCount(0);
  });

  test('[MSG-020] une variable inventée (« [prenom] ») est signalée, comme dans l’éditeur de texto @defaut', async ({ page, bureau, marque }) => {
    await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    await blocs(page).nth(1).fill('Bonjour [prenom],');
    await page.screenshot({ path: `${CAPTURES}/msg-020-prenom-non-signale.png` });
    // Le serveur remplace [prenom] par du vide : le client lira « Bonjour , ».
    await expect(editeur(page).getByText(/n’existe pas/)).toBeVisible({ timeout: 3_000 });
  });

  test('[MSG-020] les variables des courriels FOURNIS ([quote_link], [invoice_due_date]…) ne sont pas dites « inexistantes »', async ({ page, bureau, marque }) => {
    // Un courriel FOURNI qui porte [quote_link], tel que la bibliothèque le crée. (Depuis #870 celui de
    // « Rappel de dépôt — devis accepté » ne l'a plus — le bouton du gabarit le remplace ; les parcours
    // « Dépôt — demande et rappel » et « Relance de devis » le portent toujours : on prend le premier trouvé.)
    const fournis = MODELES_AUTOMATISATION.flatMap((x) => [
      ...x.actions,
      ...(x.steps ?? []).flatMap((e) => (e.type === 'action' ? [e.action] : [])),
    ]).filter((a) => a.type === 'send_email');
    const courriel = fournis.find((a) => String(a.config.body).includes('[quote_link]'));
    expect(courriel, 'aucun courriel fourni ne porte plus [quote_link] : choisir une autre variable fournie').toBeDefined();
    if (!courriel) return;
    await regleCourriel(bureau, marque, { subject: String(courriel.config.subject), body: String(courriel.config.body) });
    await ouvrirEditeur(page, marque);
    await page.screenshot({ path: `${CAPTURES}/msg-020-fausse-alerte-quote-link.png` });
    // Le serveur SAIT remplir [quote_link] (src/lib/emailBodyText.ts, VARIABLES_CONNUES).
    await expect.soft(editeur(page).getByText(/n’existe pas|n’existent pas/)).toHaveCount(0);
    await blocs(page).nth(1).fill('Échéance : [invoice_due_date], adresse : [appointment_address]');
    await expect.soft(editeur(page).getByText(/n’existe pas|n’existent pas/)).toHaveCount(0);
  });
});

test.describe('courriel — « Aperçu réel » et essai', () => {
  test('[MSG-016][MSG-017] « Aperçu réel » montre le rendu du serveur avec le texte en cours (même non enregistré) ; « Modifier » y revient sans rien perdre', async ({ page, bureau, marque, moniteur }) => {
    moniteur.attendu(ARTEFACT_IFRAME, 'artefact du traceur Playwright dans l’iframe sandbox');
    const r = await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    await blocs(page).nth(2).fill('Texte tapé à l’instant, pas encore enregistré.');
    await ongletApercu(page).click();
    await expect(titreApercu(page)).toBeVisible();
    await expect(cadre(page).getByText('Texte tapé à l’instant, pas encore enregistré.', { exact: true })).toBeVisible();
    await expect(cadre(page).getByRole('listitem').filter({ hasText: 'Libérez l’entrée' })).toBeVisible();
    await expect(cadre(page).getByText('Nettoyage Test A').first()).toBeVisible();
    await expect(editeur(page).getByText(/Rendu par le serveur, avec le même gabarit qu’à l’envoi/)).toBeVisible();
    await expect(editeur(page).getByRole('button', { name: 'M’envoyer un essai' })).toBeVisible();
    await ongletModifier(page).click();
    await expect(blocs(page).nth(2)).toHaveValue('Texte tapé à l’instant, pas encore enregistré.');
    await expect(editeur(page).getByText('Modifications non enregistrées')).toBeVisible();
    // Regarder l'aperçu n'écrit rien.
    expect(await courrielEnBase(bureau, r.id)).toEqual({ subject: OBJET, body: CORPS });
  });

  test('[MSG-017] panne de l’aperçu : « Aperçu indisponible… Votre texte est intact », et il l’est', async ({ page, bureau, marque, moniteur }) => {
    moniteur.attendu(/500 POST .*\/api\/emails\/apercu/, 'panne simulée par page.route');
    moniteur.attendu(/\[emailTemplates\] aperçu impossible/, 'le client journalise l’échec');
    await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    await blocs(page).nth(1).fill('Texte à ne pas perdre');
    await page.route('**/api/emails/apercu', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Failed to render preview.' }) }));
    await ongletApercu(page).click();
    await expect(editeur(page).getByText('Aperçu indisponible pour le moment. Votre texte est intact — revenez à « Modifier ».')).toBeVisible();
    await ongletModifier(page).click();
    await expect(blocs(page).nth(1)).toHaveValue('Texte à ne pas perdre');
  });

  test('[MSG-016][MSG-017] les deux onglets disent lequel est actif à un lecteur d’écran (aria-selected ou aria-pressed) @defaut', async ({ page, bureau, marque, moniteur }) => {
    moniteur.attendu(ARTEFACT_IFRAME, 'artefact du traceur Playwright dans l’iframe sandbox');
    await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    await ongletApercu(page).click();
    await expect(cadre(page).locator('body')).toBeVisible();
    const etat = await ongletApercu(page).evaluate((el) => el.getAttribute('aria-selected') ?? el.getAttribute('aria-pressed') ?? el.getAttribute('aria-current'));
    expect(etat).toBe('true');
  });

  test('[MSG-017] l’aperçu « réel » d’un rappel de rendez-vous ne montre pas un montant à payer ni un bouton « Voir et payer » que le client ne recevra pas', async ({ page, bureau, marque, moniteur }) => {
    moniteur.attendu(ARTEFACT_IFRAME, 'artefact du traceur Playwright dans l’iframe sandbox');
    await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    await ongletApercu(page).click();
    await expect(titreApercu(page)).toBeVisible();
    await editeur(page).locator('iframe').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${CAPTURES}/msg-017-apercu-reel-montant.png` });
    // À l'envoi, une automatisation passe par buildEmailLayout(company, corps, bouton de l'entité) : aucun bloc « montant ».
    await expect.soft(cadre(page).getByText('1 220,17 $')).toHaveCount(0);
    await expect.soft(cadre(page).getByText('Montant à payer')).toHaveCount(0);
    await expect.soft(cadre(page).getByText('Voir et payer')).toHaveCount(0);
  });

  test('[MSG-017] l’aperçu « réel » remplace les mêmes variables que le bloc compact de la liste (prénom, date du rendez-vous)', async ({ page, bureau, marque, moniteur }) => {
    moniteur.attendu(ARTEFACT_IFRAME, 'artefact du traceur Playwright dans l’iframe sandbox');
    await regleCourriel(bureau, marque);
    await ouvrirListe(page);
    await deplierMessages(page, marque);
    // Le bloc compact montre « Bonjour Marie, » et « … le 14 août 2026. ».
    await expect(page.getByText('Bonjour Marie,', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Modifier', exact: true }).click();
    await ongletApercu(page).click();
    await expect(titreApercu(page)).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/msg-017-apercu-reel-crochets.png` });
    await expect.soft(cadre(page).getByText(/\[client_first_name\]/)).toHaveCount(0);
    await expect.soft(cadre(page).getByText(/\[appointment_date\]/)).toHaveCount(0);
    // Les mêmes exemples que le bloc compact, à la place des crochets.
    await expect(cadre(page).getByText('Bonjour Marie,', { exact: true })).toBeVisible();
    await expect(cadre(page).getByText('Nous serons chez vous le 14 août 2026.', { exact: true })).toBeVisible();
  });

  test('[MSG-017] dans l’aperçu « réel », [company_name] devient le nom de MON entreprise, pas celui d’une autre @defaut', async ({ page, bureau, marque, moniteur }) => {
    moniteur.attendu(ARTEFACT_IFRAME, 'artefact du traceur Playwright dans l’iframe sandbox');
    await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    await ongletApercu(page).click();
    await expect(titreApercu(page)).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/msg-017-apercu-reel-autre-entreprise.png` });
    await expect.soft(cadre(page).getByText(/Coquin lavage/)).toHaveCount(0);
    await expect(cadre(page).getByText('Merci, Nettoyage Test A', { exact: true })).toBeVisible({ timeout: 3_000 });
  });

  test('[MSG-018] « M’envoyer un essai » : « Envoi… » puis « Essai envoyé à <mon adresse> » ; le bac à sable retient le courriel, avec l’objet et le texte en cours', async ({ page, bureau, marque, moniteur }) => {
    moniteur.attendu(ARTEFACT_IFRAME, 'artefact du traceur Playwright dans l’iframe sandbox');
    const r = await regleCourriel(bureau, marque);
    const moi = bureau.comptes.proprioA.email;
    const depuis = new Date().toISOString();
    await ouvrirEditeur(page, marque);
    const texteUnique = `Essai ${marque} non enregistré`;
    await blocs(page).nth(2).fill(texteUnique);
    await objet(page).fill(`Objet d’essai ${marque}`);
    await ongletApercu(page).click();
    await expect(cadre(page).getByText(texteUnique, { exact: true })).toBeVisible();
    let lacher: () => void = () => undefined;
    const retenue = new Promise<void>((res) => { lacher = res; });
    await page.route('**/api/emails/apercu', async (route) => {
      if (route.request().postDataJSON()?.envoyer === true) await retenue;
      await route.fallback();
    });
    const essai = editeur(page).getByRole('button', { name: 'M’envoyer un essai' });
    await essai.click();
    const enCours = editeur(page).getByRole('button', { name: 'Envoi…' });
    await expect(enCours).toBeDisabled();
    lacher();
    await expect(page.getByText(`Essai envoyé à ${moi}`)).toBeVisible({ timeout: 60_000 });
    await expect(essai).toBeEnabled();
    // Ce qui est consigné : UNE ligne dans `envois_simules`, à mon adresse, rien d'autre.
    const lire = async () => (await bureau.admin.from('envois_simules').select('org_id, canal, destinataire, sujet, corps, meta')
      .eq('destinataire', moi).gte('created_at', depuis).like('sujet', `%${marque}%`)).data ?? [];
    await expect.poll(async () => (await lire()).length).toBe(1);
    const [envoi] = await lire();
    expect(envoi.canal).toBe('courriel');
    expect(envoi.sujet).toBe(`[Essai] Objet d’essai ${marque}`);
    expect(String(envoi.corps)).toContain(texteUnique);
    test.info().annotations.push({ type: 'bac à sable', description: `org_id=${envoi.org_id} ; raison=${(envoi.meta as { raison?: string }).raison}` });
    // L'essai n'enregistre rien : la règle est intacte.
    expect(await courrielEnBase(bureau, r.id)).toEqual({ subject: OBJET, body: CORPS });
  });

  test('[MSG-018] l’essai d’un bureau en bac à sable est retenu parce que le BUREAU y est inscrit, pas seulement parce que l’adresse est fictive', async ({ page, bureau, marque, moniteur }) => {
    moniteur.attendu(ARTEFACT_IFRAME, 'artefact du traceur Playwright dans l’iframe sandbox');
    await regleCourriel(bureau, marque);
    const moi = bureau.comptes.proprioA.email;
    const depuis = new Date().toISOString();
    await ouvrirEditeur(page, marque);
    await objet(page).fill(`Filet ${marque}`);
    await ongletApercu(page).click();
    await expect(cadre(page).locator('body')).toBeVisible();
    await editeur(page).getByRole('button', { name: 'M’envoyer un essai' }).click();
    await expect(page.getByText(`Essai envoyé à ${moi}`)).toBeVisible({ timeout: 60_000 });
    const lire = async () => (await bureau.admin.from('envois_simules').select('org_id, meta')
      .eq('destinataire', moi).gte('created_at', depuis).like('sujet', `%Filet ${marque}%`)).data ?? [];
    await expect.poll(async () => (await lire()).length).toBe(1);
    const [envoi] = await lire();
    // Premier filet (server/lib/bac-a-sable.ts) : l'entreprise. Sans lui, un compte de test à l'adresse réelle recevrait un vrai courriel.
    expect.soft((envoi.meta as { raison?: string }).raison).toBe('entreprise');
    expect(envoi.org_id).toBe(bureau.orgA);
  });

  test('[MSG-018] échec de l’essai : l’écran dit pourquoi (pas seulement « Envoi impossible ») @defaut', async ({ page, bureau, marque, moniteur }) => {
    moniteur.attendu(ARTEFACT_IFRAME, 'artefact du traceur Playwright dans l’iframe sandbox');
    moniteur.attendu(/502 POST .*\/api\/emails\/apercu/, 'échec du fournisseur simulé par page.route');
    moniteur.attendu(/\[emailTemplates\] envoi d’essai impossible/, 'le client journalise l’échec');
    await regleCourriel(bureau, marque);
    await ouvrirEditeur(page, marque);
    await ongletApercu(page).click();
    await expect(cadre(page).locator('body')).toBeVisible();
    await page.route('**/api/emails/apercu', (route) => (route.request().postDataJSON()?.envoyer === true
      ? route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Aucun service de courriel n’est configuré pour votre entreprise.' }) })
      : route.fallback()));
    await editeur(page).getByRole('button', { name: 'M’envoyer un essai' }).click();
    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/msg-018-echec-sans-raison.png` });
    // L'échec est bien annoncé (jamais « Essai envoyé »)…
    await expect(page.getByText(/Essai envoyé/)).toHaveCount(0);
    // … mais la raison donnée par le serveur doit être montrée.
    await expect(toast).toContainText('Aucun service de courriel n’est configuré');
  });
});

test.describe('courriel — plusieurs courriels, langue des messages', () => {
  test('[MSG-036] modifier un courriel ne touche pas à l’autre courriel de la même automatisation @defaut', async ({ page, bureau, marque }) => {
    const c2 = { subject: 'Second objet', body: `${ENVELOPPE}<h2 style="color:#1a1a1a;font-size:18px;">Second courriel</h2>${P('Texte du second.')}</div>` };
    const r = await creerRegle(bureau, bureau.orgA, {
      name: `${marque} courriel`,
      actions: [{ type: 'send_email', config: { subject: OBJET, body: CORPS } }, { type: 'send_email', config: c2 }],
    });
    await ouvrirListe(page);
    await deplierMessages(page, marque);
    await expect(page.getByRole('button', { name: 'Modifier', exact: true })).toHaveCount(2);
    await page.getByRole('button', { name: 'Modifier', exact: true }).first().click();
    await objet(page).fill('Premier objet corrigé');
    await enregistrer(page).click();
    await expect(page.getByText('Courriel enregistré')).toBeVisible();
    await expect.poll(async () => String((await lireRegle(bureau, r.id))?.actions?.[0].config.subject)).toBe('Premier objet corrigé');
    await page.screenshot({ path: `${CAPTURES}/msg-036-deux-courriels-ecrases.png`, fullPage: true });
    expect((await lireRegle(bureau, r.id))?.actions?.[1].config).toEqual(c2);
  });

  test('[MSG-019][MSG-036] bureau qui écrit en ANGLAIS à ses clients : l’éditeur montre et modifie le courriel qui part (l’anglais) @defaut', async ({ page, bureau, marque }) => {
    const r = await regleCourriel(bureau, marque, {
      subject: 'Votre rendez-vous', subject_en: 'Your appointment',
      body: `${ENVELOPPE}<h2 style="color:#1a1a1a;font-size:18px;">Bonjour,</h2>${P('À demain.')}</div>`,
      body_en: `${ENVELOPPE}<h2 style="color:#1a1a1a;font-size:18px;">Hello,</h2>${P('See you tomorrow.')}</div>`,
    });
    try {
      await bureau.admin.from('company_settings').update({ default_language: 'en' }).eq('org_id', bureau.orgA);
      await ouvrirEditeur(page, marque);
      await page.screenshot({ path: `${CAPTURES}/msg-019-bureau-anglais-courriel-francais.png` });
      // Le moteur envoie `subject_en` / `body_en` quand la langue du bureau est l'anglais.
      await expect.soft(objet(page)).toHaveValue('Your appointment');
      await objet(page).fill('Your appointment tomorrow');
      await enregistrer(page).click();
      await expect(page.getByText('Courriel enregistré')).toBeVisible();
      await expect.poll(async () => String((await lireRegle(bureau, r.id))?.actions?.[0].config.subject_en)).toBe('Your appointment tomorrow');
    } finally {
      await bureau.admin.from('company_settings').update({ default_language: 'fr' }).eq('org_id', bureau.orgA);
    }
  });
});

test.describe('courriel — anglais', () => {
  test.use({ langue: 'en' });

  test('[MSG-012][MSG-013][MSG-016][MSG-017][MSG-018][MSG-019][MSG-020][MSG-023][MSG-024][MSG-025][MSG-035][MSG-036][MSG-037] tous les libellés de l’éditeur sont en anglais', async ({ page, bureau, marque, moniteur }) => {
    moniteur.attendu(ARTEFACT_IFRAME, 'artefact du traceur Playwright dans l’iframe sandbox');
    await regleCourriel(bureau, marque);
    await page.goto('/automations');
    await expect(page.getByRole('heading', { name: 'Workflows list' })).toBeVisible({ timeout: 90_000 });
    await deplierMessages(page, marque);
    await expect(page.getByText('Email sent to client', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(editeur(page).getByText('Click the text to edit it')).toBeVisible();
    await expect(objet(page)).toHaveAttribute('placeholder', 'Email subject');
    await expect(editeur(page).getByText('Subject', { exact: true })).toBeVisible();
    await expect(blocs(page).nth(0)).toHaveAttribute('aria-label', 'Title');
    await expect(blocs(page).nth(1)).toHaveAttribute('aria-label', 'Paragraph');
    await expect(blocs(page).nth(3)).toHaveAttribute('aria-label', 'Bullet');
    await expect(editeur(page).getByRole('button', { name: 'Paragraph', exact: true })).toBeVisible();
    await expect(editeur(page).getByRole('button', { name: 'Bullet', exact: true })).toBeVisible();
    await expect(editeur(page).getByText('Insert:')).toBeVisible();
    await expect(editeur(page).getByRole('button', { name: 'Client first name', exact: true })).toBeVisible();
    await expect(editeur(page).getByText('No changes')).toBeVisible();
    await expect(editeur(page).getByText('Header and footer come from your company settings.', { exact: false })).toBeVisible();
    await expect(editeur(page).getByText('Sent with')).toBeVisible();
    await blocs(page).nth(1).fill('Hello [client_first_nam],');
    await expect(editeur(page).getByText('This variable doesn’t exist:')).toBeVisible();
    await expect(editeur(page).getByText('Unsaved changes')).toBeVisible();
    await ongletApercu(page).click();
    await expect(cadre(page).locator('body')).toBeVisible();
    await expect(editeur(page).getByRole('button', { name: 'Send me a test' })).toBeVisible();
    await expect(editeur(page).getByText(/Rendered by the server/)).toBeVisible();
    await ongletModifier(page).click();
    await croix(page).click();
    await expect(page.getByText('Your changes are not saved. Close anyway?')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(editeur(page)).toBeHidden();
  });

  test('[MSG-036] (anglais) un refus d’accès à l’enregistrement est dit en anglais @defaut', async ({ page, bureau, marque }) => {
    // 0 ligne modifiée = la RLS a filtré : `updateRuleMessage` lève un message écrit en français seulement.
    await regleCourriel(bureau, marque);
    await page.goto('/automations');
    await expect(page.getByRole('heading', { name: 'Workflows list' })).toBeVisible({ timeout: 90_000 });
    await deplierMessages(page, marque);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.route('**/rest/v1/automation_rules**', (route) => (route.request().method() === 'PATCH'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      : route.fallback()));
    await objet(page).fill('New subject');
    await enregistrer(page).click();
    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/msg-036-refus-en-francais.png` });
    await expect(toast).not.toContainText('Modification refusée');
  });
});
