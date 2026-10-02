/**
 * Vérifications au vrai navigateur des corrections de l'agent T — une par ligne
 * du triage `modeles.md`. Voir `banc.mts`. Pile LOCALE seulement.
 *
 *   QA_AUTO_SUFFIXE=t npx tsx --env-file=.env.local scripts/qa/finale/t/verifier.mts <scénario…>
 *   (sans argument : tous les scénarios)
 */
import type { Page } from '@playwright/test';
import {
  CAPTURES, creerRegle, deplierMessages, editeurCourriel, fermer, langueDuBureau, lireRegle, ouvrirListe, ouvrirPage, supprimerRegle, verifier,
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

  /** 04-courriel:834 — bureau en anglais : l'éditeur montre et modifie la version anglaise, celle qui part. */
  async courriel834() {
    const config = {
      subject: 'Votre rendez-vous', subject_en: 'Your appointment',
      body: `${ENVELOPPE}${H2('Bonjour,')}${P('À demain.')}</div>`,
      body_en: `${ENVELOPPE}${H2('Hello,')}${P('See you tomorrow.')}</div>`,
    };
    const r = await regle('bureau-anglais', [{ type: 'send_email', config }]);
    const page = await ouvrirPage();
    try {
      await langueDuBureau('en');
      await ouvrirListe(page);
      await deplierMessages(page, r.nom);
      await page.getByRole('button', { name: 'Modifier', exact: true }).first().click();
      await objet(page).waitFor();
      verifier(await objet(page).inputValue() === 'Your appointment', 'l’éditeur s’ouvre sur l’objet ANGLAIS, celui qui part');
      const anglais = editeurCourriel(page).getByRole('button', { name: /^Version anglaise/ });
      verifier(await anglais.getAttribute('aria-pressed') === 'true', 'la version anglaise est la version affichée');
      verifier((await anglais.innerText()).includes('celle qui part'), 'l’écran dit que c’est la version anglaise qui part');
      await page.screenshot({ path: `${CAPTURES}/courriel834-anglais.png` });
      await objet(page).fill('Your appointment tomorrow');
      await enregistrerCourriel(page).click();
      await page.getByText('Courriel enregistré').waitFor();
      const [a] = await actions(r.id);
      verifier(a.config.subject_en === 'Your appointment tomorrow', 'la base : subject_en porte la correction');
      verifier(a.config.subject === 'Votre rendez-vous' && a.config.body === config.body && a.config.body_en === config.body_en, 'la base : le français et le corps anglais n’ont pas bougé');
      // La version française reste à un clic, et la corriger seule demande de revoir l'anglais.
      await page.getByRole('button', { name: 'Modifier', exact: true }).first().click();
      await objet(page).waitFor();
      await editeurCourriel(page).getByRole('button', { name: /^Version française/ }).click();
      verifier(await objet(page).inputValue() === 'Votre rendez-vous', 'la version française se lit à un clic');
      await objet(page).fill('Votre rendez-vous de demain');
      await page.getByText('Le texte français a changé, pas sa version anglaise.').waitFor();
      verifier(await enregistrerCourriel(page).isDisabled(), '« Enregistrer » attend qu’on revoie la version anglaise');
      await page.getByLabel('La version anglaise reste valable telle quelle').check();
      verifier(await enregistrerCourriel(page).isEnabled(), 'une fois confirmée, on peut enregistrer');
      await page.screenshot({ path: `${CAPTURES}/courriel834-francais-a-revoir.png` });
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
