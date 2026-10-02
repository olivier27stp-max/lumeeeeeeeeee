/**
 * Aides communes aux specs du lot « modeles » (bibliothèque de modèles, éditeurs
 * de message, vue d'ensemble, réglages globaux).
 *
 * Le banc (`../_outils/banc`) reste la porte d'entrée (voir `connexion.ts` pour
 * la façon dont la session est ouverte) : ce fichier y ajoute deux fixtures de
 * ménage (`copies`, `adresses`) et des gestes d'utilisateur réutilisés (ouvrir la
 * bibliothèque, déplier les messages d'une ligne…).
 */
import type { Locator, Page } from '@playwright/test';
import { expect, ouvrirListe, type Bureau, type LigneRegle } from '../_outils/banc';
import { base } from './connexion';
import { capturesDe } from '../_outils/banc';

export { expect };
export * from '../_outils/banc';
export { ecrireEtatJeu, fichierEtatJeu } from './connexion';

/** Où ranger les captures qui illustrent un constat. */
export const CAPTURES = capturesDe('modeles');

export interface Copies {
  /** Les règles du bureau A créées depuis le début du test (les plus anciennes d'abord). */
  nouvelles: () => Promise<LigneRegle[]>;
}

async function reglesNonFournies(bureau: Bureau, org: string): Promise<LigneRegle[]> {
  const { data, error } = await bureau.admin.from('automation_rules').select('*')
    .eq('org_id', org).eq('is_preset', false).order('created_at');
  if (error) throw new Error(`lecture des règles : ${error.message}`);
  return (data ?? []) as LigneRegle[];
}

async function supprimerRegles(bureau: Bureau, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await bureau.admin.from('automation_scheduled_tasks').delete().in('automation_rule_id', ids);
  await bureau.admin.from('automation_execution_logs').delete().in('automation_rule_id', ids);
  await bureau.admin.from('automation_rules').delete().in('id', ids);
}

/**
 * `copies` : une copie née d'un modèle ne porte pas la `marque` du banc (son nom
 * est celui du modèle) ; le ménage du banc ne la verrait pas. Ici, toute règle
 * non fournie (`is_preset = false`) du bureau A est supprimée AVANT le test
 * (restes d'une passe interrompue : ils fausseraient « Nom (2) ») et APRÈS.
 * Le bureau A de ce jeu n'appartient qu'à ce lot, et les tests tournent un par un.
 */
export interface LigneAdresse { id: string; org_id: string; name: string; api_key: string; enabled: boolean; deleted_at: string | null; created_by: string | null }

export interface Adresses {
  /** Les adresses d'appel du bureau A, supprimées comprises, les plus anciennes d'abord. */
  lire: () => Promise<LigneAdresse[]>;
  /** Crée une adresse directement en base (préparer un état). */
  creer: (nom?: string, enabled?: boolean) => Promise<LigneAdresse>;
}

async function viderAdresses(bureau: Bureau): Promise<void> {
  for (const org of [bureau.orgA, bureau.orgB]) {
    const { error } = await bureau.admin.from('automation_webhooks').delete().eq('org_id', org);
    // Une clé étrangère (journal des appels reçus) empêcherait l'effacement : on efface alors en douceur.
    if (error) await bureau.admin.from('automation_webhooks').update({ deleted_at: new Date().toISOString(), enabled: false }).eq('org_id', org).is('deleted_at', null);
  }
}

export const test = base.extend<{ copies: Copies; adresses: Adresses }>({
  /** `adresses` : le bureau A repart sans adresse d'appel avant ET après le test. */
  adresses: async ({ bureau }, use) => {
    await viderAdresses(bureau);
    const lire = async () => {
      const { data, error } = await bureau.admin.from('automation_webhooks').select('id, org_id, name, api_key, enabled, deleted_at, created_by')
        .eq('org_id', bureau.orgA).order('created_at');
      if (error) throw new Error(`lecture des adresses : ${error.message}`);
      return (data ?? []) as LigneAdresse[];
    };
    await use({
      lire,
      creer: async (nom = 'Formulaire de mon site', enabled = true) => {
        const { data, error } = await bureau.admin.from('automation_webhooks')
          .insert({ org_id: bureau.orgA, name: nom, enabled, created_by: bureau.comptes.proprioA.id })
          .select('id, org_id, name, api_key, enabled, deleted_at, created_by').single();
        if (error) throw new Error(`création d'adresse : ${error.message}`);
        return data as LigneAdresse;
      },
    });
    await viderAdresses(bureau);
  },

  copies: async ({ bureau }, use) => {
    await supprimerRegles(bureau, (await reglesNonFournies(bureau, bureau.orgA)).map((r) => r.id));
    await use({ nouvelles: () => reglesNonFournies(bureau, bureau.orgA) });
    await supprimerRegles(bureau, (await reglesNonFournies(bureau, bureau.orgA)).map((r) => r.id));
  },
});

