/**
 * Vérifications au vrai navigateur des corrections de l'agent T — une par ligne
 * du triage `modeles.md`. Voir `banc.mts`. Pile LOCALE seulement.
 *
 *   QA_AUTO_SUFFIXE=t npx tsx --env-file=.env.local scripts/qa/finale/t/verifier.mts <scénario…>
 *   (sans argument : tous les scénarios)
 */
import type { Page } from '@playwright/test';
import {
  CAPTURES, creerRegle, deplierMessages, editeurCourriel, fermer, lireRegle, ouvrirListe, ouvrirPage, supprimerRegle, verifier,
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
