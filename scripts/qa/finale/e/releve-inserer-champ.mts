/**
 * Agent E — relevé AU VRAI NAVIGATEUR de « Insérer un champ » (point 8 de la mission).
 *
 * Pour quatre déclencheurs (facture en retard, devis envoyé, rendez-vous, nouveau
 * prospect), ouvre l'éditeur d'un texto puis d'un courriel et relève, tels qu'un
 * utilisateur les voit :
 *   · les boutons « Insérer une information du client » ;
 *   · sous « Insérer un champ » : le libellé replié (« Champs de base »), les boutons
 *     VISIBLES sans rien déplier, puis ceux qui apparaissent une fois déplié ;
 *   · où tombe la variable insérée quand le curseur est au milieu du texte ;
 *   · s'il existe une recherche, un aperçu, une limite au déclencheur.
 * Captures : D:/lume-final/sorties/e/*.png. Relevé : D:/lume-final/sorties/e/releve-inserer-champ.json.
 *
 * Pile LOCALE, mon bureau A (suffixe e), mes serveurs (API 3495, Vite 5495).
 *
 *   QA_AUTO_SUFFIXE=e npx tsx --env-file=.env.local scripts/qa/finale/e/releve-inserer-champ.mts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { assurerBureauTest, COMPTES } from '../../../../tests/automations-suite/harnais/bureau-test';

const BASE = process.env.E_UI_BASE || 'http://127.0.0.1:5495';
const SORTIES = 'D:/lume-final/sorties/e';
const MARQUE = '[E-UI]';
if (!String(process.env.VITE_SUPABASE_URL ?? '').includes('localhost')) throw new Error('REFUS : pile LOCALE seulement.');
if ((process.env.QA_AUTO_SUFFIXE ?? '') !== 'e') throw new Error('REFUS : QA_AUTO_SUFFIXE=e attendu.');
mkdirSync(SORTIES, { recursive: true });

const b = await assurerBureauTest();
const { admin, orgA } = b;

const DECLENCHEURS = [
  { cle: 'invoice.overdue', nom: 'Facture en retard', conditions: { days_overdue: 3 } },
  { cle: 'quote.sent', nom: 'Devis envoyé', conditions: {} },
  { cle: 'appointment.created', nom: 'Rendez-vous planifié', conditions: {} },
  { cle: 'lead.created', nom: 'Nouveau prospect', conditions: {} },
] as const;

// ── Montage : une règle en brouillon par déclencheur, un texto puis un courriel ──
await admin.from('automation_rules').delete().eq('org_id', orgA).like('name', `${MARQUE}%`);
const regles: Array<{ id: string; cle: string; nom: string }> = [];
for (const d of DECLENCHEURS) {
  const { data, error } = await admin.from('automation_rules').insert({
    org_id: orgA, name: `${MARQUE} ${d.nom}`, trigger_event: d.cle, conditions: d.conditions, delay_seconds: 0,
    is_active: false, is_preset: false, actions: [],
    steps: [
      { id: 'texto', type: 'action', nom: 'Texto E', action: { type: 'send_sms', config: { body: 'Bonjour, ceci est un texto de relevé.' } }, suivant: 'courriel' },
      { id: 'courriel', type: 'action', nom: 'Courriel E', action: { type: 'send_email', config: { subject: 'Objet de relevé', body: 'Bonjour, ceci est un courriel de relevé.' } }, suivant: null },
    ],
  }).select('id').single();
  if (error) throw new Error(`montage ${d.cle} : ${error.message}`);
  regles.push({ id: (data as { id: string }).id, cle: d.cle, nom: d.nom });
}

// ── Session réelle du propriétaire (lien magique → verifyOtp) ──
const url = process.env.VITE_SUPABASE_URL ?? '';
const anon = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const { data: lien, error: eLien } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTES.proprioA.email });
if (eLien) throw new Error(eLien.message);
const { data: s, error: eOtp } = await createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  .auth.verifyOtp({ token_hash: lien.properties.hashed_token, type: 'magiclink' });
if (eOtp || !s.session) throw new Error(`session : ${eOtp?.message}`);
const session = s.session;
const versionTemoins = readFileSync(join(process.cwd(), 'src/lib/consentApi.ts'), 'utf8').match(/CURRENT_COOKIE_POLICY_VERSION\s*=\s*'([^']+)'/)?.[1] ?? '';

const navigateur = await chromium.launch({ headless: true });
const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CA', timezoneId: 'America/Toronto' });
await contexte.addInitScript(({ jeton, org, origine, version }) => {
  if (location.origin !== origine) return;
  if (sessionStorage.getItem('qa-ui-init')) return;
  sessionStorage.setItem('qa-ui-init', '1');
  localStorage.setItem('lume-auth-token', JSON.stringify(jeton));
  localStorage.setItem('lume-active-org', org);
  localStorage.setItem('lume-language', 'fr');
  localStorage.setItem('lume.cookieConsent.v1', JSON.stringify({ analytics: false, marketing: false, preferences: false, decidedAt: new Date().toISOString(), docVersion: version }));
  localStorage.setItem('lume-setup-dismissed', '1');
}, {
  jeton: { access_token: session.access_token, refresh_token: session.refresh_token, expires_at: session.expires_at, expires_in: session.expires_in, token_type: 'bearer', user: session.user },
  org: orgA, origine: BASE, version: versionTemoins,
});
// tsx (esbuild, keepNames) enveloppe les fonctions nommées dans `__name(...)` : la page doit le connaître.
await contexte.addInitScript('globalThis.__name = (f) => f;');
const page: Page = await contexte.newPage();
page.setDefaultTimeout(25_000);
const erreurs: string[] = [];
page.on('pageerror', (e) => erreurs.push(`pageerror: ${e.message.slice(0, 200)}`));

const panneau = () => page.getByRole('complementary', { name: 'Modifier l’étape' });
const carte = (titre: string) => page.locator('div.relative.w-\\[260px\\]').filter({ has: page.locator('span.font-medium', { hasText: titre }) }).first();

/** Ce que le panneau montre pour l'insertion, sans rien déplier puis déplié. */
async function releverPanneau(nomFichier: string) {
  const p = panneau();
  await p.waitFor();
  const titreInsertion = p.getByText('Insérer un champ', { exact: true });
  await titreInsertion.scrollIntoViewIfNeeded();
  const releve = await p.evaluate((el) => {
    const texte = (n: Element | null) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const paragraphes = [...el.querySelectorAll('p')];
    const pInfo = paragraphes.find((x) => texte(x) === 'Insérer une information du client');
    const pChamp = paragraphes.find((x) => texte(x) === 'Insérer un champ');
    const blocInfo = pInfo?.nextElementSibling ?? null;
    const blocChamp = pChamp?.nextElementSibling ?? null;
    const details = blocChamp?.querySelector('details') ?? null;
    const dansDetails = details ? [...details.querySelectorAll('button')].map((x) => ({ libelle: texte(x), jeton: x.getAttribute('title') })) : [];
    const horsDetails = blocChamp ? [...blocChamp.querySelectorAll(':scope > button')].map((x) => ({ libelle: texte(x), jeton: x.getAttribute('title') })) : [];
    return {
      info_client: blocInfo ? [...blocInfo.querySelectorAll('button')].map((x) => texte(x)) : [],
      libelle_replie: texte(details?.querySelector('summary') ?? null),
      replie_au_depart: details ? !details.open : null,
      visibles_sans_deplier: horsDetails,
      dans_champs_de_base: dansDetails,
      recherche_presente: !!el.querySelector('input[type="search"]'),
      apercu_present: /aperçu|le client lira/i.test(el.textContent ?? ''),
    };
  });
  await page.screenshot({ path: join(SORTIES, `${nomFichier}-replie.png`) });
  const resume = p.locator('summary', { hasText: 'Champs de base' });
  if (await resume.count()) {
    await resume.click();
    await page.screenshot({ path: join(SORTIES, `${nomFichier}-deplie.png`) });
    await resume.click();
  }
  return releve;
}