/** La fenêtre « Bibliothèque de modèles ». */
export function bibliotheque(page: Page): Locator {
  return page.getByRole('dialog', { name: /Bibliothèque de modèles|Template library/ });
}

/** Liste → Créer → « Partir d'un modèle », et attend que le catalogue soit affiché. */
export async function ouvrirBibliotheque(page: Page, dejaSurLaListe = false): Promise<Locator> {
  if (!dejaSurLaListe) await ouvrirListe(page);
  await page.getByRole('button', { name: /^(Créer|Create workflow)$/ }).click();
  await page.getByRole('menuitem', { name: /Partir d’un modèle|Start from a template/ }).click();
  const fenetre = bibliotheque(page);
  await expect(fenetre).toBeVisible();
  await expect(fenetre.getByText(/Affichage de \d+ modèles?|Showing \d+ templates?/)).toBeVisible({ timeout: 30_000 });
  return fenetre;
}

/** La carte (ou la ligne) d'un modèle, par son nom exact. */
export function carteModele(fenetre: Locator, nom: string): Locator {
  return fenetre.getByRole('button').filter({ has: fenetre.page().getByText(nom, { exact: true }) });
}

/** Le nombre annoncé par « Affichage de N modèles ». */
export async function nombreAffiche(fenetre: Locator): Promise<number> {
  const t = await fenetre.getByText(/Affichage de \d+ modèles?|Showing \d+ templates?/).innerText();
  return Number(t.match(/\d+/)?.[0] ?? -1);
}

/** Les noms des modèles affichés (grille ou liste), dans l'ordre de l'écran. */
export async function nomsAffiches(fenetre: Locator): Promise<string[]> {
  return fenetre.locator('p.font-semibold').allInnerTexts();
}

/** L'éditeur plein écran est chargé (onglet Parcours + carte du déclencheur). */
export async function attendreEditeur(page: Page): Promise<void> {
  await page.waitForURL(/\/automations\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByRole('tab', { name: /^(Parcours|Builder)$/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: /^(Quand|When) / })).toBeVisible({ timeout: 30_000 });
}

/**
 * Les cartes d'étape du canevas (une par étape ; chacune a son bouton « Options de l'étape … »).
 * En anglais le bouton se nomme « Options for <étape> » (SequenceCanvas.tsx, inchangé depuis #533) :
 * la spec cherchait « Step options » / « Options for step », deux libellés que le produit n'a jamais portés.
 */
export function cartesEtape(page: Page): Locator {
  return page.getByRole('button', { name: /^(Options de l’étape |Options for )/ });
}

/**
 * Combien de cartes le canevas DESSINE pour ce parcours : il déroule chaque branche d'un « Si »
 * jusqu'au bout, donc une étape où deux branches se rejoignent est dessinée une fois par chemin.
 * Égal au nombre d'étapes quand aucune branche ne se rejoint.
 */
export function cartesSiArbre(etapes: EtapeStockee[]): number {
  const parId = new Map(etapes.map((e) => [e.id, e]));
  const compter = (id: string | null | undefined, vues: Set<string>): number => {
    const e = id ? parId.get(id) : undefined;
    if (!e || !id || vues.has(id)) return 0;
    const suite = new Set(vues).add(id);
    if (e.type === 'si') return 1 + compter(e.alors, suite) + compter(e.sinon, suite);
    if (e.type === 'arreter') return 1;
    return 1 + compter(e.suivant, suite);
  };
  return compter(etapes[0]?.id, new Set());
}

/** Filtre la liste sur un texte et attend la ligne voulue. */
export async function chercherDansListe(page: Page, texte: string): Promise<void> {
  await page.getByRole('textbox', { name: /^(Rechercher|Search)$/ }).fill(texte);
}

