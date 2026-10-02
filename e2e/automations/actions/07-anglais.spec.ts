/**
 * Le catalogue des actions en ANGLAIS (interface « en ») : tiroir, carte du
 * canevas, panneau, champs, options, textes proposés, messages.
 *
 * Ce que le fichier prouve, pour chaque action : son nom est le même dans le
 * tiroir, dans le titre du panneau, dans « What to do » et sur la carte ;
 * chaque champ porte son libellé anglais ; aucun mot français ne traîne ;
 * aucune clé technique (`send_sms`, `quote.sent`…) n'est montrée.
 */
import { test, expect } from './_aides';
import {
  CAPTURES, donnees, creerBrouillon, creerBrouillonAvecAction, ouvrirEditeur, ouvrirTiroir, tiroirActions, itemTiroir, panneauEtape,
  champ, boutonEnregistrer, finStable, quitterSansEnregistrer, carte, optionChoisie, etapesEnBase, configDe,
} from './_aides';
import { ACTIONS_ATTENDUES, ACTIONS_DISPONIBLES, OPTIONS_ATTENDUES, idsDe } from './_catalogue';
import type { Locator } from '@playwright/test';

test.use({ langue: 'en' });

/** Le texte d'interface d'un bloc : sans les menus ni les boutons de champs personnalisés (ce sont des données du bureau). */
async function texteInterface(racine: Locator): Promise<string> {
  return racine.evaluate((el) => {
    const morceaux: string[] = [];
    const marcheur = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = marcheur.nextNode(); n; n = marcheur.nextNode()) {
      const parent = n.parentElement;
      if (!parent) continue;
      if (parent.closest('select')) continue;
      const bouton = parent.closest('button[title^="{{"]');
      if (bouton && !bouton.closest('details')) continue;
      const t = (n.textContent ?? '').trim();
      if (t) morceaux.push(t);
    }
    // Les indications et infobulles comptent aussi.
    el.querySelectorAll('[placeholder], [aria-label]').forEach((x) => {
      morceaux.push(x.getAttribute('placeholder') ?? '', x.getAttribute('aria-label') ?? '');
    });
    return morceaux.filter(Boolean).join('\n');
  });
}

const MOTS_FRANCAIS = /(^|[^\p{L}])(le|la|les|un|une|des|du|et|ou|pour|avec|dans|sur|vide|aucun|aucune|choisir|inchangé|facultatif|obligatoire|étiquette|courriel|texto|devis|facture|tâche|personne|bientôt|enregistrer|annuler|supprimer|fermer|ajouter)([^\p{L}]|$)/iu;
const ACCENTS = /[àâäçéèêëîïôöûùüœ«»]/i;

/** Les lignes d'un texte d'interface qui portent du français. */
function francais(texte: string): string[] {
  return texte.split('\n').filter((l) => ACCENTS.test(l) || MOTS_FRANCAIS.test(l));
}

/** Les clés techniques visibles (hors variables entre crochets ou accolades, qui s'écrivent ainsi). */
function clesTechniques(texte: string): string[] {
  const nu = texte.replace(/\[[A-Za-z_]+\]/g, '').replace(/\{\{[^}]+\}\}/g, '');
  const snake = nu.match(/\b[a-z]+(?:_[a-z0-9]+)+\b/g) ?? [];
  const pointees = nu.match(/\b(?:quote|invoice|lead|client|job|deal|appointment|payment|task|note|webhook|date|agreement|custom_field)\.[a-z_]+\b/g) ?? [];
  return [...snake, ...pointees];
}

