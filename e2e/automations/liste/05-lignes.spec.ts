/**
 * LISTE — une ligne du tableau.
 *
 * Ce que ce fichier prouve :
 *  · le statut affiché (Publiée / Brouillon / Supprimée / en pause) est celui
 *    de la base, pour chaque combinaison des colonnes qui comptent
 *    (`is_active`, `deleted_at`, `purged_at`, `is_preset`) et la pause globale ;
 *  · le nom ouvre l'éditeur ; le sous-titre dit le déclencheur et le délai ou
 *    le nombre d'étapes ;
 *  · l'interrupteur de publication : la base change, l'écran suit, un double
 *    clic ou des clics répétés finissent dans un état cohérent, un refus du
 *    serveur est expliqué ;
 *  · le chevron « Stats » et ses chiffres (recoupés en base), la flèche qui
 *    déplie les messages et ses quatre variantes ;
 *  · les mentions sous le nom (avis désactivés, copie liée, échecs).
 */
import { randomUUID } from 'node:crypto';
import {
  test, expect, creerRegle, lireRegle, ouvrirListe, chercher, ligne, toast, onglet, nomsAffiches, interrupteur, attendre,
  activerClientInactif, ETAPES_TEXTO, type Bureau,
} from './_aides';

const SMS = (corps: string) => ({ type: 'send_sms', config: { body: corps } });
const COURRIEL = (objet: string, corps: string) => ({ type: 'send_email', config: { subject: objet, body: corps } });

async function journal(bureau: Bureau, org: string, ruleId: string, l: { ok: boolean; erreur?: string; saute?: string }): Promise<void> {
  const { error } = await bureau.admin.from('automation_execution_logs').insert({
    org_id: org, automation_rule_id: ruleId, trigger_event: 'lead.created', entity_type: 'lead', entity_id: randomUUID(),
    action_type: 'send_sms', result_success: l.ok, result_error: l.erreur ?? null, result_data: l.saute ? { saute: l.saute } : null,
  });
  if (error) throw new Error(`journal : ${error.message}`);
}

