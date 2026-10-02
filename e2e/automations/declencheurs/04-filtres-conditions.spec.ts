/**
 * L'éditeur de conditions sur les champs personnalisés (EDT-087 à EDT-099),
 * dans la section « Filtres » du déclencheur (EDT-070).
 *
 * Ce que ce fichier prouve, pour CHACUN des 20 opérateurs (6 familles de champs) :
 *  · il se configure à l'écran (champ, opérateur, valeur ou valeurs) ;
 *  · il s'enregistre sous `conditions.champs_perso` dans la forme attendue ;
 *  · le MOTEUR sait le juger : la condition enregistrée, donnée à l'évaluateur
 *    partagé (`src/lib/champs/filtres.ts`, celui que le serveur appelle), répond
 *    « vrai » sur une valeur qui doit passer et « faux » sur une qui ne doit pas ;
 *  · il se relit tel quel après rechargement.
 *
 * Remarque d'accessibilité : une ligne de condition n'a ni rôle ni nom (un
 * simple <div>) ; on l'atteint ici par le parent de son menu « Champ ».
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect, creerRegle, lireRegle } from '../_outils/banc';
import { evaluerCondition, jourLocal, type Condition } from '../../../src/lib/champs/filtres';
import type { TypeChamp } from '../../../src/lib/champs/types';
import {
  donnees, ouvrirEditeur, carteDeclencheur, tiroirDeclencheurs, ouvrirTiroirDeclencheurs, panneauDeclencheur,
  ETAPE_NOTIF, ecritureRegle, ouvrirPanneauDeclencheur, enregistrerPanneauDeclencheur, valeurAffichee, optionsDe, type Donnees,
  champsDuBureau, ecartAvecLOrdreDuBureau,
} from './_donnees';

test.afterEach(async ({ context }) => { await context.unrouteAll({ behavior: 'ignoreErrors' }); });

const FUSEAU = 'America/Toronto';
const filtres = (page: Page) => panneauDeclencheur(page).getByRole('region', { name: 'Filtres' });
/** La i-ème ligne de condition : le parent du menu « Champ ». */
const ligne = (page: Page, i: number) => filtres(page).getByLabel('Champ', { exact: true }).nth(i).locator('xpath=..');

/** Le jour J du mois affiché par le calendrier (le mois courant à l'ouverture), au format AAAA-MM-JJ. */
function jourDuMois(j: number): string {
  return `${jourLocal(new Date(), FUSEAU).slice(0, 8)}${String(j).padStart(2, '0')}`;
}
/** Tel que le bouton du calendrier le redit : « 15 octobre 2026 ». */
function dateAffichee(iso: string): string {
  const [a, m, j] = iso.split('-').map(Number);
  return new Date(a, m - 1, j).toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' });
}
async function choisirDate(rangee: Locator, rang: number, jour: number): Promise<void> {
  // Le bouton du sélecteur de date dit « Choisir une date » tant qu'aucune n'est posée.
  await rangee.getByRole('button', { name: /Choisir une date|\d{4}$/ }).nth(rang).click();
  await rangee.getByRole('button', { name: String(jour), exact: true }).click();
}

interface Cas {
  op: string;
  /** Libellé FR de l'opérateur dans le menu. */
  libelle: string;
  /** Clé du champ (données du lot). */
  champ: string;
  type: TypeChamp;
  /** Saisit la ou les valeurs dans la ligne. */
  saisir?: (rangee: Locator, d: Donnees) => Promise<void>;
  /** La condition attendue en base (sans `field_id`, sans les clés nulles). */
  enBase: (d: Donnees) => Record<string, unknown>;
  /** Une valeur de fiche qui DOIT satisfaire la condition, une qui ne le doit PAS. */
  passe: (d: Donnees) => unknown;
  bloque: (d: Donnees) => unknown;
  /** Ce que la ligne doit réafficher après rechargement. */
  relire: (rangee: Locator, d: Donnees) => Promise<void>;
}

const valeur = (r: Locator) => r.getByLabel('Valeur', { exact: true });
const opt = (d: Donnees, champ: string, label: string) => d.champs[champ].options.find((o) => o.label === label)?.id ?? `OPTION ABSENTE ${label}`;
const sansValeur = { relire: async (r: Locator) => { await expect(r.getByRole('textbox')).toHaveCount(0); } };
const aujourdhui = () => jourLocal(new Date(), FUSEAU);
const ilYA = (jours: number) => jourLocal(new Date(Date.now() - jours * 86_400_000), FUSEAU);

