/**
 * Page Automatisations — « Partir d'un modèle », publication depuis la
 * liste, interface en anglais et langue des messages, version téléphone, et
 * l'écart UI ↔ moteur de `updateRuleMessage` (inv-3 §2.4 n° 7) prouvé à
 * l'écran depuis Réglages › Messagerie.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import {
  admin, attendreToast, avecCapture, confirmerDialogue, creerRegle, fermerNavigateur, lireRegle, marqueUi,
  nettoyer, ouvrirOnglet, voir, type Onglet,
} from '../harnais/navigateur';

const ORG = () => inject('uiOrgA');
const MARQUE = marqueUi('modeles');
const UUID = /\/automations\/([0-9a-f-]{36})/;

let o: Onglet;
const creeesParModele: string[] = [];
beforeAll(async () => { o = await ouvrirOnglet(); });
afterEach(async () => { await o?.page.unrouteAll({ behavior: 'ignoreErrors' }); });
afterAll(async () => {
  await o?.fermer();
  await fermerNavigateur();
  await nettoyer(ORG(), MARQUE);
  if (creeesParModele.length) {
    const maintenant = new Date().toISOString();
    await admin.from('automation_rules').update({ is_active: false, deleted_at: maintenant, purged_at: maintenant }).in('id', creeesParModele);
  }
  // La langue des messages du bureau revient au français, quoi qu'il arrive.
  await admin.from('company_settings').update({ default_language: 'fr' }).eq('org_id', ORG());
});

const ligne = (nom: string) => o.page.locator('tbody tr').filter({ hasText: nom }).first();
async function ouvrirListe(): Promise<void> {
  await o.page.goto(`${o.base}/automations`);
  await o.page.getByRole('heading', { name: 'Mes automatisations' }).waitFor({ timeout: 60_000 });
  await o.page.locator('table').waitFor({ timeout: 30_000 });
}
const nbCartes = () => o.page.locator('div.relative.w-\\[260px\\] > button:first-child').count();

describe('Partir d’un modèle', () => {
  it('[J-023] « Utiliser ce modèle » crée une copie EN BROUILLON dont l’écran montre exactement le parcours en base', async () => {
    await avecCapture(o, 'J-023', async () => {
      await ouvrirListe();
      await o.page.getByRole('button', { name: 'Créer', exact: false }).first().click();
      await o.page.getByRole('menuitem', { name: /Partir d’un modèle/ }).click();
      const modal = o.page.getByRole('dialog', { name: 'Bibliothèque de modèles' });
      await modal.waitFor();
      // Le premier modèle de la grille, quel qu'il soit : le test ne dépend pas du catalogue.
      const premier = modal.locator('button').filter({ has: o.page.locator('h3, h4, p') }).filter({ hasNotText: /Tous les modèles|Catégories|Afficher|Réinitialiser|Filtres/ }).first();
      await voir(premier, 30_000).visible();
      await premier.click();
      await modal.getByRole('button', { name: 'Utiliser ce modèle' }).click();
      await attendreToast(o.page, 'créée en brouillon');
      await o.page.waitForURL(UUID, { timeout: 30_000 });
      const id = o.page.url().match(UUID)![1];
      creeesParModele.push(id);
      await o.page.getByRole('tab', { name: 'Parcours' }).waitFor({ timeout: 60_000 });

      const r = await lireRegle(id);
      expect(r.org_id).toBe(ORG());
      expect(r.is_active).toBe(false);
      expect(r.is_preset).toBe(false);
      expect(r.deleted_at).toBeNull();
      const steps = r.steps ?? [];
      expect(steps.length).toBeGreaterThan(0);
      // Chaque étape en base a sa carte, et rien de plus.
      await expect.poll(nbCartes).toBe(steps.length);
      await voir(o.page.getByRole('switch', { name: 'Publier l’automatisation' })).attribut('aria-checked', 'false');
      await voir(o.page.locator('header').getByRole('button', { name: r.name })).visible();
    });
  });
});

describe('Publier / dépublier depuis la liste', () => {
  it('[J-024] l’interrupteur de la ligne publie (après confirmation) puis dépublie : la base suit l’écran', async () => {
    await avecCapture(o, 'J-024', async () => {
      const r = await creerRegle(ORG(), {
        name: `${MARQUE} bascule`, trigger_event: 'invoice.sent',
        actions: [{ type: 'create_notification', config: { title: 'Facture partie' } }],
        steps: [{ id: 'e1', type: 'action', action: { type: 'create_notification', config: { title: 'Facture partie' } }, suivant: null }],
      });
      await ouvrirListe();
      const inter = ligne(r.name).getByRole('switch');
      await voir(inter).attribut('aria-checked', 'false');
      await inter.click();
      // Une confirmation peut être demandée (message au client, cas limites) : on l'accepte si elle vient.
      const dialogue = o.page.getByRole('dialog');
      if (await dialogue.isVisible().catch(() => false)) await confirmerDialogue(o.page, /Publier|Activer/);
      await expect.poll(async () => (await lireRegle(r.id)).is_active).toBe(true);
      await voir(inter).attribut('aria-checked', 'true');
      await voir(ligne(r.name)).contient('Publiée');

      await inter.click();
      await expect.poll(async () => (await lireRegle(r.id)).is_active).toBe(false);
      await voir(inter).attribut('aria-checked', 'false');
      await voir(ligne(r.name)).contient('Brouillon');
    });
  });
});

describe('Langue', () => {
  it('[J-025] interface en anglais : l’éditeur montre la même règle, une étape ajoutée prend le texte anglais par défaut', async () => {
    const en = await ouvrirOnglet({ langue: 'en' });
    try {
      await avecCapture(en, 'J-025', async () => {
        const r = await creerRegle(ORG(), {
          name: `${MARQUE} anglais`, trigger_event: 'invoice.sent',
          actions: [{ type: 'send_sms', config: { body: 'Bonjour [client_name] — texte FR' } }],
          steps: [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_name] — texte FR' } }, suivant: null }],
        });
        await en.page.goto(`${en.base}/automations/${r.id}`);
        await en.page.getByRole('tab', { name: 'Builder' }).waitFor({ timeout: 60_000 });
        await voir(en.page.getByText('Send a text message').first()).visible();
        await voir(en.page.getByText('Bonjour [client_name] — texte FR').first()).visible();
        await voir(en.page.getByText('Draft', { exact: true })).visible();

        await en.page.getByRole('button', { name: 'Add', exact: true }).click();
        const t = en.page.getByRole('complementary', { name: 'Actions' });
        await t.getByRole('searchbox').fill('Notify the team');
        await t.getByRole('button', { name: /^Notify the team/ }).click();
        const p = en.page.getByRole('complementary', { name: 'Edit step' });
        await voir(p.getByLabel(/^Title/)).valeur('Follow up on [client_name]');
        await p.getByRole('button', { name: 'Save action' }).click();
        await expect.poll(async () => JSON.stringify((await lireRegle(r.id)).steps), { timeout: 30_000 }).toContain('Follow up on [client_name]');
        const steps = (await lireRegle(r.id)).steps ?? [];
        expect(steps).toHaveLength(2);
        expect(steps[0]).toMatchObject({ id: 'e1', suivant: steps[1].id });
        expect(steps[1]).toMatchObject({ type: 'action', action: { type: 'create_notification', config: { title: 'Follow up on [client_name]' } }, suivant: null });
      });
    } finally {
      await en.fermer();
    }
  });

  it('[J-026] « Messages en FR / EN » écrit la langue d’envoi du bureau (company_settings.default_language)', async () => {
    await avecCapture(o, 'J-026', async () => {
      await ouvrirListe();
      await o.page.getByRole('button', { name: 'EN', exact: true }).click();
      await expect.poll(async () => (await admin.from('company_settings').select('default_language').eq('org_id', ORG()).single()).data?.default_language).toBe('en');
      await o.page.reload();
      await o.page.getByRole('heading', { name: 'Mes automatisations' }).waitFor({ timeout: 60_000 });
      // Relu après rechargement : « EN » est le bouton actif.
      await expect.poll(async () => (await o.page.getByRole('button', { name: 'EN', exact: true }).getAttribute('class')) ?? '').toContain('bg-text-primary');
      await o.page.getByRole('button', { name: 'FR', exact: true }).click();
      await expect.poll(async () => (await admin.from('company_settings').select('default_language').eq('org_id', ORG()).single()).data?.default_language).toBe('fr');
    });
  });
});

describe('Téléphone (390 × 844)', () => {
  it('[J-027] un vrai téléphone voit la porte « application » (la page n’est pas servie : décision mobileGate)', async () => {
    const tel = await ouvrirOnglet({
      viewport: { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    });
    try {
      await avecCapture(tel, 'J-027', async () => {
        await tel.page.goto(`${tel.base}/automations`);
        await voir(tel.page.getByRole('heading', { name: /Le bureau sur l'ordi/ }), 60_000).visible();
        await voir(tel.page.getByRole('heading', { name: 'Mes automatisations' })).absent();
      });
    } finally {
      await tel.fermer();
    }
  });

  it('[J-028] fenêtre étroite (390 px) sur ordinateur : la liste reste utilisable, sans défilement horizontal de la page', async () => {
    const etroit = await ouvrirOnglet({ viewport: { width: 390, height: 844 } });
    try {
      await avecCapture(etroit, 'J-028', async () => {
        const r = await creerRegle(ORG(), { name: `${MARQUE} étroit`, trigger_event: 'invoice.sent' });
        await etroit.page.goto(`${etroit.base}/automations`);
        await etroit.page.getByRole('heading', { name: 'Mes automatisations' }).waitFor({ timeout: 60_000 });
        await etroit.page.locator('table').waitFor({ timeout: 30_000 });
        const largeur = await etroit.page.evaluate(() => document.documentElement.scrollWidth);
        expect(largeur).toBeLessThanOrEqual(391);
        // Le bouton « Créer » est atteignable et ouvre son menu (vrai clic).
        await etroit.page.getByRole('button', { name: 'Créer', exact: false }).first().click();
        await voir(etroit.page.getByRole('menuitem', { name: /Partir de zéro/ })).visible();
        await etroit.page.getByRole('menuitem', { name: /Partir de zéro/ }).click();
        await etroit.page.waitForURL(/\/automations\/nouvelle/, { timeout: 30_000 });
        await etroit.page.goto(`${etroit.base}/automations`);
        await etroit.page.locator('table').waitFor({ timeout: 60_000 });
        // La ligne ouvre l'éditeur.
        await etroit.page.locator('tbody tr').filter({ hasText: r.name }).first().getByRole('button', { name: new RegExp(`^${r.name.replace(/[[\]]/g, '\\$&')}`) }).click();
        await etroit.page.waitForURL(new RegExp(r.id), { timeout: 30_000 });
      });
    } finally {
      await etroit.fermer();
    }
  });
});

describe('Écart UI ↔ moteur : texte d’un texto modifié depuis Réglages › Messagerie', () => {
  it('[J-060] sur une règle À ÉTAPES, l’écran montre le texte que le moteur enverra et l’enregistrement l’écrit dans steps', async () => {
    await avecCapture(o, 'J-060', async () => {
      const r = await creerRegle(ORG(), {
        name: `${MARQUE} messagerie`, trigger_event: 'quote.sent', is_active: false,
        actions: [{ type: 'send_sms', config: { body: 'ANCIEN texte (actions)' } }],
        steps: [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Texte des étapes (envoyé)' } }, suivant: null }],
      });
      await o.page.goto(`${o.base}/settings/messaging`);
      const bouton = o.page.getByRole('button', { name: new RegExp(r.name.replace(/[[\]]/g, '\\$&')) });
      await voir(bouton, 60_000).visible();
      // Ce qui est affiché = ce que le moteur (qui suit `steps`) enverra.
      await voir(bouton).contient('Texte des étapes (envoyé)');
      await bouton.click();
      const zone = o.page.getByRole('textbox', { name: `Texte du SMS — ${r.name}` });
      await voir(zone).valeur('Texte des étapes (envoyé)');
      await zone.fill('Nouveau texte QA [client_name]');
      await o.page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await expect.poll(async () => (await lireRegle(r.id)).steps?.[0]).toMatchObject({ action: { config: { body: 'Nouveau texte QA [client_name]' } } });
      const lu = await lireRegle(r.id);
      expect(lu.actions[0].config.body).toBe('Nouveau texte QA [client_name]');
      await voir(bouton).contient('Nouveau texte QA [client_name]');
      await o.page.reload();
      await voir(o.page.getByRole('button', { name: new RegExp(r.name.replace(/[[\]]/g, '\\$&')) }), 60_000).contient('Nouveau texte QA [client_name]');
    });
  });
});
