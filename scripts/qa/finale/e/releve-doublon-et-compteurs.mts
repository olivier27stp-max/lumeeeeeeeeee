/**
 * Agent E — relevé AU VRAI NAVIGATEUR (points 7 et 16 de la mission) :
 *   A. publier, dans l'éditeur, une automatisation IDENTIQUE à une autre déjà publiée
 *      (même déclencheur, même texto) : que dit la confirmation ? nomme-t-elle l'autre ?
 *   B. la liste : l'éditeur de texto et de courriel d'une automatisation à l'ancien format —
 *      compteur de caractères et de SMS, palette « Insérer : » ;
 *   C. Réglages → Messagerie et Réglages → Avis clients : les autres endroits où l'on écrit
 *      un texto automatisé — y a-t-il un compteur de SMS ?
 * Captures et relevé : D:/lume-final/sorties/e/ (releve-doublon-et-compteurs.json).
 *
 *   QA_AUTO_SUFFIXE=e npx tsx --env-file=.env.local scripts/qa/finale/e/releve-doublon-et-compteurs.mts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { assurerBureauTest, COMPTES } from '../../../../tests/automations-suite/harnais/bureau-test';

const BASE = process.env.E_UI_BASE || 'http://127.0.0.1:5495';
const SORTIES = 'D:/lume-final/sorties/e';
const MARQUE = '[E-UI2]';
if (!String(process.env.VITE_SUPABASE_URL ?? '').includes('localhost')) throw new Error('REFUS : pile LOCALE seulement.');
if ((process.env.QA_AUTO_SUFFIXE ?? '') !== 'e') throw new Error('REFUS : QA_AUTO_SUFFIXE=e attendu.');
mkdirSync(SORTIES, { recursive: true });

const b = await assurerBureauTest();
const { admin, orgA } = b;
await admin.from('automation_rules').delete().eq('org_id', orgA).like('name', `${MARQUE}%`);

const TEXTO = 'Bonjour [client_first_name], merci de votre demande. On vous rappelle très vite.';
async function regle(nom: string, champs: Record<string, unknown>): Promise<string> {
  const { data, error } = await admin.from('automation_rules').insert({
    org_id: orgA, name: `${MARQUE} ${nom}`, trigger_event: 'lead.created', conditions: {}, delay_seconds: 0, is_active: false, is_preset: false, actions: [], ...champs,
  }).select('id').single();
  if (error) throw new Error(`montage ${nom} : ${error.message}`);
  return (data as { id: string }).id;
}
const etapeTexto = [{ id: 'texto', type: 'action', nom: 'Texto', action: { type: 'send_sms', config: { body: TEXTO } }, suivant: null }];
const idA = await regle('Bienvenue A (publiée)', { steps: etapeTexto, is_active: true });
const idB = await regle('Bienvenue B (copie)', { steps: etapeTexto });
const idAncien = await regle('Ancien format', {
  trigger_event: 'quote.sent',
  actions: [
    { type: 'send_sms', config: { body: 'Bonjour [client_first_name], avez-vous vu notre devis ?' } },
    { type: 'send_email', config: { subject: 'Votre devis [quote_number]', body: '<p>Bonjour [client_first_name],</p><p>Avez-vous vu notre devis ?</p>' } },
  ],
});

// ── Session réelle du propriétaire ──
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
await contexte.addInitScript('globalThis.__name = (f) => f;');
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
const page: Page = await contexte.newPage();
page.setDefaultTimeout(25_000);

const propre = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, ' ').trim();
async function refuserLocalisation() {
  const refuser = page.getByRole('button', { name: 'Refuser', exact: true });
  if (await refuser.isVisible({ timeout: 2500 }).catch(() => false)) { await refuser.click(); await refuser.waitFor({ state: 'hidden' }); }
}
const sortie: Record<string, unknown> = { base: BASE, org: orgA, quand: new Date().toISOString() };

try {
  // ── A. Publier un doublon dans l'éditeur ──
  await page.goto(`${BASE}/automations/${idB}`);
  await page.getByRole('tab', { name: 'Parcours' }).waitFor({ timeout: 90_000 });
  await refuserLocalisation();
  await page.getByRole('switch', { name: 'Publier l’automatisation' }).click();
  const dialogue = page.getByRole('dialog');
  await dialogue.waitFor();
  const texteDialogue = propre(await dialogue.textContent());
  await page.screenshot({ path: join(SORTIES, 'doublon-confirmation-publication.png') });
  await dialogue.getByRole('button', { name: 'Publier', exact: true }).click();
  let publiee = false;
  for (let i = 0; i < 40 && !publiee; i++) {
    await page.waitForTimeout(500);
    const { data } = await admin.from('automation_rules').select('is_active').eq('id', idB).single();
    publiee = !!data?.is_active;
  }
  const toasts = (await page.locator('[data-sonner-toast]').allTextContents()).map(propre);
  await page.screenshot({ path: join(SORTIES, 'doublon-apres-publication.png') });
  sortie.A_publication_d_un_doublon = {
    regle_deja_publiee: `${MARQUE} Bienvenue A (publiée)`, regle_publiee_ensuite: `${MARQUE} Bienvenue B (copie)`,
    texte_de_la_confirmation: texteDialogue,
    la_confirmation_nomme_l_autre: /Bienvenue A/.test(texteDialogue),
    la_confirmation_parle_de_doublon: /doublon|déjà|deja|même déclencheur|double emploi/i.test(texteDialogue),
    publiee_sans_obstacle: publiee, toasts,
  };

  // ── B. La liste : éditeur des messages d'une automatisation à l'ancien format ──
  await page.goto(`${BASE}/automations`);
  const recherche = page.locator('#rech-automations');
  await recherche.waitFor({ timeout: 90_000 });
  await recherche.fill(`${MARQUE} Ancien format`);
  const voir = page.getByRole('button', { name: new RegExp(`Voir les messages de \\${MARQUE.replace(']', '\\]')} Ancien format`) });
  await voir.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(SORTIES, 'liste-messages-ancien-format.png'), fullPage: true });
  const zones = page.locator('textarea');
  const releveListe: Record<string, unknown> = { zones_de_texte: await zones.count() };
  // Le texto : on écrit un texte de 100 caractères avec un « ê », puis le texte par défaut d'un nouveau texto.
  const zoneTexto = zones.first();
  if (await zoneTexto.count()) {
    const autour = () => zoneTexto.evaluate((el) => (el.closest('div')?.parentElement?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 600));
    await zoneTexto.fill('Bonjour, votre rendez-vous est confirmé. Vous êtes attendu demain matin à 9 h. À bientôt et merci !!');
    releveListe.texto_100_car_avec_e_circonflexe = await autour();
    await zoneTexto.fill('Bonjour [client_name], c’est [company_name]. Merci !');
    releveListe.texto_par_defaut = await autour();
    await page.screenshot({ path: join(SORTIES, 'liste-editeur-texto.png'), fullPage: true });
  }
  releveListe.boutons_inserer = (await page.locator('button', { hasText: /^\+?\s*(Prénom du client|Nom complet|Votre entreprise|N° de facture|Montant|N° de soumission|Date du RDV|Heure du RDV)$/ }).allTextContents()).map(propre);
  // Le courriel : son éditeur (aperçu + palette).
  const modifierCourriel = page.getByRole('button', { name: /Modifier le courriel|Modifier ce courriel|Modifier/ }).first();
  if (await modifierCourriel.isVisible().catch(() => false)) {
    await modifierCourriel.click().catch(() => undefined);
    await page.waitForTimeout(1500);
  }
  const palette = page.locator('[data-testid="palette-variables"]').first();
  if (await palette.count()) {
    releveListe.palette_courriel = (await palette.locator('button').allTextContents()).map(propre);
    releveListe.palette_courriel_recherche = await page.getByRole('searchbox', { name: 'Chercher une variable à insérer' }).count();
    await page.screenshot({ path: join(SORTIES, 'liste-editeur-courriel.png'), fullPage: true });
  }
  sortie.B_liste_ancien_format = releveListe;

  // ── C. Réglages → Messagerie et Avis clients ──
  for (const [cle, chemin] of [['messagerie', '/settings/messaging'], ['avis', '/settings/reviews']] as const) {
    await page.goto(`${BASE}${chemin}`);
    await page.waitForTimeout(4000);
    await page.screenshot({ path: join(SORTIES, `reglages-${cle}.png`), fullPage: true });
    const texte = propre(await page.locator('main, body').first().textContent());
    const zonesReglages = await page.locator('textarea').count();
    sortie[`C_reglages_${cle}`] = {
      zones_de_texte_visibles: zonesReglages,
      compteurs_de_caracteres: [...texte.matchAll(/\d+\s*\/\s*(160|320|400|1600)/g)].map((m) => m[0]),
      mention_du_nombre_de_sms: /\b\d+\s+SMS\b/.test(texte),
      extrait: texte.slice(0, 500),
    };
  }
} finally {
  writeFileSync(join(SORTIES, 'releve-doublon-et-compteurs.json'), JSON.stringify(sortie, null, 2));
  await contexte.close();
  await navigateur.close();
  await admin.from('automation_rules').update({ is_active: false }).in('id', [idA, idB, idAncien]);
  await admin.from('automation_rules').delete().eq('org_id', orgA).like('name', `${MARQUE}%`);
}
console.log(JSON.stringify(sortie, null, 2));