/** Où tombe la variable quand le curseur est au milieu du texte ? */
async function essaiInsertion(libelleZone: RegExp, bouton: string) {
  const p = panneau();
  const zone = p.getByLabel(libelleZone).first();
  await zone.fill('DEBUT FIN');
  await zone.focus();
  await zone.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(6, 6)); // curseur entre « DEBUT » et « FIN »
  await p.getByRole('button', { name: bouton, exact: true }).first().click();
  const apres = await zone.inputValue();
  return { avant: 'DEBUT FIN', curseur_a: 6, bouton, apres, a_l_endroit_du_curseur: apres.startsWith('DEBUT [') || apres.startsWith('DEBUT {{') };
}

const sortie: Record<string, unknown> = { base: BASE, org: orgA, quand: new Date().toISOString(), declencheurs: {} as Record<string, unknown> };
for (const r of regles) {
  await page.goto(`${BASE}/automations/${r.id}`);
  await page.getByRole('tab', { name: 'Parcours' }).waitFor({ timeout: 90_000 });
  // Premier passage d'un compte neuf : la fenêtre « Partage de votre localisation » recouvre tout.
  const refuser = page.getByRole('button', { name: 'Refuser', exact: true });
  if (await refuser.isVisible({ timeout: 4000 }).catch(() => false)) {
    await refuser.click();
    await refuser.waitFor({ state: 'hidden' });
  }
  const fiche: Record<string, unknown> = {};

  await carte('Texto E').locator('button').first().click();
  fiche.texto = await releverPanneau(`${r.cle.replace('.', '-')}-texto`);
  fiche.texto_insertion = await essaiInsertion(/Texte du message/, 'Nom du client');
  // Compteur de caractères et de segments du texto, tel qu'affiché.
  const zoneTexto = panneau().getByLabel(/Texte du message/).first();
  await zoneTexto.fill('Bonjour [client_first_name], votre facture est en retard. Merci de régler dès que possible.');
  fiche.texto_compteur = (await panneau().locator('p.text-\\[10px\\]').first().textContent())?.trim();
  await zoneTexto.fill('é'.repeat(200));
  fiche.texto_compteur_200_e_aigu = (await panneau().locator('p.text-\\[10px\\]').first().textContent())?.trim();
  await zoneTexto.fill('ê'.repeat(100));
  fiche.texto_compteur_100_e_circonflexe = (await panneau().locator('p.text-\\[10px\\]').first().textContent())?.trim();
  // Fermer sans enregistrer.
  await panneau().getByRole('button', { name: 'Fermer le panneau' }).click();
  const dialogue = page.getByRole('dialog');
  if (await dialogue.isVisible().catch(() => false)) await dialogue.getByRole('button', { name: /Fermer sans enregistrer/ }).click();

  await carte('Courriel E').locator('button').first().click();
  fiche.courriel = await releverPanneau(`${r.cle.replace('.', '-')}-courriel`);
  fiche.courriel_insertion = await essaiInsertion(/^Message/, 'Nom du client');
  // Une variable inconnue : avertie ? enregistrable ?
  const zoneCourriel = panneau().getByLabel(/^Message/).first();
  await zoneCourriel.fill('Bonjour [prenom_du_client], voici {{client.champ_qui_nexiste_pas}} et {prénom|là}.');
  fiche.courriel_variable_inconnue_alerte = (await panneau().getByRole('alert').allTextContents()).map((t) => t.trim());
  await page.screenshot({ path: join(SORTIES, `${r.cle.replace('.', '-')}-courriel-variable-inconnue.png`) });
  const enregistrer = panneau().getByRole('button', { name: 'Enregistrer' });
  fiche.courriel_enregistrer_actif_malgre_inconnue = await enregistrer.isEnabled();
  await enregistrer.click();
  await page.waitForTimeout(2500);
  const { data: enBase } = await admin.from('automation_rules').select('steps').eq('id', r.id).single();
  const corps = ((enBase?.steps ?? []) as Array<{ id: string; action?: { config?: { body?: string } } }>).find((e) => e.id === 'courriel')?.action?.config?.body ?? '';
  fiche.courriel_variable_inconnue_enregistree = corps.includes('[prenom_du_client]');
  (sortie.declencheurs as Record<string, unknown>)[r.cle] = { nom: r.nom, regle: r.id, ...fiche };
}

sortie.erreurs_page = erreurs.slice(0, 20);
writeFileSync(join(SORTIES, 'releve-inserer-champ.json'), JSON.stringify(sortie, null, 2));
await contexte.close();
await navigateur.close();
// Ménage : les règles de relevé sortent du bureau.
await admin.from('automation_rules').delete().eq('org_id', orgA).like('name', `${MARQUE}%`);
console.log(`relevé écrit : ${join(SORTIES, 'releve-inserer-champ.json')}`);
