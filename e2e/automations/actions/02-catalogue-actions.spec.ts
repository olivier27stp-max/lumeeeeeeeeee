/**
 * Le catalogue des actions, une par une (carte de l'éditeur § 3.c : ACT-01 à
 * ACT-21, CHA-01 à CHA-40).
 *
 * Pour CHAQUE action offerte : on l'ajoute par le tiroir sur un déclencheur
 * compatible, on remplit CHACUN de ses champs, on enregistre, on vérifie que
 * `automation_rules.steps` porte exactement ce que l'écran montre, puis on
 * recharge la page et on vérifie que le panneau réaffiche la même
 * configuration, champ par champ (un identifiant enregistré est relu par son
 * nom : membre, automatisation, champ personnalisé, option).
 *
 * Le fichier prouve aussi que le catalogue du produit est bien celui de la
 * carte (une action ou un champ ajouté sans test fait échouer la garde), que
 * les textes proposés à la création sont ceux attendus, et que les menus
 * portent les bonnes options.
 */
import { test, expect } from './_aides';

import { ACTIONS } from '../../../src/lib/automationCatalogue';
import {
  CAPTURES, donnees, creerBrouillon, ouvrirEditeur, ouvrirTiroir, itemTiroir, panneauEtape, champ, boutonEnregistrer,
  attendreEtapes, attendreConfig, attendreEnregistre, finStable, creerBrouillonAvecAction, carte, optionChoisie, type Donnees,
} from './_aides';
import { ACTIONS_ATTENDUES, ACTIONS_DISPONIBLES, OPTIONS_ATTENDUES, idsDe, type ChampAttendu } from './_catalogue';
import type { Locator } from '@playwright/test';

/** Le contrôle d'un champ dans le panneau. */
function controle(p: Locator, c: ChampAttendu): Locator {
  if (c.type === 'bascule') return p.getByLabel(c.fr, { exact: true });
  return champ(p, c.fr, c.obligatoire);
}

async function remplir(p: Locator, c: ChampAttendu, d: Donnees): Promise<void> {
  const s = c.saisie(d);
  if (!s) return;
  const el = controle(p, c);
  await expect(el, `le champ « ${c.fr} » (${c.id}) est visible`).toBeVisible();
  switch (c.type) {
    case 'bascule':
      if (s.valeur === 'true') await el.check(); else await el.uncheck();
      break;
    case 'choix': case 'membre': case 'automatisation': case 'champ_perso': case 'valeur_champ': case 'etape_pipeline':
      await el.selectOption({ label: s.affiche ?? s.valeur });
      break;
    default:
      await el.fill(s.valeur);
  }
}

async function relire(p: Locator, c: ChampAttendu, d: Donnees): Promise<void> {
  const s = c.saisie(d);
  const el = controle(p, c);
  if (!s) return;
  switch (c.type) {
    case 'bascule':
      if (s.valeur === 'true') await expect(el, `« ${c.fr} » relu coché`).toBeChecked();
      else await expect(el).not.toBeChecked();
      break;
    case 'choix': case 'membre': case 'automatisation': case 'champ_perso': case 'valeur_champ': case 'etape_pipeline':
      await expect(el, `« ${c.fr} » porte l’identifiant enregistré`).toHaveValue(s.valeur);
      expect(await optionChoisie(el), `« ${c.fr} » est relu par son nom`).toBe(s.affiche ?? s.valeur);
      break;
    default:
      await expect(el, `« ${c.fr} » relu tel que saisi`).toHaveValue(s.valeur);
  }
}

test.describe('catalogue — garde', () => {
  test('[EDT-059][EDT-108] le catalogue du produit porte exactement les 21 actions et les 40 champs de la carte', async () => {
    const produit = ACTIONS.map((a) => ({
      cle: a.cle, fr: a.fr, en: a.en, aide_fr: a.aide_fr, aide_en: a.aide_en, indisponible: a.indisponible ?? null,
      champs: a.champs.map((c) => ({ cle: c.cle, fr: c.fr, en: c.en, obligatoire: c.obligatoire, max: c.max ?? null, drapeau: c.drapeau ?? null })),
    })).sort((x, y) => x.cle.localeCompare(y.cle));
    const attendu = ACTIONS_ATTENDUES.map((a) => ({
      cle: a.cle, fr: a.fr, en: a.en, aide_fr: a.aide_fr, aide_en: a.aide_en, indisponible: a.indisponible ?? null,
      champs: a.champs.map((c) => ({
        cle: c.cle, fr: c.fr, en: c.en, obligatoire: c.obligatoire,
        // « Mettre à jour un champ » : la carte donne 36 et 5000 pour ses deux champs.
        max: c.max ?? (c.id === 'CHA-24' ? 36 : c.id === 'CHA-25' ? 5000 : null), drapeau: c.drapeau ?? null,
      })),
    })).sort((x, y) => x.cle.localeCompare(y.cle));
    expect(produit).toEqual(attendu);
    expect(ACTIONS_ATTENDUES).toHaveLength(21);
    expect(ACTIONS_ATTENDUES.flatMap((a) => a.champs)).toHaveLength(40);
  });
});

