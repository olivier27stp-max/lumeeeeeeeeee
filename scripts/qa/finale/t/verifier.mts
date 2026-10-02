/**
 * Vérifications au vrai navigateur des corrections de l'agent T — une par ligne
 * du triage `modeles.md`. Voir `banc.mts`. Pile LOCALE seulement.
 *
 *   QA_AUTO_SUFFIXE=t npx tsx --env-file=.env.local scripts/qa/finale/t/verifier.mts <scénario…>
 *   (sans argument : tous les scénarios)
 */
import type { Page } from '@playwright/test';
import {
  BASE, CAPTURES, creerRegle, deplierMessages, editeurCourriel, fermer, langueDuBureau, lireRegle, ouvrirListe, ouvrirPage, supprimerRegle, verifier,
} from './banc.mts';

type Action = { type: string; config: Record<string, unknown> };
const actions = async (id: string): Promise<Action[]> => ((await lireRegle(id)).actions ?? []) as Action[];

/** Égalité de deux objets simples, sans tenir compte de l'ordre des clés (jsonb les réordonne). */
const trie = (o: unknown): string => JSON.stringify(o, (_c, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
const pareil = (a: unknown, b: unknown): boolean => trie(a) === trie(b);

const ENVELOPPE = '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">';
const P = (t: string) => `<p style="color:#333;line-height:1.6;">${t}</p>`;
const H2 = (t: string) => `<h2 style="color:#1a1a1a;font-size:18px;">${t}</h2>`;
const OBJET = 'Votre rendez-vous du [appointment_date]';
const CORPS = `${ENVELOPPE}${H2('Votre rendez-vous approche')}${P('Bonjour [client_first_name],')}${P('Nous serons chez vous le [appointment_date].')}${P('Merci, [company_name]')}</div>`;

const objet = (page: Page) => page.getByRole('textbox', { name: /^(Objet du courriel|Email subject)$/ });
const enregistrerCourriel = (page: Page) => editeurCourriel(page).getByRole('button', { name: /^(Enregistrer|Save)$/ });

/** Crée une règle à plat (ancien format) au nom unique, et rend son nom pour la chercher dans la liste. */
async function regle(nom: string, liste: Action[], plus: Record<string, unknown> = {}): Promise<{ id: string; nom: string }> {
  const marque = `T-${nom}-${Date.now()}`;
  const r = await creerRegle({ name: marque, trigger_event: 'appointment.created', actions: liste, steps: null, ...plus });
  return { id: r.id, nom: marque };
}

const SCENARIOS: Record<string, () => Promise<void>> = {
  /** 04-courriel:816 — deux courriels : modifier le premier ne touche pas au second. */
  async courriel816() {
    const c2 = { subject: 'Second objet', body: `${ENVELOPPE}${H2('Second courriel')}${P('Texte du second.')}</div>` };
    const r = await regle('deux-courriels', [{ type: 'send_email', config: { subject: OBJET, body: CORPS } }, { type: 'send_email', config: c2 }]);
    const page = await ouvrirPage();
    try {
      await ouvrirListe(page);
      await deplierMessages(page, r.nom);
      await page.getByRole('button', { name: 'Modifier', exact: true }).first().click();
      await objet(page).fill('Premier objet corrigé');
      await enregistrerCourriel(page).click();
      await page.getByText('Courriel enregistré').waitFor();
      const a = await actions(r.id);
      verifier(a[0].config.subject === 'Premier objet corrigé', 'le premier courriel porte le nouvel objet');
      verifier(pareil(a[1].config, c2), 'le second courriel a gardé son objet ET son corps');
      await page.screenshot({ path: `${CAPTURES}/courriel816.png` });
    } finally {
      await page.context().close();
      await supprimerRegle(r.id);
    }
  },

  /**
   * 04-courriel:834 et la règle des deux langues (2026-10-01) — bureau en
   * anglais : l'éditeur montre et modifie le courriel anglais, celui qui part ;
   * le français est dans un bloc replié ; corriger l'anglais seul ne bloque
   * rien et offre de retirer le français (d'office) ou de le garder.
   */
  async courriel834() {
    const config = {
      subject: 'Votre rendez-vous', subject_en: 'Your appointment',
      body: `${ENVELOPPE}${H2('Bonjour,')}${P('À demain.')}</div>`,
      body_en: `${ENVELOPPE}${H2('Hello,')}${P('See you tomorrow.')}</div>`,
    };
    const r = await regle('bureau-anglais', [{ type: 'send_email', config }]);
    const page = await ouvrirPage();
    const blocFrancais = () => editeurCourriel(page).getByRole('button', { name: 'Version française — utilisée seulement si vos messages partent en français' });
    const ouvrirEditeur = async () => {
      await ouvrirListe(page);
      await deplierMessages(page, r.nom);
      await page.getByRole('button', { name: 'Modifier', exact: true }).first().click();
      await objet(page).waitFor();
    };
    try {
      await langueDuBureau('en');
      await ouvrirEditeur();
      verifier(await objet(page).inputValue() === 'Your appointment', 'l’éditeur s’ouvre sur l’objet ANGLAIS, celui qui part');
      verifier(await editeurCourriel(page).getByText('Vos messages partent en anglais : c’est ce texte que vos clients reçoivent.').count() === 1, 'l’écran dit que les messages partent en anglais');
      verifier(await blocFrancais().getAttribute('aria-expanded') === 'false', 'le français est dans un bloc REPLIÉ');
      await page.screenshot({ path: `${CAPTURES}/courriel834-anglais.png` });

      // Corriger l'anglais seul : rien n'est bloqué, le bloc se déplie et offre le choix.
      await objet(page).fill('Your appointment tomorrow');
      await editeurCourriel(page).getByText('Cette version n’est plus à jour.').waitFor();
      verifier(await blocFrancais().getAttribute('aria-expanded') === 'true', 'le bloc du français se déplie de lui-même');
      verifier(await page.getByLabel('La retirer (vos clients recevront le texte ci-dessus)').isChecked(), '« La retirer » est coché d’office');
      verifier(await enregistrerCourriel(page).isEnabled(), '« Enregistrer » n’attend rien');
      await page.screenshot({ path: `${CAPTURES}/courriel834-autre-perimee.png` });

      // « La garder telle quelle » : l'anglais est écrit, le français ne bouge pas.
      await page.getByLabel('La garder telle quelle').check();
      await enregistrerCourriel(page).click();
      await page.getByText('Courriel enregistré').waitFor();
      let [a] = await actions(r.id);
      verifier(a.config.subject_en === 'Your appointment tomorrow', '« La garder » : subject_en porte la correction');
      verifier(a.config.subject === 'Votre rendez-vous' && a.config.body === config.body && a.config.body_en === config.body_en, '« La garder » : le français et le corps anglais n’ont pas bougé');

      // « La retirer » (d'office) : le courriel n'a plus qu'un texte — l'anglais.
      await ouvrirEditeur();
      await objet(page).fill('Your appointment on Thursday');
      await editeurCourriel(page).getByText('Cette version n’est plus à jour.').waitFor();
      await enregistrerCourriel(page).click();
      await page.getByText('Courriel enregistré').waitFor();
      [a] = await actions(r.id);
      verifier(a.config.subject === 'Your appointment on Thursday' && a.config.body === config.body_en, '« La retirer » : le texte anglais est devenu LE texte du courriel');
      verifier(!('body_en' in a.config) && !('subject_en' in a.config), '« La retirer » : plus de version anglaise à part (pas de `body_en: ""`)');
    } finally {
      await langueDuBureau('fr');
      await page.context().close();
      await supprimerRegle(r.id);
    }
  },

  /** 04-courriel:725 — dans l'aperçu réel, [company_name] est le nom du bureau courant. */
  async courriel725() {
    const r = await regle('nom-bureau', [{ type: 'send_email', config: { subject: OBJET, body: CORPS } }]);
    const page = await ouvrirPage();
    try {
      await ouvrirListe(page);
      await deplierMessages(page, r.nom);
      await page.getByRole('button', { name: 'Modifier', exact: true }).first().click();
      await editeurCourriel(page).getByRole('button', { name: 'Aperçu réel' }).click();
      const cadre = page.frameLocator('iframe[title="Aperçu du courriel"]');
      await cadre.getByRole('heading', { name: 'Votre rendez-vous approche', exact: true }).waitFor();
      verifier(await cadre.getByText('Merci, Nettoyage Test A', { exact: true }).count() === 1, 'l’aperçu finit par « Merci, Nettoyage Test A » — le nom de MON bureau');
      verifier(await cadre.getByText(/Coquin lavage|Votre entreprise/).count() === 0, 'ni le nom d’un autre bureau, ni l’exemple neutre');
      await editeurCourriel(page).locator('iframe').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${CAPTURES}/courriel725.png` });
    } finally {
      await page.context().close();
      await supprimerRegle(r.id);
    }
  },

  /** 04-courriel:394 et :410 — ce qu'on n'a pas touché garde son lien, son gras et son type. */
  async courriel394() {
    const corps = `${ENVELOPPE}${H2('Bonjour [client_first_name],')}${P('On vous a envoyé une soumission hier.')}${P('<strong>Offre valable 30 jours.</strong>')}<p style="color:#333;line-height:1.6;"><a href="[quote_link]">Voir votre soumission</a></p>${P('Merci, [company_name]')}</div>`;
    const r = await regle('lien-gras', [{ type: 'send_email', config: { subject: 'Votre soumission', body: corps } }]);
    const sansTitre = `${ENVELOPPE}${P('Bonjour [client_first_name],')}${P('Votre facture est prête.')}</div>`;
    const r2 = await regle('sans-titre', [{ type: 'send_email', config: { subject: 'Votre facture', body: sansTitre } }]);
    const page = await ouvrirPage();
    const blocs = () => editeurCourriel(page).getByRole('textbox', { name: /^(Titre|Paragraphe|Puce)$/ });
    try {
      await ouvrirListe(page);
      await deplierMessages(page, r.nom);
      await page.getByRole('button', { name: 'Modifier', exact: true }).first().click();
      await blocs().nth(1).fill('On vous a envoyé une soumission avant-hier.');
      await enregistrerCourriel(page).click();
      await page.getByText('Courriel enregistré').waitFor();
      const enBase = String((await actions(r.id))[0].config.body);
      verifier(enBase.includes('avant-hier'), 'la correction est en base');
      verifier(enBase.includes('<a href="[quote_link]">Voir votre soumission</a>'), 'le lien « Voir votre soumission » est resté un lien');
      verifier(enBase.includes('<strong>Offre valable 30 jours.</strong>'), 'le gras est resté');
      verifier(enBase === corps.replace('soumission hier.', 'soumission avant-hier.'), 'rien d’autre n’a bougé dans le courriel');

      await ouvrirListe(page);
      await deplierMessages(page, r2.nom);
      await page.getByRole('button', { name: 'Modifier', exact: true }).first().click();
      await blocs().nth(1).fill('Votre facture est prête, merci!');
      await enregistrerCourriel(page).click();
      await page.getByText('Courriel enregistré').waitFor();
      const enBase2 = String((await actions(r2.id))[0].config.body);
      verifier(enBase2.includes('merci!') && !/<h2[^>]*>Bonjour/.test(enBase2), 'le premier paragraphe est resté un paragraphe (pas un titre)');
    } finally {
      await page.context().close();
      await supprimerRegle(r.id);
      await supprimerRegle(r2.id);
    }
  },

  /**
   * 02-chaque-modele:131 — le canevas de « Relance de devis » : une carte par étape.
   * ROUGE tant que le patch `T-a-reporter/SequenceCanvas.patch` n'est pas appliqué (fichier hors zone).
   */
  async canevas131() {
    const { trouverModele } = await import('../../../../server/lib/automationTemplates');
    const modele = trouverModele('pack_relance_devis');
    if (!modele?.steps) throw new Error('modèle pack_relance_devis introuvable');
    const r = await creerRegle({ name: `T-canevas-${Date.now()}`, trigger_event: modele.declencheur, steps: modele.steps, actions: modele.actions });
    const page = await ouvrirPage();
    try {
      await page.goto(`${BASE}/automations/${r.id}`);
      await page.getByRole('button', { name: /^(Quand|When)/ }).first().waitFor({ timeout: 120_000 });
      const cartes = await page.getByRole('button', { name: /^Options de l’étape / }).count();
      await page.screenshot({ path: `${CAPTURES}/canevas131.png`, fullPage: true });
      verifier(cartes === modele.steps.length, `${cartes} cartes pour ${modele.steps.length} étapes`);
    } finally {
      await page.context().close();
      await supprimerRegle(r.id);
    }
  },
};

const demandes = process.argv.slice(2);
const noms = demandes.length ? demandes : Object.keys(SCENARIOS);
let echecs = 0;
for (const nom of noms) {
  const scenario = SCENARIOS[nom];
  if (!scenario) { console.error(`scénario inconnu : ${nom}`); echecs += 1; continue; }
  console.log(`\n== ${nom}`);
  try { await scenario(); console.log(`== ${nom} : OK`); } catch (e) { echecs += 1; console.error(`== ${nom} : ${e instanceof Error ? e.message : String(e)}`); }
}
await fermer();
process.exit(echecs ? 1 : 0);
