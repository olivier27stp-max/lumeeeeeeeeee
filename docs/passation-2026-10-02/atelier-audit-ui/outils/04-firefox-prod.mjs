// LECTURE SEULE sur le vrai site, bureau de test « Grok Audit (TEST) » : l'exception de verrou
// de session vue sous Firefox en développement existe-t-elle aussi sur la version déployée ?
import { createRequire } from 'node:module';
const require = createRequire('D:/lume-uiaudit/wt/package.json');
const pw = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');

const SITE = 'https://lumecrm.net';
const ORG_TEST = '0df93da0-dc34-481c-be91-bab69a4989b0';
const url = process.env.SUPABASE_URL_PROD;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY_PROD, { auth: { persistSession: false } });
const { data: org } = await admin.from('orgs').select('name').eq('id', ORG_TEST).single();
if (org?.name !== 'Grok Audit (TEST)') throw new Error('REFUS : pas le bureau de test');
const html = await (await fetch(SITE)).text();
const js = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
const anon = (await (await fetch(SITE + js)).text()).match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0];

async function session() {
  const { data: lien, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: 'viktor.audit@lume-test.ca' });
  if (error) throw error;
  const pub = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: s, error: e2 } = await pub.auth.verifyOtp({ token_hash: lien.properties.hashed_token, type: 'magiclink' });
  if (e2 || !s.session) throw e2 ?? new Error('pas de session');
  return s.session;
}

for (const type of ['firefox', 'webkit', 'chromium']) {
  const s = await session();
  const browser = await pw[type].launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CA', timezoneId: 'America/Toronto' });
  await context.addInitScript(({ s, org }) => {
    if (sessionStorage.getItem('qa-init')) return;
    sessionStorage.setItem('qa-init', '1');
    localStorage.setItem('lume-auth-token', s);
    localStorage.setItem('lume-active-org', org);
  }, { s: JSON.stringify(s), org: ORG_TEST });
  const page = await context.newPage();
  const exceptions = [], console_ = [], reseau = [];
  page.on('pageerror', (e) => exceptions.push(`${e.name}: ${e.message}`.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && !/__cf_bm/.test(m.text())) console_.push(m.text().slice(0, 200)); });
  page.on('response', (r) => { if (r.status() >= 400) reseau.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 120)}`); });
  await page.goto(`${SITE}/automations`, { waitUntil: 'domcontentloaded' });
  const ok = await page.getByRole('heading', { name: 'Mes automatisations' }).waitFor({ timeout: 60_000 }).then(() => true).catch(() => false);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(2500);
  console.log(`${type} : page ${ok ? 'chargée' : 'NON chargée'} ; exceptions ${exceptions.length} ; console ${console_.length} ; réseau >=400 ${reseau.length}`);
  for (const x of [...new Set(exceptions)]) console.log('   exception ×' + exceptions.filter((y) => y === x).length, x);
  for (const x of [...new Set(console_)].slice(0, 5)) console.log('   console', x);
  for (const x of reseau.slice(0, 5)) console.log('   réseau', x);
  await context.close(); await browser.close();
}
