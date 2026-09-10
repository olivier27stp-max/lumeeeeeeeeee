/**
 * boutons-atteignables.mjs — rien ne recouvre les boutons Enregistrer.
 *
 * Audit QA prod 2026-09-09, n°5 (prouvé en prod) : la carte « Setup »
 * (fixed bottom-4 right-4) recouvrait « Save Client », « Save Quote »,
 * « Save Changes » et la pagination de /finances. Sur téléphone (390×844),
 * un vrai clic sur « Save Client » expirait. La carte ne s'affiche que pour
 * les NOUVEAUX comptes — ceux qui ne pouvaient donc pas enregistrer leur
 * premier client.
 *
 *   node --env-file=.env.local scripts/qa/boutons-atteignables.mjs
 *
 * Pour chaque page et chaque viewport, on FORCE l'affichage de la carte
 * (réponse simulée de /api/me/setup-status, comme pour un compte neuf), puis :
 *   1. elementFromPoint(centre de chaque bouton d'action) doit être le bouton
 *      lui-même (ou un de ses enfants) — jamais la carte ;
 *   2. sur /clients/new, un VRAI clic sur « Enregistrer » avec un formulaire
 *      vide doit aboutir (la validation bloque : rien n'est créé).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const RACINE = process.cwd();
const BASE = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const COMPTE = process.env.QA_COMPTE || 'willhebert30@gmail.com';
const PAGES = ['/clients/new', '/quotes/new', '/settings/company', '/finances', '/clients', '/jobs'];
const VIEWPORTS = [{ nom: 'ordinateur', width: 1440, height: 900 }, { nom: 'téléphone', width: 390, height: 844, mobile: true }];
const ACTION = /enregistrer|sauvegarder|save|suivant|next|précédent|previous|annuler|cancel/i;

const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const resultats = [];
const ok = (nom, vrai, detail = '') => { resultats.push({ nom, vrai: !!vrai, detail }); console.log(`  ${vrai ? '✓' : '✗'} ${nom}${detail ? ' — ' + detail : ''}`); };

const { data: l } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTE });
const { data: s } = await anon.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' });
const { data: m } = await admin.from('memberships').select('org_id').eq('user_id', s.user.id).eq('status', 'active').limit(1).maybeSingle();
const jeton = { access_token: s.session.access_token, refresh_token: s.session.refresh_token, expires_at: s.session.expires_at, expires_in: s.session.expires_in, token_type: 'bearer', user: s.user };

// La carte Setup telle qu'un compte neuf la voit (1 étape sur 8).
const STATUT_SETUP = { setup_completed: false, clients_count: 1, quotes_count: 0, members_count: 1, stripe_connected: false, taxes_configured: false, twilio_provisioned: false };

const nav = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const dir = path.join(RACINE, 'qa-captures'); fs.mkdirSync(dir, { recursive: true });

for (const vp of VIEWPORTS) {
  console.log(`\n── ${vp.nom} ${vp.width}×${vp.height} ──`);
  for (const chemin of PAGES) {
    const ctx = await nav.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: vp.width, height: vp.height, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, deviceScaleFactor: vp.mobile ? 2 : 1 });
    await page.evaluateOnNewDocument((t, o) => {
      localStorage.setItem('lume-auth-token', JSON.stringify(t)); localStorage.setItem('lume-active-org', o); localStorage.setItem('lume-language', 'fr');
      // Clé et forme réelles (src/lib/consentApi.ts) : sinon le bandeau témoins
      // recouvre la barre d'action et fausse la mesure.
      localStorage.setItem('lume.cookieConsent.v1', JSON.stringify({ analytics: false, marketing: false, preferences: false, decidedAt: new Date().toISOString(), docVersion: 'cookie-policy-2026-07-23' }));
      localStorage.removeItem('lume-setup-dismissed');
    }, jeton, m.org_id);
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      if (r.url().includes('/api/me/setup-status')) return r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(STATUT_SETUP) });
      return r.continue();
    });
    await page.goto(BASE + chemin, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));

    const mesure = await page.evaluate((ACTION_SRC) => {
      const ACTION = new RegExp(ACTION_SRC, 'i');
      const carteVisible = !!document.querySelector('[data-setup-checklist]');
      const boutons = [...document.querySelectorAll('button, a[href], [role=button]')]
        .filter((e) => ACTION.test((e.innerText || e.getAttribute('aria-label') || '').trim()))
        .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; });
      const recouverts = [];
      for (const b of boutons) {
        const r = b.getBoundingClientRect();
        const dessus = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (dessus && !b.contains(dessus) && !dessus.contains(b)) {
          recouverts.push(`« ${(b.innerText || b.getAttribute('aria-label') || '').trim().slice(0, 24)} » recouvert par « ${(dessus.innerText || dessus.tagName).trim().slice(0, 30)} »`);
        }
      }
      return { carteVisible, nbBoutons: boutons.length, recouverts };
    }, ACTION.source);

    const nom = `${vp.nom} ${chemin}`;
    if (chemin === '/clients' || chemin === '/jobs') {
      ok(`${nom} : la carte Setup s'affiche bien sur une page de liste`, mesure.carteVisible);
    } else {
      ok(`${nom} : la carte Setup ne s'affiche pas sur un formulaire / des réglages`, !mesure.carteVisible);
    }
    ok(`${nom} : aucun bouton d'action recouvert (${mesure.nbBoutons} testés)`, mesure.recouverts.length === 0, mesure.recouverts.slice(0, 2).join(' | '));

    if (chemin === '/clients/new') {
      // Vrai clic, formulaire vide. Puppeteer clique aux coordonnées : si la
      // carte est dessus, c'est ELLE qui reçoit le clic (et navigue ailleurs).
      // Preuve que le clic a atteint le formulaire : on reste sur la page et
      // la validation se manifeste (champ invalide ou message « requis »).
      const cible = await page.evaluateHandle(() => {
        const re = /enregistrer|sauvegarder|save/i;
        return [...document.querySelectorAll('button')].filter((b) => re.test(b.innerText) && b.getBoundingClientRect().width > 0).pop() || null;
      });
      const el = cible.asElement();
      if (!el) ok(`${nom} : bouton Enregistrer trouvé`, false);
      else {
        const urlAvant = page.url();
        await el.click().catch(() => {});
        await new Promise((r) => setTimeout(r, 800));
        const apres = await page.evaluate(() => ({
          url: location.href,
          validation: !!document.querySelector('form :invalid, [aria-invalid="true"]') || /requis|required|obligatoire/i.test(document.body.innerText),
        }));
        ok(`${nom} : un VRAI clic sur Enregistrer atteint le formulaire (validation, rien créé)`, apres.url === urlAvant && apres.validation, apres.url !== urlAvant ? `navigué vers ${apres.url.replace(BASE, '')}` : (!apres.validation ? 'aucune validation visible' : ''));
      }
    }
    await page.screenshot({ path: path.join(dir, `atteignable-${vp.nom}-${chemin.replace(/\W+/g, '_')}.png`) });
    await ctx.close();
  }
}
await nav.close();

const rates = resultats.filter((r) => !r.vrai);
console.log(`\n${'═'.repeat(60)}\n  ${resultats.length - rates.length}/${resultats.length} vérifications passées`);
for (const r of rates) console.log(`  ✗ ${r.nom}${r.detail ? ' — ' + r.detail : ''}`);
fs.writeFileSync(path.join(RACINE, 'qa-boutons-atteignables.json'), JSON.stringify({ genereLe: new Date().toISOString(), resultats }, null, 2));
process.exit(rates.length ? 1 : 0);