test.describe('anglais — le tiroir Actions', () => {
  test('[EDT-056][EDT-057][EDT-059][EDT-060][EDT-061][EDT-062][EDT-063] tout le tiroir est en anglais : familles, titres, aides, raisons', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillon(bureau, marque, 'lead.created');
    await ouvrirEditeur(page, regle.id);
    const t = await ouvrirTiroir(page, true);
    await expect(t.getByRole('heading', { name: 'Actions', level: 2 })).toBeVisible();
    await expect(t.getByText('What the automation will do')).toBeVisible();
    await expect(t.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
    await expect(t.getByRole('searchbox', { name: 'Search Actions' })).toHaveAttribute('placeholder', 'Search…');
    expect(await t.getByRole('heading', { level: 3 }).allInnerTexts()).toEqual(['COMMUNICATION', 'CLIENT', 'WORK', 'SALES', 'MONEY', 'TECHNICAL', 'JOURNEY']);

    for (const a of ACTIONS_ATTENDUES) {
      const item = itemTiroir(page, a.en);
      await expect(item, `« ${a.en} » dans le tiroir`).toBeVisible();
      if (a.indisponible) {
        await expect(item).toBeDisabled();
        await expect(item).toContainText(a.indisponible.en);
      } else if (await item.isEnabled()) {
        await expect(item).toContainText(a.aide_en);
      } else {
        await expect(item).toContainText('Does not work with this trigger');
      }
    }
    await expect(itemTiroir(page, 'Wait')).toContainText('Pauses before the next step.');
    await expect(itemTiroir(page, 'Condition')).toContainText('Splits the journey in two.');
    await expect(itemTiroir(page, 'Stop here')).toContainText('The client leaves the journey.');

    const texte = await texteInterface(tiroirActions(page));
    await page.screenshot({ path: `${CAPTURES}/en-tiroir.png`, fullPage: true });
    expect(francais(texte), 'français dans le tiroir').toEqual([]);
    expect(clesTechniques(texte), 'clés techniques dans le tiroir').toEqual([]);

    await t.getByRole('searchbox', { name: 'Search Actions' }).fill('zzzz');
    await expect(t.getByText('Nothing matches that search.')).toBeVisible();
  });
});