test.describe('statut affiché = statut en base', () => {
  test('[LST-073][LST-020][LST-022][LST-023] chaque combinaison (publiée, brouillon, modèle, supprimée, purgée) est au bon endroit avec le bon statut', async ({ page, bureau, marque }) => {
    const cle = () => `e2e_${randomUUID().slice(0, 8)}`;
    const hier = new Date(Date.now() - 86400_000).toISOString();
    const cas = {
      publiee: await creerRegle(bureau, bureau.orgA, { name: `${marque} 1 perso publiee`, is_active: true }),
      brouillon: await creerRegle(bureau, bureau.orgA, { name: `${marque} 2 perso brouillon`, is_active: false }),
      modelePublie: await creerRegle(bureau, bureau.orgA, { name: `${marque} 3 modele publie`, is_preset: true, preset_key: cle(), is_active: true }),
      modeleDepublie: await creerRegle(bureau, bureau.orgA, { name: `${marque} 4 modele depublie`, is_preset: true, preset_key: cle(), is_active: false }),
      supprimee: await creerRegle(bureau, bureau.orgA, { name: `${marque} 5 supprimee`, is_active: false, deleted_at: hier }),
      // État incohérent (supprimée mais encore « active ») : l'écran ne doit jamais la dire publiée.
      supprimeeActive: await creerRegle(bureau, bureau.orgA, { name: `${marque} 6 supprimee active`, is_active: true, deleted_at: hier }),
      purgee: await creerRegle(bureau, bureau.orgA, { name: `${marque} 7 purgee`, is_active: false, deleted_at: hier, purged_at: hier }),
    };
    await ouvrirListe(page);
    await chercher(page, marque);

    // « Toutes » : les vivantes publiées ou personnelles.
    await expect.poll(() => nomsAffiches(page)).toEqual([cas.publiee.name, cas.brouillon.name, cas.modelePublie.name]);
    await expect(ligne(page, cas.publiee.name).getByRole('cell').nth(2)).toHaveText('Publiée');
    await expect(interrupteur(page, cas.publiee.name)).toHaveAttribute('aria-checked', 'true');
    await expect(ligne(page, cas.brouillon.name).getByRole('cell').nth(2)).toHaveText('Brouillon');
    await expect(interrupteur(page, cas.brouillon.name)).toHaveAttribute('aria-checked', 'false');
    await expect(ligne(page, cas.modelePublie.name).getByRole('cell').nth(2)).toHaveText('Publiée');

    // « Prêtes à publier » (l'onglet s'appelait « Modèles ») : les automatisations fournies pas encore publiées.
    await onglet(page, 'Prêtes à publier').click();
    await expect.poll(() => nomsAffiches(page)).toEqual([cas.modeleDepublie.name]);
    await expect(ligne(page, cas.modeleDepublie.name).getByRole('cell').nth(2)).toHaveText('Brouillon');
    await expect(interrupteur(page, cas.modeleDepublie.name)).toHaveAttribute('aria-checked', 'false');

    await onglet(page, 'Corbeille').click();
    await expect.poll(() => nomsAffiches(page)).toEqual([cas.supprimee.name, cas.supprimeeActive.name]);
    for (const r of [cas.supprimee, cas.supprimeeActive]) {
      await expect(ligne(page, r.name).getByRole('cell').nth(2)).toHaveText('Supprimée');
      await expect(interrupteur(page, r.name)).toBeDisabled();
    }
    // La base dit bien ce que l'écran a montré.
    for (const r of Object.values(cas)) {
      const b = await lireRegle(bureau, r.id);
      expect({ a: b?.is_active, d: !!b?.deleted_at, p: !!b?.purged_at }).toEqual({ a: r.is_active, d: !!r.deleted_at, p: !!r.purged_at });
    }
  });

  test('[LST-073] une règle à la corbeille n’affiche jamais un interrupteur vert (allumé) @defaut', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} supprimee active`, is_active: true, deleted_at: new Date().toISOString() });
    await page.goto('/automations?onglet=corbeille');
    await expect(ligne(page, r.name)).toBeVisible({ timeout: 90_000 });
    await expect(ligne(page, r.name).getByRole('cell').nth(2)).toHaveText('Supprimée');
    // « Supprimée » à gauche, interrupteur vert « publiée » à droite : deux affirmations contraires.
    await expect(interrupteur(page, r.name)).toHaveAttribute('aria-checked', 'false', { timeout: 5_000 });
  });
});

test.describe('nom, sous-titre et mentions', () => {
  test('[LST-070] le nom ouvre l’éditeur de CETTE automatisation', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} a ouvrir` });
    await creerRegle(bureau, bureau.orgA, { name: `${marque} autre` });
    await ouvrirListe(page);
    await chercher(page, marque);
    await ligne(page, r.name).getByRole('button', { name: new RegExp(`^${r.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).click();
    await expect(page).toHaveURL(new RegExp(`/automations/${r.id}$`));
    await expect(page.getByRole('button', { name: r.name, exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('tab', { name: 'Parcours' })).toBeVisible();
  });

  test('[LST-070] le sous-titre dit le déclencheur, puis le délai ou le nombre d’étapes', async ({ page, bureau, marque }) => {
    const sousTitre: Array<[string, Record<string, unknown>, string]> = [
      ['immediat', { trigger_event: 'lead.created', delay_seconds: 0 }, 'Nouveau prospect · Immédiat'],
      ['minutes', { trigger_event: 'invoice.paid', delay_seconds: 1800 }, 'Facture payée · 30 min après'],
      ['heures', { trigger_event: 'quote.sent', delay_seconds: 7200 }, 'Devis envoyé · 2h après'],
      ['un jour', { trigger_event: 'job.completed', delay_seconds: 86400 }, 'Job terminé · 1 jour après'],
      ['jours', { trigger_event: 'job.completed', delay_seconds: 3 * 86400 }, 'Job terminé · 3 jours après'],
      ['avant', { trigger_event: 'appointment.created', delay_seconds: -86400 }, 'Rendez-vous planifié · 1 jour avant'],
      ['une etape', { steps: ETAPES_TEXTO }, 'Nouveau prospect · 1 étape'],
      ['deux etapes', { steps: [...ETAPES_TEXTO, { id: 'e2', type: 'action', action: { type: 'send_sms', config: { body: 'Rappel.' } } }] }, 'Nouveau prospect · 2 étapes'],
    ];
    for (const [n, colonnes] of sousTitre) await creerRegle(bureau, bureau.orgA, { name: `${marque} ${n}`, ...colonnes });
    await ouvrirListe(page);
    await chercher(page, marque);
    for (const [n, , attendu] of sousTitre) {
      await expect(ligne(page, `${marque} ${n}`).getByRole('cell').nth(1), n).toContainText(attendu);
    }
  });

  test('[LST-070] S-38 : un déclencheur inconnu du catalogue n’affiche pas sa clé technique @defaut', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} cle brute`, trigger_event: 'e2e.declencheur_inconnu' });
    await ouvrirListe(page);
    await chercher(page, marque);
    await expect(ligne(page, r.name)).toBeVisible();
    await expect(ligne(page, r.name)).not.toContainText('e2e.declencheur_inconnu', { timeout: 5_000 });
  });

  test('[LST-070] constat f1 n° 3 : « Anniversaire client » n’est pas calé sur la création du prospect @defaut', async ({ page }) => {
    await ouvrirListe(page);
    await chercher(page, 'Anniversaire client');
    await expect(ligne(page, 'Anniversaire client')).toBeVisible();
    // « Nouveau prospect · 12 mois après » : c'est l'anniversaire de la FICHE, pas celui du client.
    await expect(ligne(page, 'Anniversaire client').getByRole('cell').nth(1)).not.toContainText('Nouveau prospect', { timeout: 5_000 });
  });

  test('[LST-070] avis désactivés : une demande d’avis publiée porte l’avertissement « rien ne part »', async ({ page, bureau, marque }) => {
    const { data: reglages } = await bureau.admin.from('company_settings').select('review_enabled').eq('org_id', bureau.orgA).single();
    expect(reglages?.review_enabled).toBe(false);
    const publiee = await creerRegle(bureau, bureau.orgA, { name: `${marque} avis publiee`, is_active: true, trigger_event: 'job.completed', actions: [{ type: 'request_review', config: {} }] });
    const brouillon = await creerRegle(bureau, bureau.orgA, { name: `${marque} avis brouillon`, trigger_event: 'job.completed', actions: [{ type: 'request_review', config: {} }] });
    await ouvrirListe(page);
    await chercher(page, marque);
    const avertissement = 'Les demandes d’avis sont désactivées : rien ne part. Activez-les dans Paramètres › Avis clients.';
    await expect(ligne(page, publiee.name)).toContainText(avertissement);
    // Un brouillon n'envoie rien de toute façon : pas d'avertissement.
    await expect(ligne(page, brouillon.name)).not.toContainText(avertissement);
  });

  test('[LST-070] S-43 : l’avertissement d’avis mène aux réglages d’avis, pas à l’éditeur @defaut', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} avis`, is_active: true, trigger_event: 'job.completed', actions: [{ type: 'request_review', config: {} }] });
    await ouvrirListe(page);
    await chercher(page, marque);
    await ligne(page, r.name).getByText('Activez-les dans Paramètres › Avis clients.').click();
    // « Activez-les dans Paramètres › Avis clients » est dans le bouton du nom : le clic ouvre l'éditeur.
    await expect(page).toHaveURL(/\/settings/, { timeout: 10_000 });
  });

  test('[LST-071] une copie liée à un autre bureau le dit, avec l’explication au survol', async ({ page, bureau, marque }) => {
    const source = await creerRegle(bureau, bureau.orgB, { name: `${marque} source` });
    const copie = await creerRegle(bureau, bureau.orgA, { name: `${marque} copie liee`, modele_id: source.id });
    await ouvrirListe(page);
    await chercher(page, marque);
    // La source est dans l'AUTRE bureau : elle n'apparaît pas ici.
    await expect.poll(() => nomsAffiches(page)).toEqual([copie.name]);
    const mention = ligne(page, copie.name).getByText('Copie liée à un autre bureau');
    await expect(mention).toBeVisible();
    await expect(mention).toHaveAttribute('title', 'Suit l’automatisation d’un autre bureau ; la modifier ici la détache.');
  });
});

test.describe('interrupteur de publication', () => {
  test('[LST-073] publier puis repasser en brouillon : toast, statut, libellé, base, rechargement', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} a publier`, steps: ETAPES_TEXTO, actions: [] });
    await ouvrirListe(page);
    await chercher(page, marque);
    const bascule = interrupteur(page, r.name);
    await expect(bascule).toHaveAccessibleName(`Publier ${r.name}`);
    await expect(bascule).toHaveAttribute('aria-checked', 'false');

    await bascule.click();
    await expect(toast(page, 'Automatisation publiée')).toBeVisible();
    await expect(bascule).toHaveAttribute('aria-checked', 'true');
    await expect(bascule).toHaveAccessibleName(`Repasser ${r.name} en brouillon`);
    await expect(ligne(page, r.name).getByRole('cell').nth(2)).toHaveText('Publiée');
    expect((await lireRegle(bureau, r.id))?.is_active).toBe(true);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toBeVisible({ timeout: 60_000 });
    await chercher(page, marque);
    await expect(ligne(page, r.name).getByRole('cell').nth(2)).toHaveText('Publiée');

    await interrupteur(page, r.name).click();
    await expect(toast(page, 'Repassée en brouillon')).toBeVisible();
    await expect(interrupteur(page, r.name)).toHaveAttribute('aria-checked', 'false');
    await expect(ligne(page, r.name).getByRole('cell').nth(2)).toHaveText('Brouillon');
    expect((await lireRegle(bureau, r.id))?.is_active).toBe(false);
  });

  test('[LST-073] un double clic revient à l’état de départ, à l’écran comme en base', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} double clic`, steps: ETAPES_TEXTO, actions: [] });
    await ouvrirListe(page);
    await chercher(page, marque);
    await interrupteur(page, r.name).dblclick();
    await expect(toast(page, 'Repassée en brouillon')).toBeVisible();
    await expect(interrupteur(page, r.name)).toHaveAttribute('aria-checked', 'false');
    await expect(interrupteur(page, r.name)).not.toHaveAttribute('aria-busy', 'true');
    await expect(ligne(page, r.name).getByRole('cell').nth(2)).toHaveText('Brouillon');
    await attendre(async () => (await lireRegle(bureau, r.id))?.is_active, (v) => v === false, 10_000);
  });

  test('[LST-073] cinq clics rapides : jamais deux requêtes en même temps, et l’écran finit égal à la base', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} mitraille`, steps: ETAPES_TEXTO, actions: [] });
    await ouvrirListe(page);
    await chercher(page, marque);
    const requetes: string[] = [];
    let enVol = 0;
    let simultanees = 0;
    /*
     * « En même temps » se mesure AU PASSAGE de la requête : elle est comptée à son départ et décomptée quand
     * sa réponse est là, AVANT d'être rendue à la page. La page ne peut donc pas envoyer la suivante avant le
     * décompte — sauf si elle l'envoie sans attendre la réponse, ce qui est justement le défaut cherché.
     * (Avant : les événements `request` / `requestfinished` du navigateur. Relevé au tri du 2026-10-01 :
     * requête → réponse 200 → requête suivante 2 ms plus tard, l'une APRÈS l'autre, mais `requestfinished`
     * n'est jamais émis pour ces requêtes (la page ne lit pas le corps de la réponse). Le compteur ne
     * redescendait donc jamais : « 5 en même temps » pour cinq requêtes parties à la file.)
     */
    await page.route(`**/api/automations/rules/${r.id}/publication`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      requetes.push(route.request().postData() ?? '');
      enVol += 1;
      simultanees = Math.max(simultanees, enVol);
      try {
        const reponse = await route.fetch({ timeout: 60_000 });
        enVol -= 1;
        await route.fulfill({ response: reponse });
      } catch (e) {
        enVol -= 1;
        throw e;
      }
    });
    const bascule = interrupteur(page, r.name);
    for (let i = 0; i < 5; i += 1) await bascule.click({ delay: 0 });
    // Nombre impair de clics : publiée.
    await expect(toast(page, 'Automatisation publiée')).toBeVisible();
    await expect(bascule).not.toHaveAttribute('aria-busy', 'true');
    await expect(bascule).toHaveAttribute('aria-checked', 'true');
    await expect(ligne(page, r.name).getByRole('cell').nth(2)).toHaveText('Publiée');
    await attendre(async () => (await lireRegle(bureau, r.id))?.is_active, (v) => v === true, 10_000);
    // Les changements partent UN À LA FOIS (jamais deux réponses qui se croisent), et jamais plus d'un par clic.
    expect(requetes.length).toBeGreaterThanOrEqual(1);
    expect(requetes.length).toBeLessThanOrEqual(5);
    expect(simultanees).toBe(1);
    // La dernière requête partie demande bien l'état final.
    expect(JSON.parse(requetes[requetes.length - 1])).toEqual({ actif: true });
    // Un seul toast pour cette automatisation, pas une pile.
    await expect(toast(page, /Automatisation publiée|Repassée en brouillon/)).toHaveCount(1);
  });

  test('[LST-073] publication refusée par le serveur : la raison est dite, l’interrupteur revient, la base n’a pas bougé', async ({ page, bureau, marque, moniteur }) => {
    // Une automatisation sans aucune étape : elle ne fait rien, le serveur refuse de la publier.
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} vide`, actions: [], steps: [] });
    moniteur.attendu(/422 POST \/api\/automations\/rules\/[0-9a-f-]+\/publication/, 'publication d’un parcours vide refusée');
    moniteur.attendu(/\[Automations\] bascule publication/, 'journal du refus');
    await ouvrirListe(page);
    await chercher(page, marque);
    await interrupteur(page, r.name).click();
    await expect(toast(page, /^Publication refusée : .+/)).toBeVisible();
    await expect(toast(page, /Ajoutez au moins une étape/)).toBeVisible();
    await expect(interrupteur(page, r.name)).toHaveAttribute('aria-checked', 'false');
    await expect(ligne(page, r.name).getByRole('cell').nth(2)).toHaveText('Brouillon');
    await expect(toast(page, 'Automatisation publiée')).toHaveCount(0);
    expect((await lireRegle(bureau, r.id))?.is_active).toBe(false);
  });

  test('[LST-073] panne réseau pendant la bascule : message clair, retour à l’état confirmé', async ({ page, bureau, marque, moniteur }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} coupure`, steps: ETAPES_TEXTO, actions: [] });
    moniteur.attendu(/POST \/api\/automations\/rules\/[0-9a-f-]+\/publication — /, 'coupure réseau simulée');
    moniteur.attendu(/\[Automations\] bascule publication/, 'journal de la coupure');
    await ouvrirListe(page);
    await chercher(page, marque);
    await page.route('**/api/automations/rules/*/publication', (route) => route.abort('connectionfailed'));
    await interrupteur(page, r.name).click();
    await expect(toast(page, 'Connexion perdue — vérifiez votre réseau et réessayez. Rien n’a été modifié.')).toBeVisible();
    await expect(interrupteur(page, r.name)).toHaveAttribute('aria-checked', 'false');
    await expect(ligne(page, r.name).getByRole('cell').nth(2)).toHaveText('Brouillon');
    expect((await lireRegle(bureau, r.id))?.is_active).toBe(false);
  });

  test('[LST-073] une automatisation fournie dépubliée dans « Toutes » reste à sa place, puis se retrouve dans « Prêtes à publier »', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} modele`, is_preset: true, preset_key: `e2e_${randomUUID().slice(0, 8)}`, is_active: true, actions: [SMS('Bonjour.')] });
    await ouvrirListe(page);
    await chercher(page, marque);
    await interrupteur(page, r.name).click();
    await expect(toast(page, 'Repassée en brouillon')).toBeVisible();
    // La ligne ne saute pas sous la souris : elle reste, en brouillon, tant qu'on ne change pas de vue.
    await expect(ligne(page, r.name).getByRole('cell').nth(2)).toHaveText('Brouillon');
    await expect(onglet(page, 'Prêtes à publier')).toHaveText('Prêtes à publier (1)');
    await onglet(page, 'Prêtes à publier').click();
    await expect.poll(() => nomsAffiches(page)).toEqual([r.name]);
    await onglet(page, 'Toutes').click();
    await expect.poll(() => nomsAffiches(page)).toEqual([]);
    expect((await lireRegle(bureau, r.id))?.is_active).toBe(false);
  });

  test('[LST-074] « Client inactif » : publier demande confirmation avec le nombre de clients visés ; « Annuler » ne publie pas, « Activer » publie', async ({ page, bureau, marque, jetonDe, baseURL }) => {
    // La capacité vit derrière un drapeau d'entreprise, absent d'un bureau de test neuf : sans lui, pas de décompte.
    await activerClientInactif(bureau, String(baseURL), await jetonDe('proprioA'));
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} inactifs`, trigger_event: 'client.inactive', conditions: { mois: 6 }, steps: ETAPES_TEXTO, actions: [] });
    await ouvrirListe(page);
    await chercher(page, marque);
    const apercu = page.waitForResponse((rep) => rep.url().includes('/api/automations/clients-inactifs/apercu?mois=6'));
    await interrupteur(page, r.name).click();
    const reponse = await apercu;
    expect(reponse.status()).toBe(200);
    const { nombre } = (await reponse.json()) as { mois: number; nombre: number };
    expect(Number.isInteger(nombre) && nombre >= 0, `le serveur rend un nombre de clients (${nombre})`).toBe(true);
    const dialogue = page.getByRole('dialog', { name: 'Activer « Client inactif » ?' });
    await expect(dialogue).toBeVisible();
    // Le nombre affiché est CELUI du serveur, accordé.
    await expect(dialogue).toContainText(`${nombre} client${nombre > 1 ? 's' : ''} correspond${nombre > 1 ? 'ent' : ''} aujourd’hui. Les messages partiront par petits lots, en journée.`);
    await dialogue.getByRole('button', { name: 'Annuler' }).click();
    await expect(dialogue).toHaveCount(0);
    await expect(interrupteur(page, r.name)).toHaveAttribute('aria-checked', 'false');
    expect((await lireRegle(bureau, r.id))?.is_active).toBe(false);

    await interrupteur(page, r.name).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Activer' }).click();
    await expect(toast(page, 'Automatisation publiée')).toBeVisible();
    await expect(interrupteur(page, r.name)).toHaveAttribute('aria-checked', 'true');
    expect((await lireRegle(bureau, r.id))?.is_active).toBe(true);
    // Dépublier ne demande rien.
    await interrupteur(page, r.name).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(toast(page, 'Repassée en brouillon')).toBeVisible();
  });

  test('[LST-074] S-23 : pendant le décompte des clients inactifs, l’interrupteur montre qu’il travaille @defaut', async ({ page, bureau, marque, jetonDe, baseURL }) => {
    await activerClientInactif(bureau, String(baseURL), await jetonDe('proprioA'));
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} inactifs`, trigger_event: 'client.inactive', conditions: { mois: 6 }, steps: ETAPES_TEXTO, actions: [] });
    let liberer: () => void = () => undefined;
    const barriere = new Promise<void>((ok) => { liberer = ok; });
    await page.route('**/api/automations/clients-inactifs/apercu*', async (route) => { await barriere; await route.continue(); });
    await ouvrirListe(page);
    await chercher(page, marque);
    await interrupteur(page, r.name).click();
    try {
      // Le clic ne produit RIEN de visible tant que le serveur compte : on croit que ça n'a pas marché.
      await expect(interrupteur(page, r.name)).toHaveAttribute('aria-busy', 'true', { timeout: 5_000 });
    } finally {
      liberer();
      await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click();
    }
  });
});

test.describe('chevron « Stats »', () => {
  test('[LST-072] le panneau donne les chiffres des 60 derniers jours, ceux de la base ; un seul panneau ouvert à la fois', async ({ page, bureau, marque }) => {
    const a = await creerRegle(bureau, bureau.orgA, { name: `${marque} A chiffree`, is_active: true });
    const b = await creerRegle(bureau, bureau.orgA, { name: `${marque} B vierge` });
    await journal(bureau, bureau.orgA, a.id, { ok: true });
    await journal(bureau, bureau.orgA, a.id, { ok: true });
    await journal(bureau, bureau.orgA, a.id, { ok: true, saute: 'Ce client n’a pas de numéro de téléphone.' });
    await journal(bureau, bureau.orgA, a.id, { ok: false, erreur: 'No recipient phone' });
    await bureau.admin.from('automation_scheduled_tasks').insert({
      org_id: bureau.orgA, automation_rule_id: a.id, entity_type: 'lead', entity_id: randomUUID(), action_config: {},
      execute_at: '2099-01-01T00:00:00Z', status: 'pending', execution_key: `e2e-${randomUUID()}`,
    });
    await ouvrirListe(page);
    await chercher(page, marque);
    // Colonnes : 5 fiches distinctes déclenchées, 1 en cours.
    await expect(ligne(page, a.name).getByRole('cell').nth(3)).toHaveText('5');
    await expect(ligne(page, a.name).getByRole('cell').nth(4)).toHaveText('1');

    const chevronA = page.getByRole('button', { name: `Statistiques de ${a.name}` });
    const chevronB = page.getByRole('button', { name: `Statistiques de ${b.name}` });
    await expect(chevronA).toHaveAttribute('aria-expanded', 'false');
    await chevronA.click();
    await expect(chevronA).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('60 derniers jours : 5 déclenchement(s), 2 envoi(s), 1 étape(s) sautée(s), 1 échec(s). 1 en cours.')).toBeVisible();
    await expect(page.getByText('Dernier échec : Ce client n’a pas de numéro de téléphone.')).toBeVisible();
    await expect(page.getByText('Dernière étape sautée : Ce client n’a pas de numéro de téléphone.')).toBeVisible();
    await expect(page.getByText('Le détail est dans l’onglet « Journaux » de l’automatisation.')).toBeVisible();

    await chevronB.click();
    await expect(chevronB).toHaveAttribute('aria-expanded', 'true');
    await expect(chevronA).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('60 derniers jours : 0 déclenchement(s), 0 envoi(s), 0 étape(s) sautée(s), 0 échec(s). 0 en cours.')).toBeVisible();
    await expect(page.getByText(/60 derniers jours/)).toHaveCount(1);
    await chevronB.click();
    await expect(chevronB).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText(/60 derniers jours/)).toHaveCount(0);
  });

  test('[LST-072] statistiques illisibles : « — » dans les colonnes et « Les chiffres n’ont pas pu être lus. »', async ({ page, bureau, marque, moniteur }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} sans chiffres` });
    moniteur.attendu(/500 GET \/api\/automations\/rules\/stats/, 'panne simulée des statistiques');
    moniteur.attendu(/\[automations\] statistiques illisibles/, 'journal de la panne');
    await page.route('**/api/automations/rules/stats*', (route) => route.fulfill({
      status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Impossible de lire les statistiques des automatisations.' }),
    }));
    await ouvrirListe(page);
    await chercher(page, marque);
    // Un tiret, pas un faux zéro.
    await expect(ligne(page, r.name).getByRole('cell').nth(3)).toHaveText('—');
    await expect(ligne(page, r.name).getByRole('cell').nth(4)).toHaveText('—');
    await page.getByRole('button', { name: `Statistiques de ${r.name}` }).click();
    await expect(page.getByText('Les chiffres n’ont pas pu être lus.')).toBeVisible();
  });

  test('[LST-072] S-43 : le panneau de stats mène aux « Journaux » par un lien @defaut', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} journaux` });
    await ouvrirListe(page);
    await chercher(page, marque);
    await page.getByRole('button', { name: `Statistiques de ${r.name}` }).click();
    await expect(page.getByText('Le détail est dans l’onglet « Journaux » de l’automatisation.')).toBeVisible();
    // Le texte renvoie à un onglet sans y mener.
    await expect(page.getByRole('link', { name: /Journaux/ }).or(page.getByRole('button', { name: /Journaux/ }))).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('flèche des messages', () => {
  test('[LST-075][LST-086] parcours à étapes : aperçu en lecture seule et « Modifier dans l’éditeur »', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, {
      name: `${marque} parcours`, actions: [],
      steps: [
        { id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Merci de votre visite.' } }, suivant: 'e2' },
        { id: 'e2', type: 'attendre', delai_secondes: 3600, suivant: 'e3' },
        { id: 'e3', type: 'action', action: { type: 'send_email', config: { subject: 'Votre devis', body: '<p>Bonjour,</p><p>Voici votre devis.</p>' } } },
      ],
    });
    await ouvrirListe(page);
    await chercher(page, marque);
    const fleche = page.getByRole('button', { name: `Voir les messages de ${r.name}` });
    await expect(fleche).toHaveAttribute('aria-expanded', 'false');
    await fleche.click();
    await expect(fleche).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('Texto envoyé au client')).toBeVisible();
    await expect(page.getByText('Merci de votre visite.')).toBeVisible();
    await expect(page.getByText('Courriel envoyé au client')).toBeVisible();
    await expect(page.getByText('Votre devis', { exact: true })).toBeVisible();
    // Le courriel est montré sans ses balises.
    await expect(page.getByText('Bonjour, Voici votre devis.')).toBeVisible();
    // Lecture seule : aucun champ à modifier ici.
    await expect(page.getByRole('table').getByRole('textbox')).toHaveCount(0);
    await page.getByRole('button', { name: 'Modifier dans l’éditeur' }).click();
    await expect(page).toHaveURL(new RegExp(`/automations/${r.id}$`));
  });

  test('[LST-075][LST-086] parcours sans envoi, ancien format sans envoi : l’écran le dit', async ({ page, bureau, marque }) => {
    const parcours = await creerRegle(bureau, bureau.orgA, { name: `${marque} A parcours muet`, actions: [], steps: [{ id: 'e1', type: 'action', action: { type: 'create_task', config: { title: 'Rappeler' } } }] });
    const ancien = await creerRegle(bureau, bureau.orgA, { name: `${marque} B ancien muet`, actions: [{ type: 'create_notification', config: {} }] });
    await ouvrirListe(page);
    await chercher(page, marque);
    await page.getByRole('button', { name: `Voir les messages de ${parcours.name}` }).click();
    await expect(page.getByText('Ce parcours n’envoie ni texto ni courriel.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Modifier dans l’éditeur' })).toBeVisible();
    // Un seul panneau de messages à la fois.
    await page.getByRole('button', { name: `Voir les messages de ${ancien.name}` }).click();
    await expect(page.getByText('Cette automatisation n’envoie ni texto ni courriel.')).toBeVisible();
    await expect(page.getByText('Ce parcours n’envoie ni texto ni courriel.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Voir les messages de ${parcours.name}` })).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: `Voir les messages de ${ancien.name}` }).click();
    await expect(page.getByText('Cette automatisation n’envoie ni texto ni courriel.')).toHaveCount(0);
  });

  test('[LST-075] ancien format : le texto se modifie sur place — toast, panneau toujours ouvert, base à jour', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} ancien`, actions: [SMS('Bonjour [client_first_name], merci !'), COURRIEL('Merci', '<p>Merci de votre confiance.</p>')] });
    await ouvrirListe(page);
    await chercher(page, marque);
    await page.getByRole('button', { name: `Voir les messages de ${r.name}` }).click();
    const zone = page.getByRole('table').getByRole('textbox').first();
    await expect(zone).toHaveValue('Bonjour [client_first_name], merci !');
    await expect(page.getByRole('button', { name: 'Modifier', exact: true })).toBeVisible();
    // Sous le champ, ce que le client LIRA : la variable est remplacée par un exemple.
    const lira = page.getByText('Le client lira :').locator('xpath=following-sibling::span[1]');
    await expect(lira).toHaveText(/^Bonjour .+, merci !$/);
    await expect(lira).not.toContainText('[');
    await zone.fill('Bonjour [client_first_name], à bientôt !');
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(toast(page, 'Message enregistré')).toBeVisible();
    await attendre(async () => (await lireRegle(bureau, r.id))?.actions?.[0]?.config?.body, (v) => v === 'Bonjour [client_first_name], à bientôt !', 10_000);
    // Le courriel de la même règle n'a pas bougé.
    expect((await lireRegle(bureau, r.id))?.actions?.[1]?.config).toEqual({ subject: 'Merci', body: '<p>Merci de votre confiance.</p>' });
    // S-18 : la liste se recharge après l'enregistrement — le panneau doit rester ouvert, avec le nouveau texte.
    await expect(page.getByRole('table').getByRole('textbox').first()).toHaveValue('Bonjour [client_first_name], à bientôt !');
    await expect(page.getByRole('button', { name: `Voir les messages de ${r.name}` })).toHaveAttribute('aria-expanded', 'true');
  });

  test('[LST-075] S-32 : modifier UN texto ne réécrit pas les autres textos de la même automatisation @defaut', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} deux textos`, actions: [SMS('Premier message.'), SMS('Second message, différent.')] });
    await ouvrirListe(page);
    await chercher(page, marque);
    await page.getByRole('button', { name: `Voir les messages de ${r.name}` }).click();
    const zones = page.getByRole('table').getByRole('textbox');
    await expect(zones).toHaveCount(2);
    await zones.first().fill('Premier message, corrigé.');
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).first().click();
    await expect(toast(page, 'Message enregistré')).toBeVisible();
    const apres = await attendre(() => lireRegle(bureau, r.id), (v) => v?.actions?.[0]?.config?.body === 'Premier message, corrigé.', 10_000);
    // Le second texto, que personne n'a touché, doit garder son texte.
    expect(apres?.actions?.[1]?.config?.body).toBe('Second message, différent.');
  });

  test('[LST-075] S-47 / constat f1 n° 1 : texto et courriel sont montrés de la même façon (variables remplacées par un exemple)', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, {
      name: `${marque} variables`, actions: [],
      steps: [
        { id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name], votre rendez-vous approche.' } } },
        { id: 'e2', type: 'action', action: { type: 'send_email', config: { subject: 'Rappel pour [client_first_name]', body: '<p>Bonjour [client_first_name]</p>' } } },
      ],
    });
    await ouvrirListe(page);
    await chercher(page, marque);
    await page.getByRole('button', { name: `Voir les messages de ${r.name}` }).click();
    await expect(page.getByText('Texto envoyé au client')).toBeVisible();
    // L'aperçu d'un message montre ce que le client LIRA : pas la variable entre crochets.
    await expect(page.getByRole('table').getByText('[client_first_name]')).toHaveCount(0, { timeout: 5_000 });
  });

  test('[LST-075] S-36 : le même envoi porte le même nom partout (« Texto », pas « SMS » ici et « Texto » là)', async ({ page, bureau, marque }) => {
    const ancien = await creerRegle(bureau, bureau.orgA, { name: `${marque} A ancien`, actions: [SMS('Bonjour.')] });
    await ouvrirListe(page);
    await chercher(page, marque);
    await page.getByRole('button', { name: `Voir les messages de ${ancien.name}` }).click();
    await expect(page.getByRole('table').getByRole('textbox')).toHaveCount(1);
    // Le bandeau du haut dit « étapes texto », l'aperçu d'un parcours « Texto envoyé au client »… et ici « SMS envoyé au client ».
    await expect(page.getByText('SMS envoyé au client')).toHaveCount(0, { timeout: 5_000 });
  });
});