/** Déplie le panneau « messages » de la ligne dont le nom contient `fragment`. */
export async function deplierMessages(page: Page, fragment: string): Promise<void> {
  await chercherDansListe(page, fragment);
  const chevron = page.getByRole('button', { name: /^(Voir les messages de|View messages of) / }).first();
  await expect(chevron).toBeVisible();
  if ((await chevron.getAttribute('aria-expanded')) !== 'true') await chevron.click();
  await expect(chevron).toHaveAttribute('aria-expanded', 'true');
}

/**
 * Les clés techniques qu'un utilisateur ne devrait jamais lire : `snake_case`,
 * `objet.evenement`, opérateurs de comparaison suivis d'une valeur brute.
 * Les variables de message ([client_first_name], {{deal.title}}) sont retirées
 * avant : elles sont montrées exprès, en surbrillance.
 */
export function clesBrutes(texte: string): string[] {
  const sansVariables = texte.replace(/\[[a-z0-9_]+\]/gi, ' ').replace(/\{\{[^}]+\}\}/g, ' ');
  const trouvees = new Set<string>();
  for (const m of sansVariables.matchAll(/\b[a-z]+(?:_[a-z0-9]+)+\b/g)) trouvees.add(m[0]);
  for (const m of sansVariables.matchAll(/\b[a-z]+\.[a-z_]+\b/g)) {
    // « lumecrm.net », « g.page » : des adresses, pas des clés.
    if (!/\.(net|com|ca|page|io|app)$/.test(m[0])) trouvees.add(m[0]);
  }
  for (const m of sansVariables.matchAll(/\b([a-z]+) [≠=<>∈] ([A-Za-z0-9_]+)/g)) trouvees.add(m[0]);
  return [...trouvees];
}

const MOTS_ANGLAIS = /\b(the|your|you|and|with|has|have|been|thank|thanks|hello|hi|reminder|invoice|quote|payment|appointment|please|our|this|that|after|before|review|when|send|sent|wait|days?|hours?|follow-up|steps?|email|text|booked|paid|unpaid|welcome)\b/gi;
const MOTS_FRANCAIS = /\b(le|la|les|des|du|votre|vos|vous|bonjour|merci|devis|facture|rendez-vous|courriel|texto|étapes?|après|avant|jours?|heures?|et|pour|avec|soumission|rappel|aucune?|quand|attendre|envoyer)\b/gi;

/** Mots anglais relevés dans un texte censé être français (variables retirées). */
export function anglaisDans(texte: string): string[] {
  const t = texte.replace(/\[[a-z0-9_]+\]/gi, ' ').replace(/\{\{[^}]+\}\}/g, ' ');
  return [...new Set((t.match(MOTS_ANGLAIS) ?? []).map((m) => m.toLowerCase()))];
}

/** Mots français (ou lettres accentuées) relevés dans un texte censé être anglais. */
export function francaisDans(texte: string): string[] {
  const t = texte.replace(/\[[a-z0-9_]+\]/gi, ' ').replace(/\{\{[^}]+\}\}/g, ' ');
  const mots = (t.match(MOTS_FRANCAIS) ?? []).map((m) => m.toLowerCase());
  const accents = t.match(/[A-Za-zÀ-ÿ’'-]*[àâçèéêëîïôùûü][A-Za-zÀ-ÿ’'-]*/g) ?? [];
  return [...new Set([...mots, ...accents])];
}

/** Tous les textes d'une config d'action (corps, objet, titre… dans les deux langues). */
export function textesDeConfig(config: Record<string, unknown> | undefined): string[] {
  return Object.entries(config ?? {})
    .filter(([cle, v]) => typeof v === 'string' && /^(body|subject|title|description|message)(_en)?$/.test(cle))
    .map(([, v]) => v as string);
}

/** Une étape d'action d'un parcours, telle que stockée. */
export interface EtapeStockee {
  id?: string; type?: string; nom?: string; suivant?: string | null; alors?: string | null; sinon?: string | null;
  delai_secondes?: number; secondes_avant?: number; mode?: string; conditions?: Record<string, unknown>;
  action?: { type?: string; config?: Record<string, unknown> };
}

export function etapesDe(regle: Pick<LigneRegle, 'steps'>): EtapeStockee[] {
  return (regle.steps ?? []) as EtapeStockee[];
}

/** Remet la langue des messages et la pause du bureau A dans leur état de départ (FR, pas de pause). */
export async function remettreReglagesBureau(bureau: Bureau): Promise<void> {
  const { error } = await bureau.admin.from('company_settings').update({ default_language: 'fr' }).eq('org_id', bureau.orgA);
  if (error) throw new Error(`remise de la langue : ${error.message}`);
}
