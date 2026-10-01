/**
 * Vérifications au vrai navigateur des corrections de l'agent U — une par
 * ligne du triage `actions.md`. Voir `banc.mts`.
 *
 *   QA_AUTO_SUFFIXE=u npx tsx --env-file=.env.local scripts/qa/finale/u/verifier.mts l1 l4 …
 *   (sans argument : tous les scénarios)
 */
import type { Page } from '@playwright/test';
import { carte, creerRegle, fermer, lireRegle, ouvrirEditeur, ouvrirPage, panneau, pause, tiroir, verifier } from './banc.mts';

type Etapes = Array<{ id: string; action?: { config?: Record<string, unknown> } } & Record<string, unknown>>;
const etapes = async (id: string): Promise<Etapes> => ((await lireRegle(id)).steps ?? []) as Etapes;
const enregistrer = (page: Page) => panneau(page).getByRole('button', { name: /^(Enregistrer|Save|Save action)$/ });
const action = (type: string, config: Record<string, unknown>, id = 'e1', suivant: string | null = null) => ({ id, type: 'action', action: { type, config }, suivant });

const SCENARIOS: Record<string, () => Promise<void>> = {
  /** Ligne 1 — publiée : une étape choisie dans le tiroir n'est pas écrite avant d'être enregistrée. */
  async l1() {
    const regle = await creerRegle({ trigger_event: 'client.untagged', steps: [action('create_task', { title: 'Tâche existante' })], is_active: true });
    const page = await ouvrirPage();
    await ouvrirEditeur(page, regle.id);
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await tiroir(page).getByRole('button', { name: /Envoyer un texto/ }).click();
    await panneau(page).waitFor();
    await pause(6000);
    verifier((await etapes(regle.id)).map((e) => e.id).join() === 'e1', 'après 6 s, panneau ouvert et non enregistré : la base ne porte que e1');
    await enregistrer(page).click();
    await pause(6000);
    verifier((await etapes(regle.id)).length === 2, 'après « Enregistrer » dans le panneau : l’étape est en base');
    await page.context().close();
  },

  /** Ligne 2 — la version anglaise d'un texto est visible, modifiable, et ne reste pas périmée en silence. */
  async l2() {
    const regle = await creerRegle({ steps: [action('send_sms', { body: 'Rabais de 10 % jusqu’au 1er mai.', body_en: '10% off until May 1st.' })] });
    const page = await ouvrirPage();
    await ouvrirEditeur(page, regle.id);
    await carte(page, 'Envoyer un texto').click();
    const p = panneau(page);
    const anglais = p.getByLabel('Texte du message — version anglaise (facultatif)', { exact: true });
    verifier(await anglais.inputValue() === '10% off until May 1st.', 'le texte anglais est dans un champ du panneau');
    await p.getByLabel('Texte du message *', { exact: true }).fill('Rabais de 20 % jusqu’au 1er juin.');
    verifier(await enregistrer(page).isDisabled(), 'français corrigé, anglais intact : « Enregistrer » est refusé');
    verifier(await p.getByText('a changé, pas sa version anglaise').first().isVisible(), 'le panneau dit pourquoi');
    await anglais.fill('20% off until June 1st.');
    await enregistrer(page).click();
    await pause(6000);
    const config = (await etapes(regle.id))[0]?.action?.config ?? {};
    verifier(config.body === 'Rabais de 20 % jusqu’au 1er juin.' && config.body_en === '20% off until June 1st.', 'les deux textes sont en base');
    await page.context().close();
  },
};

const demandes = process.argv.slice(2);
const aJouer = demandes.length ? demandes : Object.keys(SCENARIOS);
let echecs = 0;
for (const nom of aJouer) {
  const scenario = SCENARIOS[nom];
  if (!scenario) { console.error(`scénario inconnu : ${nom}`); echecs += 1; continue; }
  console.log(`▶ ${nom}`);
  try { await scenario(); console.log(`✔ ${nom}`); } catch (e) { echecs += 1; console.error(`✘ ${nom} — ${e instanceof Error ? e.message : String(e)}`); }
}
await fermer();
process.exit(echecs ? 1 : 0);
