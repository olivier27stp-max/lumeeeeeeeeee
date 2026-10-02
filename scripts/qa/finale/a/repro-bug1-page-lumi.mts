/**
 * Bug n° 1, chemin (b) AU VRAI NAVIGATEUR : la page `/lumi` (clavardage général), vrai modèle.
 *
 *   QA_AUTO_SUFFIXE=a npx tsx --env-file=.env.local scripts/qa/finale/a/repro-bug1-page-lumi.mts
 *
 * Deux onglets, comme un propriétaire qui garde son automatisation ouverte :
 *   onglet 1 : l'éditeur de l'automatisation « Facture en retard » (texto d'exemple) ;
 *   onglet 2 : `/lumi` — « change le texto de l'automatisation … » → carte → « Confirmer ».
 * Relevés : la carte (ce qu'elle montre avant le clic), la phrase après le clic, la base
 * (`steps`, `actions`), puis ce que l'ÉDITEUR resté ouvert montre sans recharger, ce qu'il fait
 * d'une modification locale ensuite, et ce qu'il montre après rechargement.
 * Sortie : D:/lume-final/sorties/a/repro-bug1-page-lumi.json
 */
import { admin, bureauA, capturer, depenseDepuis, ecrireSortie, fermerNavigateur, lireRegle, marque, messagesDe, nettoyerDepuis, ouvrirOnglet, APP } from './outils.mts';

const b = await bureauA();
const debut = new Date().toISOString();
const M = marque('page-lumi');
const NOM = `Relance facture en retard ${M}`;
const trace: Array<Record<string, unknown>> = [];
const noter = (etape: string, d: Record<string, unknown>) => { trace.push({ etape, ...d }); console.log(`\n── ${etape}\n${JSON.stringify(d, null, 1).slice(0, 2600)}`); };

const { data: regle, error } = await admin.from('automation_rules').insert({
  org_id: b.orgA, name: NOM, trigger_event: 'invoice.overdue', conditions: {}, delay_seconds: 0, is_active: false,
  actions: [{ type: 'send_sms', config: { body: 'À compléter' } }],
  steps: [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_name], c’est [company_name]. Merci !' } }, suivant: null }],
}).select('id').single();
if (error) throw new Error(error.message);
const id = regle.id as string;
const base = async () => { const r = await lireRegle(id); return { ...messagesDe(r), nb_steps: r.steps?.length ?? 0, updated_at: r.updated_at }; };
const cartes = async (page: import('@playwright/test').Page) => (await page.locator('div.relative.w-\\[260px\\]').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());

const editeur = await ouvrirOnglet();
const lumi = await ouvrirOnglet();
try {
  // Onglet 1 : l'éditeur, ouvert et laissé tel quel.
  await editeur.page.goto(`${APP}/automations/${id}`);
  await editeur.page.getByRole('tab', { name: 'Parcours' }).waitFor({ timeout: 120_000 });
  await editeur.page.waitForTimeout(1500);
  noter('1. éditeur ouvert (onglet 1)', { cartes: await cartes(editeur.page), base: await base() });

  // Onglet 2 : /lumi.
  await lumi.page.goto(`${APP}/lumi`);
  const champ = lumi.page.locator('textarea').first();
  await champ.waitFor({ timeout: 120_000 });
  const demande = `dans l’automatisation « ${NOM} », remplace le texto par un rappel poli avec le lien de paiement de la facture`;
  await champ.fill(demande);
  await champ.press('Enter');
  const confirmer = lumi.page.getByRole('button', { name: 'Confirmer', exact: true });
  await confirmer.waitFor({ timeout: 90_000 });
  const texteCarte = ((await lumi.page.locator('.lumi-msg').last().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').slice(0, 1200);
  await capturer(lumi.page, 'page-lumi-carte');
  noter('2. /lumi — la carte avant le clic', { demande, carte: texteCarte, base_avant_le_clic: await base() });

  await confirmer.click();
  await lumi.page.getByText(/C'est fait|C’est fait|déjà fait|n’a pas fonctionné/).first().waitFor({ timeout: 60_000 }).catch(() => undefined);
  await lumi.page.waitForTimeout(1200);
  const messagesLumi = (await lumi.page.locator('.lumi-msg').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim().slice(0, 500));
  await capturer(lumi.page, 'page-lumi-apres-confirmer');
  noter('3. /lumi — après « Confirmer »', { derniers_messages: messagesLumi.slice(-2), base: await base() });

  // Onglet 1, SANS recharger : l'éditeur ne sait rien.
  await editeur.page.bringToFront();
  await editeur.page.waitForTimeout(4000);
  noter('4. éditeur resté ouvert, SANS recharger', { cartes: await cartes(editeur.page), base: await base() });
  await capturer(editeur.page, 'page-lumi-editeur-sans-recharger');

  // … et le propriétaire y fait une autre modification (une attente ajoutée) : l'enregistrement automatique part.
  await editeur.page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  const tiroir = editeur.page.getByRole('complementary', { name: 'Actions' });
  await tiroir.waitFor();
  await tiroir.getByRole('searchbox').fill('Notifier l’équipe');
  await tiroir.getByRole('button', { name: /^Notifier l’équipe/ }).first().click();
  const panneau = editeur.page.getByRole('complementary', { name: 'Modifier l’étape' });
  await panneau.waitFor();
  await panneau.getByRole('button', { name: 'Enregistrer' }).click();
  await panneau.waitFor({ state: 'hidden' }).catch(() => undefined);
  await editeur.page.waitForTimeout(9000);
  noter('5. éditeur : une étape « Notifier l’équipe » ajoutée ensuite (enregistrement automatique)', { cartes: await cartes(editeur.page), indicateur: (await editeur.page.locator('header span.text-xs').last().textContent().catch(() => ''))?.trim(), toasts: await editeur.page.locator('[data-sonner-toast]').allTextContents(), base: await base() });

  await editeur.page.reload();
  await editeur.page.getByRole('tab', { name: 'Parcours' }).waitFor({ timeout: 120_000 });
  await editeur.page.waitForTimeout(1500);
  noter('6. éditeur APRÈS rechargement', { cartes: await cartes(editeur.page), base: await base() });
  noter('coût', await depenseDepuis(b.orgA, debut));
} finally {
  console.log('sortie :', ecrireSortie('repro-bug1-page-lumi.json', trace));
  await editeur.fermer(); await lumi.fermer();
  await fermerNavigateur();
  if (!process.env.QA_A_GARDER) await nettoyerDepuis(debut);
}
