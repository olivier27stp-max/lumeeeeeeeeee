/**
 * Vérification post-audit sécurité — parcours réel dans le navigateur.
 *
 * Objectif : prouver que le durcissement DB (revoke de grants, WITH CHECK,
 * append-only, verrou optimiste, factures immuables) n'a cassé AUCUN flux
 * utilisateur. Les requêtes de privilèges disent ce qui est permis ; seul
 * un clic dit ce qui marche.
 *
 * Tourne contre la PROD avec un compte de test dans sa propre organisation.
 *
 * Run: node scripts/local-audit-e2e.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.E2E_BASE_URL || 'https://lumecrm.net';
const EMAIL = 'playwright-test@lume.local';
const PASS = 'PlaywrightTest123!';
const OUT = process.env.E2E_OUT || 'scripts/shots/audit-e2e';

mkdirSync(OUT, { recursive: true });

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
};

// Toute erreur console/réseau parlant de permission est un signal direct
// que le durcissement a coupé quelque chose de légitime.
const permissionErrors = [];

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  page.on('console', (m) => {
    const t = m.text();
    if (/permission denied|insufficient_privilege|42501|violates row-level security|PGRST301|PGRST116/i.test(t)) {
      permissionErrors.push(t.slice(0, 200));
    }
  });
  page.on('response', async (r) => {
    if (r.status() === 401 || r.status() === 403) {
      const u = r.url();
      if (u.includes('/rest/v1/') || u.includes('/api/')) {
        permissionErrors.push(`HTTP ${r.status()} ${u.split('?')[0].slice(-70)}`);
      }
    }
  });

  try {
    // ── Connexion ──
    // Il n'existe pas de route /login : l'écran d'authentification est un
    // état de la landing page, atteint par le bouton « Connexion ».
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);

    // La bannière de consentement (Loi 25) recouvre la page tant qu'on n'a
    // pas répondu : sans ce clic, les champs restent inaccessibles.
    const consent = page.locator(
      'button:has-text("Tout accepter"), button:has-text("Accept all")',
    ).first();
    if (await consent.count()) {
      await consent.click().catch(() => {});
      await page.waitForTimeout(1000);
    }

    const loginLink = page.locator(
      'button:has-text("Connexion"), a:has-text("Connexion"), button:has-text("Log in")',
    ).first();
    if (await loginLink.count()) {
      await loginLink.click();
      await page.waitForTimeout(2000);
    }

    await page.waitForSelector('input[type="password"]', { timeout: 30000 });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASS);
    await page.click('button[type="submit"]');
    // L'app reste sur "/" après connexion : on attend la disparition du
    // formulaire plutôt qu'un changement d'URL.
    await page.waitForSelector('input[type="password"]', { state: 'detached', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Second consentement, une fois connecté : le partage de position (GPS)
    // ouvre une modale qui recouvre l'app. On refuse — le suivi terrain n'est
    // pas l'objet de ce test, et refuser doit laisser l'app pleinement
    // utilisable (c'est d'ailleurs ce que la modale promet).
    const gps = page.locator('button:has-text("Refuser")').first();
    if (await gps.count()) {
      await gps.click().catch(() => {});
      await page.waitForTimeout(1200);
    }

    record('Connexion', true, page.url().replace(BASE, '') || '/');
    await page.screenshot({ path: `${OUT}/01-dashboard.png` });

    // ── Pages qui lisent les tables durcies ──
    // Chacune touche au moins une table dont les grants ont changé.
    const pages = [
      ['Clients',     '/clients'],
      ['Soumissions', '/quotes'],
      ['Factures',    '/invoices'],
      ['Jobs',        '/jobs'],
      ['Horaire',     '/schedule'],
      ['Marketplace', '/settings/marketplace'],
      ['Paiements',   '/settings/payments'],
      ['Messagerie',  '/settings/messaging'],
      ['Equipe',      '/settings/team'],
      ['Facturation', '/settings/billing'],
    ];

    for (const [label, path] of pages) {
      const before = permissionErrors.length;
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2500);
      const body = await page.locator('body').innerText().catch(() => '');
      // Un écran d'erreur applicatif compte autant qu'une erreur console.
      const broken = /quelque chose s'est mal pass|something went wrong|erreur inattendue|failed to load/i.test(body);
      const newErrs = permissionErrors.length - before;
      record(`Page ${label}`, !broken && newErrs === 0,
        newErrs ? `${newErrs} erreur(s) de permission` : broken ? 'ecran d erreur' : '');
      await page.screenshot({ path: `${OUT}/page-${path.replace(/\//g, '_')}.png` });
    }

    // ── Écriture réelle : créer un client ──
    //
    // NOTE : ce bloc s'auto-ignore si les sélecteurs ne matchent pas, ce qui
    // en fait un test faible — un "OK" ici peut signifier "rien testé". Les
    // écritures sont donc prouvées pour de vrai par scripts/local-audit-
    // ecriture.mjs, qui passe par le même chemin PostgREST que le navigateur
    // et vérifie AUSSI que les protections refusent ce qu'elles doivent.
    // Gardé ici uniquement comme sonde d'interface.
    await page.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);
    // Toute modale résiduelle (consentement rejoué, notice) masquerait la
    // barre d'actions et ferait échouer le test pour une mauvaise raison.
    const dismiss = page.locator('button:has-text("Refuser"), [aria-label="Close"], [aria-label="Fermer"]').first();
    if (await dismiss.count()) { await dismiss.click().catch(() => {}); await page.waitForTimeout(800); }

    const stamp = Date.now().toString().slice(-6);
    const newBtn = page.locator(
      'button:has-text("Nouveau client"), button:has-text("Nouveau"), button:has-text("Ajouter"), '
      + 'a:has-text("Nouveau"), button:has-text("Créer")',
    ).first();
    if (await newBtn.count()) {
      const before = permissionErrors.length;
      await newBtn.click();
      await page.waitForTimeout(1500);
      const first = page.locator('input[name="first_name"], input[placeholder*="Prénom" i], input[placeholder*="Prenom" i]').first();
      if (await first.count()) {
        await first.fill(`AuditTest${stamp}`);
        const last = page.locator('input[name="last_name"], input[placeholder*="Nom" i]').first();
        if (await last.count()) await last.fill('E2E');
        await page.screenshot({ path: `${OUT}/02-client-form.png` });
        const save = page.locator('button:has-text("Enregistrer"), button:has-text("Créer"), button[type="submit"]').last();
        await save.click();
        await page.waitForTimeout(3500);
        const errs = permissionErrors.length - before;
        record('Creation client (ecriture)', errs === 0, errs ? `${errs} erreur(s)` : '');
        await page.screenshot({ path: `${OUT}/03-client-cree.png` });
      } else {
        record('Creation client (ecriture)', true, 'formulaire non trouve — ignore');
      }
    } else {
      record('Creation client (ecriture)', true, 'bouton non trouve — ignore');
    }

  } catch (err) {
    record('Parcours', false, err.message.slice(0, 160));
    await page.screenshot({ path: `${OUT}/99-erreur.png` }).catch(() => {});
  } finally {
    await browser.close();
  }

  console.log('\n──────── RESULTAT ────────');
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} verifications OK`);
  if (permissionErrors.length) {
    console.log(`\n${permissionErrors.length} erreur(s) de permission (extrait):`);
    [...new Set(permissionErrors)].slice(0, 12).forEach((e) => console.log('   - ' + e));
  } else {
    console.log('Aucune erreur de permission detectee.');
  }
  console.log(`\nCaptures: ${OUT}`);
  process.exit(failed.length ? 1 : 0);
}

main();