const FAMILLES: Record<string, Cas[]> = {
  'texte (ligne simple)': [
    { op: 'is', libelle: 'est', champ: 'qa_texte', type: 'single_line', saisir: (r) => valeur(r).fill('Montréal'), enBase: () => ({ op: 'is', value: 'Montréal' }), passe: () => '  montréal ', bloque: () => 'Laval', relire: (r) => expect(valeur(r)).toHaveValue('Montréal') },
    { op: 'is_not', libelle: 'n’est pas', champ: 'qa_texte', type: 'single_line', saisir: (r) => valeur(r).fill('Laval'), enBase: () => ({ op: 'is_not', value: 'Laval' }), passe: () => 'Montréal', bloque: () => 'laval', relire: (r) => expect(valeur(r)).toHaveValue('Laval') },
    { op: 'contains', libelle: 'contient', champ: 'qa_texte', type: 'single_line', saisir: (r) => valeur(r).fill('été 🌞 & <b>'), enBase: () => ({ op: 'contains', value: 'été 🌞 & <b>' }), passe: () => 'Promo ÉTÉ 🌞 & <b>gras</b>', bloque: () => 'Promo hiver', relire: (r) => expect(valeur(r)).toHaveValue('été 🌞 & <b>') },
    { op: 'not_contains', libelle: 'ne contient pas', champ: 'qa_texte', type: 'single_line', saisir: (r) => valeur(r).fill('spam'), enBase: () => ({ op: 'not_contains', value: 'spam' }), passe: () => 'client fidèle', bloque: () => 'SPAM connu', relire: (r) => expect(valeur(r)).toHaveValue('spam') },
    { op: 'is_empty', libelle: 'est vide', champ: 'qa_texte', type: 'single_line', enBase: () => ({ op: 'is_empty' }), passe: () => null, bloque: () => 'x', ...sansValeur },
    { op: 'is_not_empty', libelle: 'n’est pas vide', champ: 'qa_texte', type: 'single_line', enBase: () => ({ op: 'is_not_empty' }), passe: () => 'x', bloque: () => '', ...sansValeur },
  ],
  'nombre et montant': [
    { op: 'eq', libelle: '=', champ: 'qa_nombre', type: 'number', saisir: (r) => valeur(r).fill('20'), enBase: () => ({ op: 'eq', value: 20 }), passe: () => 20, bloque: () => 21, relire: (r) => expect(valeur(r)).toHaveValue('20') },
    { op: 'neq', libelle: '≠', champ: 'qa_nombre', type: 'number', saisir: (r) => valeur(r).fill('0'), enBase: () => ({ op: 'neq', value: 0 }), passe: () => 3, bloque: () => 0, relire: (r) => expect(valeur(r)).toHaveValue('0') },
    { op: 'gt', libelle: 'plus grand que', champ: 'qa_nombre', type: 'number', saisir: (r) => valeur(r).fill('12.5'), enBase: () => ({ op: 'gt', value: 12.5 }), passe: () => 12.6, bloque: () => 12.5, relire: (r) => expect(valeur(r)).toHaveValue('12.5') },
    { op: 'lt', libelle: 'plus petit que', champ: 'qa_nombre', type: 'number', saisir: (r) => valeur(r).fill('-3'), enBase: () => ({ op: 'lt', value: -3 }), passe: () => -4, bloque: () => 0, relire: (r) => expect(valeur(r)).toHaveValue('-3') },
    {
      op: 'between', libelle: 'entre', champ: 'qa_nombre', type: 'number',
      saisir: async (r) => { await valeur(r).fill('10'); await r.getByLabel('Deuxième valeur').fill('50'); },
      enBase: () => ({ op: 'between', value: 10, value2: 50 }), passe: () => 50, bloque: () => 51,
      relire: async (r) => { await expect(valeur(r)).toHaveValue('10'); await expect(r.getByLabel('Deuxième valeur')).toHaveValue('50'); await expect(r.getByText('et', { exact: true })).toBeVisible(); },
    },
    { op: 'is_empty', libelle: 'est vide', champ: 'qa_nombre', type: 'number', enBase: () => ({ op: 'is_empty' }), passe: () => null, bloque: () => 0, ...sansValeur },
    { op: 'is_not_empty', libelle: 'n’est pas vide', champ: 'qa_nombre', type: 'number', enBase: () => ({ op: 'is_not_empty' }), passe: () => 0, bloque: () => null, ...sansValeur },
    // Montant : saisi en DOLLARS, enregistré en CENTS (ce que la fiche porte), avec « $ » à côté.
    {
      op: 'gt', libelle: 'plus grand que', champ: 'qa_montant', type: 'monetary', saisir: (r) => valeur(r).fill('45.5'),
      enBase: () => ({ op: 'gt', value: 4550 }), passe: () => 4551, bloque: () => 4550,
      relire: async (r) => { await expect(valeur(r)).toHaveValue('45.5'); await expect(r.getByText('$', { exact: true })).toBeVisible(); },
    },
  ],
  'liste (simple et choix multiples)': [
    {
      op: 'any_of', libelle: 'est l’un de', champ: 'qa_liste', type: 'dropdown_single',
      saisir: async (r) => { await r.getByRole('button', { name: 'Été 🌞', exact: true }).click(); await r.getByRole('button', { name: 'Hiver', exact: true }).click(); },
      enBase: (d) => ({ op: 'any_of', value: [opt(d, 'qa_liste', 'Été 🌞'), opt(d, 'qa_liste', 'Hiver')] }),
      passe: (d) => opt(d, 'qa_liste', 'Hiver'), bloque: (d) => opt(d, 'qa_liste', 'C’est « spécial » & <b>gras</b>'),
      relire: async (r) => {
        await expect(r.getByRole('button', { name: 'Été 🌞', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(r.getByRole('button', { name: 'Hiver', exact: true })).toHaveAttribute('aria-pressed', 'true');
        // L'option aux caractères spéciaux s'affiche en TEXTE (aucune balise interprétée) et n'est pas cochée.
        await expect(r.getByRole('button', { name: 'C’est « spécial » & <b>gras</b>', exact: true })).toHaveAttribute('aria-pressed', 'false');
      },
    },
    {
      op: 'none_of', libelle: 'n’est aucun de', champ: 'qa_liste', type: 'dropdown_single',
      saisir: async (r) => { await r.getByRole('button', { name: 'C’est « spécial » & <b>gras</b>', exact: true }).click(); },
      enBase: (d) => ({ op: 'none_of', value: [opt(d, 'qa_liste', 'C’est « spécial » & <b>gras</b>')] }),
      passe: (d) => opt(d, 'qa_liste', 'Hiver'), bloque: (d) => opt(d, 'qa_liste', 'C’est « spécial » & <b>gras</b>'),
      relire: async (r) => { await expect(r.getByRole('button', { name: 'C’est « spécial » & <b>gras</b>', exact: true })).toHaveAttribute('aria-pressed', 'true'); },
    },
    { op: 'is_empty', libelle: 'est vide', champ: 'qa_liste', type: 'dropdown_single', enBase: () => ({ op: 'is_empty' }), passe: () => null, bloque: (d) => opt(d, 'qa_liste', 'Hiver'), relire: async (r) => { await expect(r.getByRole('group', { name: 'Options' })).toHaveCount(0); } },
    { op: 'is_not_empty', libelle: 'n’est pas vide', champ: 'qa_liste', type: 'dropdown_single', enBase: () => ({ op: 'is_not_empty' }), passe: (d) => opt(d, 'qa_liste', 'Hiver'), bloque: () => null, relire: async (r) => { await expect(r.getByRole('group', { name: 'Options' })).toHaveCount(0); } },
    {
      op: 'any_of', libelle: 'est l’un de', champ: 'qa_multi', type: 'dropdown_multi',
      saisir: async (r) => { await r.getByRole('button', { name: 'Vitres', exact: true }).click(); await r.getByRole('button', { name: 'Façade', exact: true }).click(); },
      enBase: (d) => ({ op: 'any_of', value: [opt(d, 'qa_multi', 'Vitres'), opt(d, 'qa_multi', 'Façade')] }),
      passe: (d) => [opt(d, 'qa_multi', 'Gouttières'), opt(d, 'qa_multi', 'Façade')], bloque: (d) => [opt(d, 'qa_multi', 'Gouttières')],
      relire: async (r) => {
        await expect(r.getByRole('button', { name: 'Vitres', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(r.getByRole('button', { name: 'Gouttières', exact: true })).toHaveAttribute('aria-pressed', 'false');
        await expect(r.getByRole('button', { name: 'Façade', exact: true })).toHaveAttribute('aria-pressed', 'true');
      },
    },
  ],
  date: [
    { op: 'today', libelle: 'aujourd’hui', champ: 'qa_date', type: 'date', enBase: () => ({ op: 'today' }), passe: aujourdhui, bloque: () => ilYA(1), ...sansValeur },
    { op: 'yesterday', libelle: 'hier', champ: 'qa_date', type: 'date', enBase: () => ({ op: 'yesterday' }), passe: () => ilYA(1), bloque: aujourdhui, ...sansValeur },
    {
      op: 'in_last', libelle: 'dans les derniers', champ: 'qa_date', type: 'date',
      saisir: async (r) => { await r.getByLabel('Nombre', { exact: true }).fill('2'); await r.getByLabel('Unité').selectOption({ label: 'semaines' }); },
      enBase: () => ({ op: 'in_last', n: 2, unit: 'weeks' }), passe: () => ilYA(10), bloque: () => ilYA(20),
      relire: async (r) => { await expect(r.getByLabel('Nombre', { exact: true })).toHaveValue('2'); expect(await valeurAffichee(r.getByLabel('Unité'))).toBe('semaines'); },
    },
    {
      op: 'more_than_ago', libelle: 'il y a plus de', champ: 'qa_date', type: 'date',
      saisir: async (r) => { await r.getByLabel('Nombre', { exact: true }).fill('3'); await r.getByLabel('Unité').selectOption({ label: 'mois' }); },
      enBase: () => ({ op: 'more_than_ago', n: 3, unit: 'months' }), passe: () => ilYA(120), bloque: () => ilYA(30),
      relire: async (r) => { await expect(r.getByLabel('Nombre', { exact: true })).toHaveValue('3'); expect(await valeurAffichee(r.getByLabel('Unité'))).toBe('mois'); },
    },
    {
      // L'unité n'est pas touchée : l'écran dit « jours », le moteur prend « jours » par défaut.
      op: 'less_than_ago', libelle: 'il y a moins de', champ: 'qa_date', type: 'date',
      saisir: async (r) => { await r.getByLabel('Nombre', { exact: true }).fill('10'); },
      enBase: () => ({ op: 'less_than_ago', n: 10 }), passe: () => ilYA(5), bloque: () => ilYA(15),
      relire: async (r) => { await expect(r.getByLabel('Nombre', { exact: true })).toHaveValue('10'); expect(await valeurAffichee(r.getByLabel('Unité'))).toBe('jours'); },
    },
    {
      op: 'before', libelle: 'avant le', champ: 'qa_date', type: 'date', saisir: (r) => choisirDate(r, 0, 15),
      enBase: () => ({ op: 'before', value: jourDuMois(15) }), passe: () => jourDuMois(14), bloque: () => jourDuMois(15),
      relire: async (r) => { await expect(r.getByRole('button', { name: dateAffichee(jourDuMois(15)) })).toBeVisible(); },
    },
    {
      op: 'after', libelle: 'après le', champ: 'qa_date', type: 'date', saisir: (r) => choisirDate(r, 0, 15),
      enBase: () => ({ op: 'after', value: jourDuMois(15) }), passe: () => jourDuMois(16), bloque: () => jourDuMois(15),
      relire: async (r) => { await expect(r.getByRole('button', { name: dateAffichee(jourDuMois(15)) })).toBeVisible(); },
    },
    {
      op: 'between', libelle: 'entre', champ: 'qa_date', type: 'date',
      saisir: async (r) => { await choisirDate(r, 0, 10); await choisirDate(r, 1, 20); },
      enBase: () => ({ op: 'between', value: jourDuMois(10), value2: jourDuMois(20) }), passe: () => jourDuMois(20), bloque: () => jourDuMois(21),
      relire: async (r) => {
        await expect(r.getByRole('button', { name: dateAffichee(jourDuMois(10)) })).toBeVisible();
        await expect(r.getByRole('button', { name: dateAffichee(jourDuMois(20)) })).toBeVisible();
      },
    },
    { op: 'is_empty', libelle: 'est vide', champ: 'qa_date', type: 'date', enBase: () => ({ op: 'is_empty' }), passe: () => null, bloque: aujourdhui, ...sansValeur },
    { op: 'is_not_empty', libelle: 'n’est pas vide', champ: 'qa_date', type: 'date', enBase: () => ({ op: 'is_not_empty' }), passe: aujourdhui, bloque: () => null, ...sansValeur },
  ],
  'case à cocher': [
    {
      op: 'is', libelle: 'est', champ: 'qa_case', type: 'checkbox', enBase: () => ({ op: 'is', value: true }), passe: () => true, bloque: () => false,
      relire: async (r) => { expect(await valeurAffichee(r.getByLabel('Valeur', { exact: true }))).toBe('oui (cochée)'); },
    },
    {
      op: 'is', libelle: 'est', champ: 'qa_case', type: 'checkbox',
      saisir: async (r) => { await r.getByLabel('Valeur', { exact: true }).selectOption({ label: 'non (pas cochée)' }); },
      enBase: () => ({ op: 'is', value: false }), passe: () => null, bloque: () => true,
      relire: async (r) => { expect(await valeurAffichee(r.getByLabel('Valeur', { exact: true }))).toBe('non (pas cochée)'); },
    },
  ],
  fichier: [
    { op: 'is_empty', libelle: 'est vide', champ: 'qa_fichier', type: 'file', enBase: () => ({ op: 'is_empty' }), passe: () => null, bloque: () => 'devis.pdf', ...sansValeur },
    { op: 'is_not_empty', libelle: 'n’est pas vide', champ: 'qa_fichier', type: 'file', enBase: () => ({ op: 'is_not_empty' }), passe: () => 'devis.pdf', bloque: () => null, ...sansValeur },
  ],
};

/** Retire les clés nulles (l'éditeur pose `value: null`, `value2: null` en changeant d'opérateur) : sans effet pour le moteur. */
function sansNuls(c: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(c).filter(([, v]) => v !== null && v !== undefined));
}

test.describe('conditions de champs — les 20 opérateurs, famille par famille', () => {
  for (const [famille, cas] of Object.entries(FAMILLES)) {
    const ids = famille.startsWith('texte') ? '[EDT-090]' : famille.startsWith('nombre') ? '[EDT-091][EDT-092]' : famille.startsWith('liste') ? '[EDT-093]'
      : famille === 'date' ? '[EDT-094][EDT-095][EDT-096][EDT-097]' : famille.startsWith('case') ? '[EDT-089]' : '';
    test(`[EDT-070][EDT-087][EDT-088]${ids}[EDT-099] famille « ${famille} » : ${[...new Set(cas.map((c) => c.libelle))].join(', ')} — configurés, enregistrés dans la forme que le moteur juge, relus`, async ({ page, bureau, marque }) => {
      test.setTimeout(300_000);
      const d = await donnees(bureau);
      const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} ${famille}`, trigger_event: 'lead.created', conditions: {}, steps: ETAPE_NOTIF });
      await ouvrirEditeur(page, regle.id);
      await ouvrirPanneauDeclencheur(page);
      const section = filtres(page);
      await expect(section).toBeVisible();
      await expect(section.getByText('Seulement si les champs de la fiche (Client) remplissent ces conditions au moment de l’événement.')).toBeVisible();

      // ── Configurer une ligne par opérateur ──
      for (const [i, c] of cas.entries()) {
        await test.step(`ligne ${i + 1} : « ${d.champs[c.champ].label} » ${c.libelle}`, async () => {
          await section.getByRole('button', { name: 'Ajouter une condition' }).click();
          const r = ligne(page, i);
          await r.getByLabel('Champ', { exact: true }).selectOption({ label: d.champs[c.champ].label });
          // On ne choisit un opérateur que s'il n'est pas DÉJÀ celui du menu — comme un utilisateur : re-choisir
          // l'option affichée n'envoie aucun changement dans un vrai navigateur, alors que `selectOption` en
          // forcerait un (et le produit vide la valeur à chaque changement d'opérateur — « oui (cochée) » y passerait).
          const operateur = r.getByLabel('Opérateur');
          if ((await valeurAffichee(operateur)) !== c.libelle) await operateur.selectOption({ label: c.libelle });
          expect(await valeurAffichee(operateur), `ligne ${i + 1} — opérateur affiché`).toBe(c.libelle);
          if (c.saisir) await c.saisir(r, d);
        });
      }
      await enregistrerPanneauDeclencheur(page);

      // ── En base : une condition par ligne, dans l'ordre, dans la forme attendue ──
      const enBase = ((await lireRegle(bureau, regle.id))?.conditions ?? {}) as { champs_perso?: Array<Record<string, unknown>> };
      expect(Object.keys(enBase)).toEqual(['champs_perso']);
      const attendu = cas.map((c) => ({ field_id: d.champs[c.champ].id, ...c.enBase(d) }));
      expect((enBase.champs_perso ?? []).map(sansNuls)).toEqual(attendu);
      await expect(carteDeclencheur(page)).toContainText(`${cas.length} filtre${cas.length > 1 ? 's' : ''}`);

      // ── Le moteur : la condition ENREGISTRÉE répond juste sur une valeur qui passe et sur une qui bloque ──
      for (const [i, c] of cas.entries()) {
        const condition = (enBase.champs_perso ?? [])[i] as unknown as Condition;
        const juge = (v: unknown) => {
          try { return evaluerCondition(c.type, v, condition, { fuseau: FUSEAU }); } catch (e) { return `ERREUR : ${String(e)}`; }
        };
        expect.soft(juge(c.passe(d)), `moteur — « ${c.libelle} » (${c.champ}) doit laisser passer ${JSON.stringify(c.passe(d))}`).toBe(true);
        expect.soft(juge(c.bloque(d)), `moteur — « ${c.libelle} » (${c.champ}) doit bloquer ${JSON.stringify(c.bloque(d))}`).toBe(false);
      }

      // ── Rechargement : chaque ligne réaffiche son champ, son opérateur, ses valeurs ──
      await page.reload();
      await expect(carteDeclencheur(page)).toContainText(`${cas.length} filtre${cas.length > 1 ? 's' : ''}`, { timeout: 90_000 });
      await ouvrirPanneauDeclencheur(page);
      await expect(filtres(page).getByLabel('Champ', { exact: true })).toHaveCount(cas.length);
      for (const [i, c] of cas.entries()) {
        await test.step(`relecture ligne ${i + 1} : ${c.libelle}`, async () => {
          const r = ligne(page, i);
          expect.soft(await valeurAffichee(r.getByLabel('Champ', { exact: true })), `ligne ${i + 1} — champ`).toBe(d.champs[c.champ].label);
          expect.soft(await valeurAffichee(r.getByLabel('Opérateur')), `ligne ${i + 1} — opérateur`).toBe(c.libelle);
          await c.relire(r, d);
        });
      }
      // Rouvrir et relire n'a rien changé en base.
      expect(((await lireRegle(bureau, regle.id))?.conditions as { champs_perso?: unknown[] }).champs_perso).toEqual(enBase.champs_perso);
    });
  }
});

test.describe('conditions de champs — l’éditeur', () => {
  test('[EDT-070] la section « Filtres » suit l’objet du déclencheur : champs du client, du pipeline ; absente quand la fiche n’a pas de champs (rendez-vous)', async ({ page, bureau, marque }) => {
    test.setTimeout(240_000);
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} objets`, trigger_event: 'lead.created', conditions: {}, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    await ouvrirPanneauDeclencheur(page);

    const champsOfferts = async () => {
      await filtres(page).getByRole('button', { name: 'Ajouter une condition' }).click();
      return optionsDe(ligne(page, 0).getByLabel('Champ', { exact: true }));
    };
    // Les champs du bureau, relus en base à l'instant (un autre lot peut y avoir créé les siens).
    const liste = await champsDuBureau(bureau, bureau.orgA);
    const de = (objet: string) => liste.filter((c) => c.object_type === objet);
    // Client : tous les champs actifs du client et eux seuls, dans l'ordre du bureau.
    await expect(filtres(page).getByText(/fiche \(Client\)/)).toBeVisible();
    expect(de('client').map((c) => c.label)).toEqual(expect.arrayContaining(['QA Texte', 'QA Nombre', 'QA Liste', 'QA Date', 'QA Case', 'QA Fichier']));
    expect(ecartAvecLOrdreDuBureau(await champsOfferts(), de('client'))).toBeNull();

    const changer = async (titre: string) => {
      await ouvrirTiroirDeclencheurs(page);
      const ecriture = ecritureRegle(page);
      await tiroirDeclencheurs(page).getByRole('button', { name: new RegExp(`^${titre}`) }).click();
      expect((await ecriture).status()).toBe(200);
      await expect(carteDeclencheur(page)).toContainText(titre);
      await ouvrirPanneauDeclencheur(page);
    };
    // Pipeline : seulement les champs du pipeline.
    await changer('Opportunité entre dans une étape');
    await expect(filtres(page).getByText(/fiche \(Pipeline\)/)).toBeVisible();
    expect(de('deal').map((c) => c.label)).toEqual(expect.arrayContaining(['QA Date de relance', 'QA Nombre de fenêtres']));
    expect(ecartAvecLOrdreDuBureau(await champsOfferts(), de('deal'))).toBeNull();
    // Facture.
    await changer('Facture payée');
    await expect(filtres(page).getByText(/fiche \(Facture\)/)).toBeVisible();
    expect(de('invoice').map((c) => c.label)).toContain('QA Bon de commande');
    expect(ecartAvecLOrdreDuBureau(await champsOfferts(), de('invoice'))).toBeNull();
    // Rendez-vous : aucune fiche à champs — pas de section.
    await changer('Rendez-vous planifié');
    await expect(filtres(page)).toHaveCount(0);
  });

  test('[EDT-087][EDT-088] les opérateurs offerts suivent le type du champ ; changer de champ remet l’opérateur et vide la valeur', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} opérateurs`, trigger_event: 'lead.created', conditions: {}, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    await ouvrirPanneauDeclencheur(page);
    await filtres(page).getByRole('button', { name: 'Ajouter une condition' }).click();
    const r = ligne(page, 0);
    const champ = r.getByLabel('Champ', { exact: true });
    const op = r.getByLabel('Opérateur');
    const TEXTE = ['est', 'n’est pas', 'contient', 'ne contient pas', 'est vide', 'n’est pas vide'];
    const NOMBRE = ['=', '≠', 'plus grand que', 'plus petit que', 'entre', 'est vide', 'n’est pas vide'];
    const LISTE = ['est l’un de', 'n’est aucun de', 'est vide', 'n’est pas vide'];
    const DATE = ['aujourd’hui', 'hier', 'dans les derniers', 'il y a plus de', 'il y a moins de', 'avant le', 'après le', 'entre', 'est vide', 'n’est pas vide'];
    const parChamp: Array<[string, string[]]> = [
      ['QA Texte', TEXTE], ['QA Paragraphe', TEXTE], ['QA Téléphone', TEXTE], ['QA Courriel', TEXTE], ['QA Site web', TEXTE],
      ['QA Nombre', NOMBRE], ['QA Montant', NOMBRE],
      ['QA Liste', LISTE], ['QA Choix multiples', LISTE],
      ['QA Date', DATE], ['QA Date et heure', DATE],
      ['QA Case', ['est']],
      ['QA Fichier', ['est vide', 'n’est pas vide']],
    ];
    for (const [libelle, ops] of parChamp) {
      await champ.selectOption({ label: libelle });
      expect(await optionsDe(op), `opérateurs de « ${libelle} »`).toEqual(ops);
      expect(await valeurAffichee(op), `opérateur de départ de « ${libelle} »`).toBe(ops[0]);
    }
    // 20 opérateurs distincts en tout.
    expect(new Set([...TEXTE, ...NOMBRE, ...LISTE, ...DATE]).size).toBe(20);

    // Changer de champ vide la valeur saisie.
    await champ.selectOption({ label: 'QA Texte' });
    await r.getByLabel('Valeur', { exact: true }).fill('à effacer');
    await champ.selectOption({ label: 'QA Courriel' });
    await expect(r.getByLabel('Valeur', { exact: true })).toHaveValue('');
    // Changer d'opérateur aussi.
    await r.getByLabel('Valeur', { exact: true }).fill('a@lume-qa.test');
    await op.selectOption({ label: 'contient' });
    await expect(r.getByLabel('Valeur', { exact: true })).toHaveValue('');
  });

  test('[EDT-098][EDT-099] « Ajouter une condition » jusqu’à 10 lignes, pas une de plus ; « Retirer la condition » enlève LA ligne visée', async ({ page, bureau, marque }) => {
    const d = await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} dix lignes`, trigger_event: 'lead.created', conditions: {}, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    await ouvrirPanneauDeclencheur(page);
    const ajouter = filtres(page).getByRole('button', { name: 'Ajouter une condition' });
    for (let i = 0; i < 10; i++) {
      await ajouter.click();
      await ligne(page, i).getByLabel('Champ', { exact: true }).selectOption({ label: 'QA Nombre' });
      await ligne(page, i).getByLabel('Valeur', { exact: true }).fill(String(i + 1));
    }
    await expect(filtres(page).getByLabel('Champ', { exact: true })).toHaveCount(10);
    await expect(ajouter).toHaveCount(0);   // la 11e n'est pas offerte

    // Retirer la 3e ligne (valeur 3) : les autres gardent leur valeur, le bouton d'ajout revient.
    await ligne(page, 2).getByRole('button', { name: 'Retirer la condition' }).click();
    await expect(filtres(page).getByLabel('Champ', { exact: true })).toHaveCount(9);
    await expect(ajouter).toBeVisible();
    await expect(ligne(page, 2).getByLabel('Valeur', { exact: true })).toHaveValue('4');

    await enregistrerPanneauDeclencheur(page);
    const enBase = ((await lireRegle(bureau, regle.id))?.conditions as { champs_perso?: Array<{ value: number; field_id: string; op: string }> }).champs_perso ?? [];
    expect(enBase.map((c) => c.value)).toEqual([1, 2, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(enBase.map((c) => c.field_id))).toEqual(new Set([d.champs.qa_nombre.id]));
    expect(new Set(enBase.map((c) => c.op))).toEqual(new Set(['eq']));
    await expect(carteDeclencheur(page)).toContainText('9 filtres');

    // Tout retirer : la clé `champs_perso` disparaît (pas de liste vide en base).
    await ouvrirPanneauDeclencheur(page);
    for (let i = 0; i < 9; i++) await ligne(page, 0).getByRole('button', { name: 'Retirer la condition' }).click();
    await expect(filtres(page).getByLabel('Champ', { exact: true })).toHaveCount(0);
    await enregistrerPanneauDeclencheur(page);
    expect((await lireRegle(bureau, regle.id))?.conditions).toEqual({});
  });

  test('[EDT-090][EDT-074] une ligne laissée sans valeur n’est pas enregistrée (elle bloquerait la règle)', async ({ page, bureau, marque }) => {
    const d = await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} incomplète`, trigger_event: 'lead.created', conditions: {}, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    await ouvrirPanneauDeclencheur(page);
    const ajouter = filtres(page).getByRole('button', { name: 'Ajouter une condition' });
    await ajouter.click();
    await ligne(page, 0).getByLabel('Champ', { exact: true }).selectOption({ label: 'QA Texte' });
    await ligne(page, 0).getByLabel('Valeur', { exact: true }).fill('complète');
    await ajouter.click();
    await ligne(page, 1).getByLabel('Champ', { exact: true }).selectOption({ label: 'QA Nombre' });   // aucune valeur
    await ajouter.click();
    await ligne(page, 2).getByLabel('Champ', { exact: true }).selectOption({ label: 'QA Liste' });    // aucune option cochée
    await enregistrerPanneauDeclencheur(page);
    const enBase = ((await lireRegle(bureau, regle.id))?.conditions as { champs_perso?: Array<Record<string, unknown>> }).champs_perso ?? [];
    expect(enBase.map(sansNuls)).toEqual([{ field_id: d.champs.qa_texte.id, op: 'is', value: 'complète' }]);
    await expect(carteDeclencheur(page)).toContainText('1 filtre');
  });

  test('[EDT-090][EDT-074] une ligne incomplète retirée à l’enregistrement est SIGNALÉE (au lieu de disparaître derrière « Réglages enregistrés ») @defaut', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} incomplète muette`, trigger_event: 'lead.created', conditions: {}, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    const panneau = await ouvrirPanneauDeclencheur(page);
    await filtres(page).getByRole('button', { name: 'Ajouter une condition' }).click();
    await ligne(page, 0).getByLabel('Champ', { exact: true }).selectOption({ label: 'QA Nombre' });   // « QA Nombre = (rien) »
    await panneau.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    // L'utilisateur a posé un filtre : s'il n'est pas gardé, il doit le savoir AVANT que le panneau se ferme.
    await expect(panneau.getByText(/incompl|sans valeur|valeur manquante|à compléter/i)).toBeVisible({ timeout: 5_000 });
  });

  test('[EDT-091] valeur numérique tapée au clavier : « 12.5 » reste 12,5 (le point ne disparaît pas), une lettre n’affiche pas « NaN » @defaut', async ({ page, bureau, marque }) => {
    const d = await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} décimale`, trigger_event: 'lead.created', conditions: {}, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    await ouvrirPanneauDeclencheur(page);
    await filtres(page).getByRole('button', { name: 'Ajouter une condition' }).click();
    const r = ligne(page, 0);
    await r.getByLabel('Champ', { exact: true }).selectOption({ label: 'QA Nombre' });
    const v = r.getByLabel('Valeur', { exact: true });
    // Frappe réelle, touche par touche — comme un utilisateur.
    await v.pressSequentially('12.5');
    expect.soft(await v.inputValue(), 'après avoir tapé 1, 2, point, 5').toBe('12.5');
    await enregistrerPanneauDeclencheur(page);
    const enBase = ((await lireRegle(bureau, regle.id))?.conditions as { champs_perso?: Array<Record<string, unknown>> }).champs_perso ?? [];
    expect.soft(enBase.map(sansNuls), 'la valeur enregistrée est celle qui a été tapée').toEqual([{ field_id: d.champs.qa_nombre.id, op: 'eq', value: 12.5 }]);

    await ouvrirPanneauDeclencheur(page);
    const v2 = ligne(page, 0).getByLabel('Valeur', { exact: true });
    await v2.fill('');
    await v2.pressSequentially('abc');
    expect.soft(await v2.inputValue(), 'des lettres dans un champ numérique').not.toBe('NaN');
  });

  test('[EDT-093] une option ARCHIVÉE d’une liste n’est plus proposée dans « est l’un de » @defaut', async ({ page, bureau, marque }) => {
    const d = await donnees(bureau);
    expect(d.champs.qa_liste_archive.optionsArchivees.map((o) => o.label)).toEqual(['Retirée']);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} option archivée`, trigger_event: 'lead.created', conditions: {}, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    await ouvrirPanneauDeclencheur(page);
    await filtres(page).getByRole('button', { name: 'Ajouter une condition' }).click();
    const r = ligne(page, 0);
    await r.getByLabel('Champ', { exact: true }).selectOption({ label: 'QA Liste à option retirée' });
    const options = r.getByRole('group', { name: 'Options' }).getByRole('button');
    await expect(options.first()).toBeVisible();
    expect(await options.allInnerTexts()).toEqual(['Active']);
  });

  test('[EDT-094][EDT-095] durée d’une condition de date : le nombre est borné de 1 à 3650 ; vidé, la ligne est incomplète', async ({ page, bureau, marque }) => {
    const d = await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} durée`, trigger_event: 'lead.created', conditions: {}, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    await ouvrirPanneauDeclencheur(page);
    await filtres(page).getByRole('button', { name: 'Ajouter une condition' }).click();
    const r = ligne(page, 0);
    await r.getByLabel('Champ', { exact: true }).selectOption({ label: 'QA Date' });
    await r.getByLabel('Opérateur').selectOption({ label: 'dans les derniers' });
    const n = r.getByLabel('Nombre', { exact: true });
    expect(await optionsDe(r.getByLabel('Unité'))).toEqual(['jours', 'semaines', 'mois']);
    await n.fill('99999');
    await expect(n).toHaveValue('3650');
    await n.fill('-4');
    await expect(n).toHaveValue('1');
    await n.fill('30');
    await enregistrerPanneauDeclencheur(page);
    const enBase = ((await lireRegle(bureau, regle.id))?.conditions as { champs_perso?: Array<Record<string, unknown>> }).champs_perso ?? [];
    expect(enBase.map(sansNuls)).toEqual([{ field_id: d.champs.qa_date.id, op: 'in_last', n: 30 }]);
  });
});
