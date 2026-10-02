/**
 * Agent S — `06-reglages-globaux:116` : le sélecteur « FR / EN » de la liste RESTE (décision). La ligne ne se ferme
 * que si la liste et la carte « Langue des messages » des Réglages globaux se SUIVENT à l'écran, dans les deux sens,
 * sans recharger la page.
 *
 *   QA_AUTO_SUFFIXE=d QA_UI_PORT_API=3494 QA_UI_PORT_VITE=5494 \
 *     npx vitest run --maxWorkers=2 --config tests/automations-finale/d/vitest.config.ts --project ui \
 *     tests/automations-finale/d/ui/61-langue-liste-et-reglages.preuve.ts
 */
import { describe, it, expect, afterAll, afterEach, inject } from 'vitest';
import { ouvrirOnglet, fermerNavigateur, admin, type Onglet } from '../../../automations-suite/harnais/navigateur';
import { NOM_ORG_A } from '../../../automations-suite/harnais/bureau-test';

const org = () => inject('uiOrgA');
const langueEnBase = async () => (await admin.from('company_settings').select('default_language').eq('org_id', org()).single()).data?.default_language;

/** Rien de ce que ces preuves changent ne survit : la langue, et le NOM du bureau (Paramètres › Entreprise le réécrit). */
async function remettre(): Promise<void> {
  await admin.from('company_settings').update({ default_language: 'fr' }).eq('org_id', org());
  await admin.from('orgs').update({ name: NOM_ORG_A }).eq('id', org()).neq('name', NOM_ORG_A);
}
afterEach(remettre);
afterAll(async () => { await remettre(); await fermerNavigateur(); });

const selecteur = (o: Onglet, l: 'FR' | 'EN') => o.page.getByRole('group', { name: 'Langue des messages' }).getByRole('button', { name: l, exact: true });
const carte = (o: Onglet) => o.page.getByTestId('langue-des-messages');
async function ouvrirListe(o: Onglet): Promise<void> {
  await o.page.goto(`${o.base}/automations`);
  await expect.poll(() => selecteur(o, 'FR').getAttribute('aria-pressed'), { timeout: 30_000 }).toBe('true');
}
const versReglages = (o: Onglet) => o.page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Réglages globaux', exact: true }).click();
const versListe = (o: Onglet) => o.page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Automatisations', exact: true }).click();

describe('S — la langue des messages : la liste et la carte des Réglages globaux se suivent, sans recharger', () => {
  it('[06-reglages-globaux:116 a] changée par le sélecteur de la LISTE, elle se lit dans la carte', async () => {
    await remettre();
    const o = await ouvrirOnglet({ langue: 'fr' });
    try {
      await ouvrirListe(o);
      await selecteur(o, 'EN').click();
      await expect.poll(langueEnBase).toBe('en');
      await versReglages(o);
      await expect.poll(async () => (await carte(o).innerText()).trim(), { timeout: 20_000 }).toBe('English');
      // Et retour : la liste dit toujours EN, sans rechargement.
      await versListe(o);
      await expect.poll(() => selecteur(o, 'EN').getAttribute('aria-pressed')).toBe('true');
    } finally { await o.fermer(); }
  });

  it('[06-reglages-globaux:116 b] changée par le chemin de la CARTE (« Changer dans les réglages »), elle se lit dans le sélecteur de la liste', async () => {
    await remettre();
    await admin.from('company_settings').update({ default_language: 'en' }).eq('org_id', org());
    const o = await ouvrirOnglet({ langue: 'fr' });
    try {
      await o.page.goto(`${o.base}/automations`);
      await expect.poll(() => selecteur(o, 'EN').getAttribute('aria-pressed'), { timeout: 30_000 }).toBe('true');
      await versReglages(o);
      await expect.poll(async () => (await carte(o).innerText()).trim(), { timeout: 20_000 }).toBe('English');
      await o.page.getByRole('button', { name: 'Changer dans les réglages' }).click();
      await o.page.waitForURL(/\/settings\/company$/);
      await o.page.getByRole('button', { name: 'Français', exact: true }).click();
      await o.page.getByRole('button', { name: /^(Enregistrer|Save)/ }).first().click();
      await expect.poll(langueEnBase, { timeout: 20_000 }).toBe('fr');
      // Retour par l'HISTORIQUE de l'application (pas de rechargement) : la carte, puis la liste.
      await o.page.goBack();
      await expect.poll(async () => (await carte(o).innerText()).trim(), { timeout: 20_000 }).toBe('Français');
      await versListe(o);
      await expect.poll(() => selecteur(o, 'FR').getAttribute('aria-pressed')).toBe('true');
      await expect.poll(() => selecteur(o, 'EN').getAttribute('aria-pressed')).toBe('false');
    } finally { await o.fermer(); }
  });

  it('[06-reglages-globaux:116 c] écriture LENTE : cliquer « EN » puis ouvrir aussitôt les Réglages globaux — la carte dit quand même « English »', async () => {
    await remettre();
    const o = await ouvrirOnglet({ langue: 'fr' });
    try {
      await ouvrirListe(o);
      // L'écriture de la langue est retenue 2 s : la carte est ouverte AVANT qu'elle n'arrive en base.
      await o.page.route('**/rest/v1/company_settings*', async (r) => {
        if (r.request().method() === 'PATCH') await new Promise((ok) => setTimeout(ok, 2000));
        await r.continue();
      });
      await selecteur(o, 'EN').click();
      await versReglages(o);
      await expect.poll(async () => (await carte(o).innerText().catch(() => '')).trim(), { timeout: 20_000 }).toBe('English');
      await expect.poll(langueEnBase).toBe('en');
    } finally { await o.fermer(); }
  });
});
