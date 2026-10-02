// Le scénario de Rafba sur le VRAI site, bureau de test « Grok Audit (TEST) » (prod).
// Crée un brouillon de test, ajoute une étape « Envoyer un texto » (texte d'exemple), demande à Lumi
// « fais un message pour notifier le rep… », lit la réponse et le canevas, puis met le brouillon à la corbeille.
//   node --env-file=D:/lume-uiaudit/wt/.env.local 05-prod-lumi-rep.mjs <etiquette>
import { createRequire } from 'node:module';
const require = createRequire('D:/lume-uiaudit/wt/package.json');
const pw = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');

const SITE = 'https://lumecrm.net';
const ORG_TEST = '0df93da0-dc34-481c-be91-bab69a4989b0';
const etiquette = process.argv[2] || 'essai';
const CAP = `D:/lume-uiaudit/sorties/captures/prod-lumi-${etiquette}`;
const url = process.env.SUPABASE_URL_PROD;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY_PROD, { auth: { persistSession: false } });
const { data: org } = await admin.from('orgs').select('name').eq('id', ORG_TEST).single();
if (org?.name !== 'Grok Audit (TEST)') throw new Error('REFUS : pas le bureau de test');
const html = await (await fetch(SITE)).text();
const js = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
const anon = (await (await fetch(SITE + js)).text()).match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0];
const { data: lien, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: 'viktor.audit@lume-test.ca' });
if (error) throw error;
const pub = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: s, error: e2 } = await pub.auth.verifyOtp({ token_hash: lien.properties.hashed_token, type: 'magiclink' });
if (e2 || !s.session) throw e2 ?? new Error('pas de session');

const browser = await pw.chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: 'fr-CA', timezoneId: 'America/Toronto' });
await context.addInitScript(({ s, org }) => {
  if (sessionStorage.getItem('qa-init')) return;
  sessionStorage.setItem('qa-init', '1');
  localStorage.setItem('lume-auth-token', s);
  localStorage.setItem('lume-active-org', org);
  localStorage.setItem('lume-language', 'fr');
}, { s: JSON.stringify(s.session), org: ORG_TEST });
const page = await context.newPage();
page.setDefaultTimeout(20_000);
const pb = [];
page.on('pageerror', (e) => pb.push('exception: ' + e.message.slice(0, 160)));
page.on('response', (r) => { if (r.status() >= 400) pb.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 110)}`); });

const NOM = `[QA audit ${etiquette}] notifier le rep`;
let idRegle = null;
try {
  await page.goto(`${SITE}/automations/nouvelle`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Décris ton automatisation à Lumi').waitFor({ timeout: 60_000 });
  // La bannière de témoins recouvre le bas de l'écran.
  const refuser = page.getByRole('button', { name: 'Tout refuser' });
  if (await refuser.count()) await refuser.click();
  await page.screenshot({ path: `${CAP}-1-nouvelle.png` });

  // 1. Ajouter une étape « Envoyer un texto » à la main (elle reçoit le texte d'exemple).
  await page.getByRole('button', { name: /^Ajouter$/ }).first().click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${CAP}-2-tiroir.png` });
  await page.getByRole('button', { name: /Envoyer un texto/ }).first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${CAP}-3-etape.png` });
  // Enregistrer l'étape telle quelle (texte d'exemple).
  const enregistrer = page.getByRole('button', { name: /^Enregistrer/ }).first();
  if (await enregistrer.count()) await enregistrer.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${CAP}-4-canevas.png` });

  // 2. La demande de Rafba, mot pour mot.
  const zone = page.locator('textarea').first();
  await zone.fill('fais un message pour notifier le rep en questions qui a envoye le devis');
  await page.getByRole('button', { name: /^Construire$/ }).click();
  // La réponse de Lumi arrive sous le champ.
  await page.waitForResponse((r) => /\/api\/automations\/rules\/generer/.test(r.url()), { timeout: 120_000 }).then(async (r) => {
    const j = await r.json().catch(() => null);
    console.log('HTTP', r.status());
    console.log('RÉPONSE DE LUMI :\n' + String(j?.resume ?? j?.parcours?.resume ?? JSON.stringify(j).slice(0, 600)));
    console.log('ÉTAPES :', JSON.stringify((j?.steps ?? j?.parcours?.steps ?? []).map((e) => `${e.action?.type ?? e.type} ${JSON.stringify(e.action?.config ?? {}).slice(0, 140)}`), null, 1));
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${CAP}-5-apres-lumi.png`, fullPage: true });
  idRegle = page.url().match(/automations\/([0-9a-f-]{36})/)?.[1] ?? null;
  console.log('URL :', page.url());
} catch (e) {
  console.log('ÉCHEC :', String(e).slice(0, 400));
  await page.screenshot({ path: `${CAP}-echec.png`, fullPage: true });
} finally {
  console.log('problèmes relevés :', pb.length ? pb : 'aucun');
  // Ménage : les brouillons créés par ce script dans le bureau de test vont à la corbeille.
  // Seulement le brouillon que CE passage a créé (son id est dans l'URL de l'éditeur).
  const { data: brouillons } = idRegle
    ? await admin.from('automation_rules').select('id, name, is_active').eq('org_id', ORG_TEST).eq('id', idRegle).eq('is_active', false).is('deleted_at', null)
    : { data: [] };
  for (const r of brouillons ?? []) {
    await admin.from('automation_rules').update({ deleted_at: new Date().toISOString(), name: `${NOM} (${r.id.slice(0, 6)})` }).eq('id', r.id).eq('org_id', ORG_TEST);
    console.log('brouillon de test mis à la corbeille :', r.id, '| était :', r.name);
  }
  await context.close(); await browser.close();
}