test.describe('anglais — chaque action', () => {
  for (const a of ACTIONS_DISPONIBLES) {
    test(`${idsDe(a)}[EDT-059][EDT-104][EDT-108][EDT-037] “${a.en}” : même nom dans le tiroir, le panneau, « What to do » et la carte ; champs, options et textes proposés en anglais ; ni français ni clé technique`, async ({ page, bureau, marque }) => {
      const d = await donnees(bureau);
      const regle = await creerBrouillon(bureau, marque, a.declencheur);
      await ouvrirEditeur(page, regle.id);
      await ouvrirTiroir(page, true);
      const item = itemTiroir(page, a.en);
      await expect(item).toBeEnabled();
      await expect(item).toContainText(a.aide_en);
      await item.click();

      const p = panneauEtape(page);
      await expect(p.getByRole('heading', { level: 2 })).toHaveText(a.en);
      await expect(p.getByText(a.aide_en, { exact: true })).toBeVisible();
      expect(await optionChoisie(p.getByLabel('What to do *', { exact: true }))).toBe(a.en);
      await expect(p.getByLabel('Action name (optional)', { exact: true })).toHaveAttribute('placeholder', a.en);
      await expect(carte(page, a.en)).toBeVisible();

      // Chaque champ : libellé anglais, options anglaises, texte proposé anglais.
      for (const c of a.champs) {
        const el = c.type === 'bascule' ? p.getByLabel(c.en, { exact: true }) : champ(p, c.en, c.obligatoire, true);
        // Un champ dépendant apparaît une fois son parent réglé.
        if (c.id === 'CHA-12') await champ(p, 'For whom', false, true).selectOption({ label: 'A specific member' });
        if (c.id === 'CHA-25') await champ(p, 'Field', true, true).selectOption({ label: d.champs.qa_type_client.label });
        await expect(el, `champ “${c.en}” (${c.id})`).toBeVisible();
        const att = OPTIONS_ATTENDUES[c.id];
        if (att) {
          const options = await el.locator('option').evaluateAll((os) => os.map((o) => ({ valeur: (o as HTMLOptionElement).value, texte: (o.textContent ?? '').trim() })));
          expect(options.slice(1), `options de “${c.en}”`).toEqual(att.options.map((o) => ({ valeur: o.cle, texte: o.en })));
          if (att.vide) expect(options[0].texte).toBe(att.vide.en);
          expect(francais(options[0].texte), `option vide de “${c.en}”`).toEqual([]);
        }
        if (c.type === 'membre') expect((await el.locator('option').first().innerText()).trim()).toBe('— Nobody —');
        if (c.type === 'automatisation') expect((await el.locator('option').first().innerText()).trim()).toBe('— Pick one —');
        if (c.type === 'etape_pipeline') expect((await el.locator('option').first().innerText()).trim()).toBe('— Pick a stage —');
        if (c.type === 'champ_perso') expect((await el.locator('option').first().innerText()).trim()).toBe('— Choose a field —');
        if (c.type === 'valeur_champ') expect((await el.locator('option').first().innerText()).trim()).toBe('— Clear the field —');
        if (c.defaut_en) await expect(el, `texte proposé pour “${c.en}”`).toHaveValue(c.defaut_en);
      }

      // Le pied et les onglets.
      await expect(p.getByRole('tab', { name: 'Edit action' })).toBeVisible();
      await expect(p.getByRole('tab', { name: 'Statistics' })).toBeVisible();
      await expect(p.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
      await expect(p.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
      await expect(boutonEnregistrer(p, true)).toBeVisible();

      const texte = await texteInterface(p);
      await page.screenshot({ path: `${CAPTURES}/en-${a.cle}.png` });
      expect(francais(texte), `français dans le panneau de “${a.en}”`).toEqual([]);
      expect(clesTechniques(texte), `clés techniques dans le panneau de “${a.en}”`).toEqual([]);

      // Ce qui a été enregistré à la création est le brouillon anglais, pas le français.
      await finStable(page);
      const attendu: Record<string, string> = {};
      for (const c of a.champs) if (c.defaut_en) attendu[c.cle] = c.defaut_en;
      if (Object.keys(attendu).length === a.champs.filter((c) => c.obligatoire).length) {
        expect(configDe(await etapesEnBase(bureau, regle.id))).toEqual(attendu);
      }
    });
  }
});

test.describe('anglais — messages et variables', () => {
  test('[EDT-109][EDT-110][EDT-111][EDT-112][EDT-113][EDT-114][EDT-115][EDT-116] les boutons de variables sont en anglais et écrivent les mêmes variables', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_sms', { body: '' });
    await ouvrirEditeur(page, regle.id);
    await carte(page, 'Send a text message').click();
    const p = panneauEtape(page);
    await expect(p.getByText('Insert client information', { exact: true })).toBeVisible();
    await expect(p.getByText('Insert a field', { exact: true })).toBeVisible();
    for (const nom of ['Client name', 'Your business name', 'Total', 'Invoice link', 'Quote link', 'Appointment date']) {
      await p.getByRole('button', { name: nom, exact: true }).click();
    }
    await expect(champ(p, 'Message text', true, true)).toHaveValue('[client_name][company_name][invoice_total][invoice_link][quote_link][appointment_date]');
    const bloc = p.locator('details').filter({ hasText: 'Base fields' });
    await bloc.locator('summary').click();
    await expect(bloc.getByRole('button')).toHaveCount(90);
    await expect(bloc.getByRole('button', { name: 'Client · First name', exact: true })).toHaveAttribute('title', '{{client.first_name}}');
    const libelles = (await bloc.getByRole('button').allInnerTexts()).join('\n');
    expect(francais(libelles), 'français dans « Base fields »').toEqual([]);
  });

  test('[EDT-126][EDT-130][EDT-100][EDT-164][EDT-128][EDT-159] les refus et les confirmations du panneau sont en anglais', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_email', { subject: 'Subject', body: 'Body' });
    await ouvrirEditeur(page, regle.id);
    await carte(page, 'Send an email').click();
    const p = panneauEtape(page);
    await champ(p, 'Subject', true, true).fill('');
    await expect(boutonEnregistrer(p, true)).toBeDisabled();
    await expect(p.getByText('“Subject” is empty.')).toHaveCount(2);

    await p.getByRole('button', { name: 'Close panel' }).click();
    const d = page.getByRole('dialog');
    await expect(d.getByRole('heading', { name: 'Close without saving?' })).toBeVisible();
    await expect(d.getByText('This step’s changes are not saved: they will be lost.')).toBeVisible();
    await expect(d.getByRole('button', { name: 'Close without saving', exact: true })).toBeVisible();
    await d.getByRole('button', { name: 'Cancel', exact: true }).click();

    await p.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(d.getByRole('heading', { name: 'Delete this step?' })).toBeVisible();
    await expect(d.getByText('What came after stays in the journey and reconnects on its own.')).toBeVisible();
    await d.getByRole('button', { name: 'Cancel', exact: true }).click();

    await p.getByRole('tab', { name: 'Statistics' }).click();
    await expect(p.getByText('No runs yet. Numbers show up after the first trigger.')).toBeVisible();
  });

  test('[EDT-104][EDT-126][ACT-17][ACT-05] action incompatible ou indisponible : le panneau et le canevas le disent en anglais', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillon(bureau, marque, 'lead.created', {
      steps: [
        { id: 'e1', type: 'action', action: { type: 'envoyer_facture', config: {} }, suivant: 'e2' },
        { id: 'e2', type: 'action', action: { type: 'envoyer_slack', config: { body: 'x' } }, suivant: null },
      ],
    });
    await ouvrirEditeur(page, regle.id);
    await expect(page.getByRole('button', { name: '“Send the invoice” cannot follow this trigger.' })).toBeVisible();
    await expect(page.getByRole('button', { name: '“Send to Slack”: Coming soon: connecting your Slack is not available yet.' })).toBeVisible();
    await carte(page, 'Send the invoice').click();
    await expect(panneauEtape(page).getByText('“Send the invoice” cannot follow this trigger: pick another one.')).toHaveCount(2);
  });

  test('[EDT-101][EDT-130][EDT-118][EDT-119][EDT-120] le panneau d’une attente est en anglais, et ne parle pas d’« action » @defaut', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillon(bureau, marque, 'appointment.created', {
      steps: [
        { id: 'e1', type: 'attendre', delai_secondes: 86400, suivant: 'e2' },
        { id: 'e2', type: 'action', action: { type: 'create_task', config: { title: 'Call [client_name] back' } }, suivant: null },
      ],
    });
    await ouvrirEditeur(page, regle.id);
    await carte(page, 'Wait').click();
    const p = panneauEtape(page);
    await expect(p.getByRole('heading', { level: 2 })).toHaveText('Wait');
    await expect(p.getByLabel('Wait *', { exact: true })).toHaveValue('1');
    expect(await p.getByLabel('Time unit').locator('option').allInnerTexts()).toEqual(['minutes', 'hours', 'days']);
    expect(await p.getByLabel('What we wait for', { exact: true }).locator('option').allInnerTexts())
      .toEqual(['Just this delay', 'The client’s reply (at most this delay)', 'This long BEFORE the appointment']);
    expect(francais(await texteInterface(p)), 'français dans le panneau d’une attente').toEqual([]);
    // Une attente n'est pas une action : ni l'onglet ni le bouton ne devraient le dire.
    await expect.soft(p.getByRole('tab').first()).not.toHaveText('Edit action');
    await expect.soft(p.getByRole('button', { name: 'Save action', exact: true })).toHaveCount(0);
  });

  test('[EDT-085][CHA-38][EDT-130] une adresse refusée par le serveur : le message montré est en anglais @defaut', async ({ page, bureau, marque, moniteur }) => {
    moniteur.attendu(/400 PATCH .*\/api\/automations\/rules\//, 'le serveur refuse une adresse en http://');
    const regle = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'webhook', { url: 'https://crochets.lume-qa.test/avant' });
    await ouvrirEditeur(page, regle.id);
    await carte(page, 'Call a webhook').click();
    const p = panneauEtape(page);
    await champ(p, 'The address', true, true).fill('http://crochets.lume-qa.test/entrant');
    await boutonEnregistrer(p, true).click();
    const toast = page.getByRole('region', { name: /Notifications/ }).getByRole('listitem').first();
    await expect(toast).toBeVisible({ timeout: 120_000 });
    const texte = await toast.innerText();
    await page.screenshot({ path: `${CAPTURES}/en-refus-serveur.png` });
    expect.soft(francais(texte), `français dans le message : ${texte}`).toEqual([]);
    await quitterSansEnregistrer(page);
  });
});
