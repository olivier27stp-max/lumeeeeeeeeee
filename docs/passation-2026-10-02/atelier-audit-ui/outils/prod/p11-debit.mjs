// Passe prod : quelles routes répondent 429 quand on navigue vite dans les automatisations ? LECTURE SEULE.
// Ouvre la liste puis l'éditeur de N automatisations d'affilée (comme quelqu'un qui passe de l'une à l'autre),
// et relève chaque réponse 429 avec son adresse et ses en-têtes de limite.
import { ouvrir, admin, ORG } from '../nav-prod.mjs';

const { data: regles } = await admin.from('automation_rules').select('id, name').eq('org_id', ORG).is('deleted_at', null).limit(8);
const o = await ouvrir({});
const { page } = o;
const vus = [];
const comptes = new Map();
page.on('response', (r) => {
  const u = r.url();
  if (!u.includes('lumecrm.net/api/')) return;
  const cle = `${r.request().method()} ${u.replace('https://lumecrm.net', '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id').split('?')[0]}`;
  comptes.set(cle, (comptes.get(cle) ?? 0) + 1);
  if (r.status() === 429) vus.push({ quand: new Date().toISOString().slice(11, 19), cle, enTetes: Object.fromEntries(Object.entries(r.headers()).filter(([k]) => /ratelimit|retry/i.test(k))) });
});
const debut = Date.now();
try {
  await page.goto('https://lumecrm.net/automations', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^Actions pour / }).first().waitFor({ timeout: 60_000 });
  await o.temoins();
  for (const r of regles ?? []) {
    await page.goto(`https://lumecrm.net/automations/${r.id}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Mes automatisations/ }).first().waitFor({ timeout: 60_000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    await page.goto('https://lumecrm.net/automations', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /^Actions pour / }).first().waitFor({ timeout: 60_000 }).catch(() => undefined);
    await page.waitForTimeout(800);
  }
} finally {
  const duree = Math.round((Date.now() - debut) / 1000);
  console.log(`${(regles ?? []).length} automatisations ouvertes en ${duree} s`);
  console.log('appels API par route :');
  for (const [cle, n] of [...comptes].sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log(`  ${String(n).padStart(4)}  ${cle}`);
  console.log(`réponses 429 : ${vus.length}`);
  for (const v of vus.slice(0, 12)) console.log(`  ${v.quand} ${v.cle} ${JSON.stringify(v.enTetes)}`);
  await o.fermer();
}