test.describe('catalogue — chaque action, tous ses champs', () => {
  for (const a of ACTIONS_DISPONIBLES) {
    test(`${idsDe(a)}[EDT-059][EDT-108][EDT-130] « ${a.fr} » : ajoutée par le tiroir, tous ses champs remplis, enregistrée telle quelle, relue à l’identique après rechargement`, async ({ page, bureau, marque }) => {
      const d = await donnees(bureau);
      const regle = await creerBrouillon(bureau, marque, a.declencheur);
      await ouvrirEditeur(page, regle.id);

      // Le tiroir : l'action est offerte sur ce déclencheur, avec son aide.
      await ouvrirTiroir(page);
      const item = itemTiroir(page, a.fr);
      await expect(item).toBeEnabled();
      await expect(item).toContainText(a.aide_fr);
      await item.click();

      // Le panneau : même nom que dans le tiroir, même aide, même choix dans « Quoi faire ».
      const p = panneauEtape(page);
      await expect(p.getByRole('heading', { level: 2 })).toHaveText(a.fr);
      await expect(p.getByText(a.aide_fr, { exact: true })).toBeVisible();
      expect(await optionChoisie(p.getByLabel('Quoi faire *', { exact: true }))).toBe(a.fr);

      // Chaque champ du catalogue, dans l'ordre de l'écran.
      for (const c of a.champs) await remplir(p, c, d);
      await page.screenshot({ path: `${CAPTURES}/catalogue-${a.cle}.png` });

      // Enregistrer l'étape : le panneau se ferme, la carte porte le nom de l'action.
      await expect(boutonEnregistrer(p)).toBeEnabled();
      await boutonEnregistrer(p).click();
      await expect(p).toBeHidden();
      await expect(carte(page, a.fr)).toBeVisible();

      // La base porte exactement ce que l'écran a montré — rien de plus, rien de moins.
      const config: Record<string, string> = {};
      for (const c of a.champs) { const s = c.saisie(d); if (s) config[c.cle] = s.valeur; }
      const etapes = await attendreConfig(bureau, regle.id, config);
      expect(etapes).toEqual([{ id: 'e1', type: 'action', action: { type: a.cle, config }, suivant: null }]);
      await attendreEnregistre(page);

      // Recharger : la même configuration revient, champ par champ.
      await page.reload();
      await expect(carte(page, a.fr)).toBeVisible({ timeout: 180_000 });
      await carte(page, a.fr).click();
      const relu = panneauEtape(page);
      await expect(relu.getByRole('heading', { level: 2 })).toHaveText(a.fr);
      expect(await optionChoisie(relu.getByLabel('Quoi faire *', { exact: true }))).toBe(a.fr);
      for (const c of a.champs) await relire(relu, c, d);

      // Ouvrir pour relire n'a rien réécrit.
      expect(await attendreEtapes(bureau, regle.id, (e) => e.length === 1)).toEqual(etapes);
    });
  }
});

test.describe('catalogue — textes proposés à la création', () => {
  for (const a of ACTIONS_DISPONIBLES.filter((x) => x.champs.some((c) => c.defaut_fr))) {
    const avecDefaut = a.champs.filter((c) => c.defaut_fr);
    test(`${avecDefaut.map((c) => `[${c.id}]`).join('')}[${a.id}] « ${a.fr} » naît complète, avec un brouillon de texte en bon français`, async ({ page, bureau, marque }) => {
      const regle = await creerBrouillon(bureau, marque, a.declencheur);
      await ouvrirEditeur(page, regle.id);
      await ouvrirTiroir(page);
      await itemTiroir(page, a.fr).click();
      const p = panneauEtape(page);
      // Une action neuve est enregistrable telle quelle : rien d'obligatoire n'est vide.
      await expect(boutonEnregistrer(p)).toBeEnabled();
      for (const c of avecDefaut) {
        await expect.soft(champ(p, c.fr, c.obligatoire), `texte proposé pour « ${c.fr} »`).toHaveValue(c.defaut_fr ?? '');
      }
      await finStable(page);
    });
  }
});

test.describe('catalogue — options des menus', () => {
  const avecMenus = ACTIONS_DISPONIBLES.filter((a) => a.champs.some((c) => OPTIONS_ATTENDUES[c.id]));
  for (const a of avecMenus) {
    const menus = a.champs.filter((c) => OPTIONS_ATTENDUES[c.id]);
    test(`${menus.map((c) => `[${c.id}]`).join('')}[EDT-076] « ${a.fr} » : chaque menu offre les options de la carte, et son option vide dit ce que « vide » veut dire`, async ({ page, bureau, marque }) => {
      // L'étape existe déjà : on ouvre sa carte, sans rien modifier au parcours.
      const regle = await creerBrouillonAvecAction(bureau, marque, a.declencheur, a.cle, {});
      await ouvrirEditeur(page, regle.id);
      await carte(page, a.fr).click();
      const p = panneauEtape(page);
      const fautes: string[] = [];
      for (const c of menus) {
        const att = OPTIONS_ATTENDUES[c.id];
        const select = champ(p, c.fr, c.obligatoire);
        await expect(select).toBeVisible();
        const options = await select.locator('option').evaluateAll((os) => os.map((o) => ({ valeur: (o as HTMLOptionElement).value, texte: (o.textContent ?? '').trim() })));
        expect(options.slice(1), `options de « ${c.fr} »`).toEqual(att.options.map((o) => ({ valeur: o.cle, texte: o.fr })));
        expect(options[0].valeur).toBe('');
        if (att.vide) expect(options[0].texte).toBe(att.vide.fr);
        if (att.videTrompeur && options[0].texte === '— Inchangé —') {
          fautes.push(`« ${c.fr} » (${c.id}) : l’option vide dit « — Inchangé — » alors que rien n’existe encore à laisser inchangé`);
        }
      }
      expect(fautes, 'option vide trompeuse').toEqual([]);
    });
  }
});
