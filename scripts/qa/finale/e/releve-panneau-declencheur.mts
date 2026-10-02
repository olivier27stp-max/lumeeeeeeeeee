/**
 * Agent E — relevé AU VRAI NAVIGATEUR du panneau « Réglages du déclencheur » (point 6) :
 * ce que l'éditeur offre AUJOURD'HUI pour dire « qui est touché », sur « Facture en retard »
 * et « Nouveau prospect ». Captures et relevé dans D:/lume-final/sorties/e/.
 *
 *   QA_AUTO_SUFFIXE=e npx tsx --env-file=.env.local scripts/qa/finale/e/releve-panneau-declencheur.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { assurerBureauTest, COMPTES } from '../../../../tests/automations-suite/harnais/bureau-test';

const BASE = process.env.E_UI_BASE || 'http://127.0.0.1:5495';
const SORTIES = 'D:/lume-final/sorties/e';
const MARQUE = '[E-UI3]';
if (!String(process.env.VITE_SUPABASE_URL ?? '').includes('localhost')) throw new Error('REFUS : pile LOCALE seulement.');
if ((process.env.QA_AUTO_SUFFIXE ?? '') !== 'e') throw new Error('REFUS : QA_AUTO_SUFFIXE=e attendu.');

const b = await assurerBureauTest();
const { admin, orgA } = b;
await admin.from('automation_rules').delete().eq('org_id', orgA).like('name', `${MARQUE}%`);
const etapes = [{ id: 'texto', type: 'action', nom: 'Texto', action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name].' } }, suivant: null }];
const regles: Array<{ id: string; cle: string }> = [];
for (const [cle, conditions] of [['invoice.overdue', { days_overdue: 3 }], ['lead.created', {}]] as const) {
  const { data, error } = await admin.from('automation_rules').insert({
    org_id: orgA, name: `${MARQUE} ${cle}`, trigger_event: cle, conditions, delay_seconds: 0, is_active: false, is_preset: false, actions: [], steps: etapes,
  }).select('id').single();
  if (error) throw new Error(error.message);
  regles.push({ id: (data as { id: string }).id, cle });
}

const { data: lien, error: eLien } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTES.proprioA.email });
if (eLien || !lien?.properties) throw new Error(`lien magique : ${eLien?.message}`);
const { data: s, error: eOtp } = await createClient(process.env.VITE_SUPABASE_URL ?? '', process.env.VITE_SUPABASE_ANON_KEY ?? '', { auth: { persistSession: false, autoRefreshToken: false } })
  .auth.verifyOtp({ token_hash: lien.properties.hashed_token, type: 'magiclink' });
if (eOtp || !s.session) throw new Error(`session : ${eOtp?.message}`);
const session = s.session;
const version = readFileSync(join(process.cwd(), 'src/lib/consentApi.ts'), 'utf8').match(/CURRENT_COOKIE_POLICY_VERSION\s*=\s*'([^']+)'/)?.[1] ?? '';
const navigateur = await chromium.launch({ headless: true });
const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CA', timezoneId: 'America/Toronto' });
await contexte.addInitScript('globalThis.__name = (f) => f;');
await contexte.addInitScript(({ jeton, org, origine, v }) => {
  if (location.origin !== origine || sessionStorage.getItem('qa-ui-init')) return;
  sessionStorage.setItem('qa-ui-init', '1');
  localStorage.setItem('lume-auth-token', JSON.stringify(jeton));
  localStorage.setItem('lume-active-org', org);
  localStorage.setItem('lume-language', 'fr');
  localStorage.setItem('lume.cookieConsent.v1', JSON.stringify({ analytics: false, marketing: false, preferences: false, decidedAt: new Date().toISOString(), docVersion: v }));
  localStorage.setItem('lume-setup-dismissed', '1');
}, { jeton: { access_token: session.access_token, refresh_token: session.refresh_token, expires_at: session.expires_at, expires_in: session.expires_in, token_type: 'bearer', user: session.user }, org: orgA, origine: BASE, v: version });
const page = await contexte.newPage();
page.setDefaultTimeout(25_000);

const sortie: Record<string, unknown> = { quand: new Date().toISOString() };
try {
  for (const r of regles) {
    await page.goto(`${BASE}/automations/${r.id}`);
    await page.getByRole('tab', { name: 'Parcours' }).waitFor({ timeout: 90_000 });
    const refuser = page.getByRole('button', { name: 'Refuser', exact: true });
    if (await refuser.isVisible({ timeout: 2000 }).catch(() => false)) { await refuser.click(); await refuser.waitFor({ state: 'hidden' }); }
    await page.locator('button', { hasText: 'Quand' }).first().click();
    const panneau = page.getByRole('complementary', { name: 'Réglages du déclencheur' });
    await panneau.waitFor();
    await page.screenshot({ path: join(SORTIES, `panneau-declencheur-${r.cle.replace('.', '-')}.png`) });
    sortie[r.cle] = {
      libelles: (await panneau.locator('label').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim()),
      sections: (await panneau.locator('h3').allTextContents()).map((t) => t.trim()),
      mentionne_un_compteur_de_clients: /touche|client[s]? correspond/i.test((await panneau.textContent()) ?? ''),
      texte: ((await panneau.textContent()) ?? '').replace(/\s+/g, ' ').trim().slice(0, 900),
    };
  }
  // L'onglet « Réglages » de l'automatisation : y a-t-il un ciblage ?
  await page.getByRole('tab', { name: 'Réglages' }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(SORTIES, 'onglet-reglages-automatisation.png') });
  sortie.onglet_reglages = ((await page.locator('[role="tabpanel"], main').first().textContent()) ?? '').replace(/\s+/g, ' ').trim().slice(0, 1200);
} finally {
  writeFileSync(join(SORTIES, 'releve-panneau-declencheur.json'), JSON.stringify(sortie, null, 2));
  await contexte.close();
  await navigateur.close();
  await admin.from('automation_rules').delete().eq('org_id', orgA).like('name', `${MARQUE}%`);
}
console.log(JSON.stringify(sortie, null, 2));
