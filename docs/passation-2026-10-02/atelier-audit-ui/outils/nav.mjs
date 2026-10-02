/**
 * Boîte à outils de l'audit d'interface des Automatisations (vrai navigateur).
 *
 * Lancer un script qui l'importe :
 *   cd D:/lume-uiaudit/outils
 *   PLAYWRIGHT_BROWSERS_PATH=D:/lume-uiaudit/pw-browsers node --env-file=D:/lume-uiaudit/wt/.env.local mon-script.mjs
 *
 * L'app locale (API sans fournisseur réel + Vite) doit tourner : voir
 * serveurs.mts ; son état est dans D:/lume-uiaudit/sorties/serveurs.json.
 * Base de données : STAGING, bureaux de test en bac à sable. Jamais la prod.
 */
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire('D:/lume-uiaudit/wt/package.json');
const pw = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');

export const SORTIES = 'D:/lume-uiaudit/sorties';
export const CAPTURES = join(SORTIES, 'captures');
mkdirSync(CAPTURES, { recursive: true });

const REF_PROD = 'bbzcuzqfgsdvjsymfwmr';
const URL_SB = process.env.VITE_SUPABASE_URL ?? '';
const ANON = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!URL_SB || URL_SB.includes(REF_PROD)) throw new Error('REFUS : cet outillage ne tourne que sur STAGING.');

/** État des serveurs locaux (URL, bureaux, comptes). `lumi: true` = l'instance avec Lumi branché. */
export function etat(lumi = false) {
  return JSON.parse(readFileSync(join(SORTIES, lumi ? 'serveurs-lumi.json' : 'serveurs.json'), 'utf8'));
}

/** Client service_role (lecture de vérification, préparation de données de test). */
export const admin = createClient(URL_SB, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const VERSION_TEMOINS = readFileSync('D:/lume-uiaudit/wt/src/lib/consentApi.ts', 'utf8')
  .match(/CURRENT_COOKIE_POLICY_VERSION\s*=\s*'([^']+)'/)?.[1] ?? '';

/** Une session neuve par lien magique (client À PART : après verifyOtp il agit comme l'utilisateur). */
export async function session(email) {
  const { data: l, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new Error(`lien magique ${email} : ${error.message}`);
  const pub = createClient(URL_SB, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: s, error: e2 } = await pub.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' });
  if (e2 || !s.session) throw new Error(`session ${email} : ${e2?.message}`);
  return s.session;
}

export const VIEWPORTS = {
  bureau: { width: 1440, height: 900 },
  ipadPaysage: { width: 1024, height: 768 },
  ipadPortrait: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 },
};

/**
 * Ouvre un onglet connecté.
 *  compte : clé de etat().comptes (proprioA, techA, proprioB, adminA…) ou un courriel
 *  navigateur : 'chromium' | 'webkit' | 'firefox'
 *  viewport : clé de VIEWPORTS ou { width, height } ; tactile : true pour simuler le toucher
 * Rend { page, context, browser, base, org, m (moniteur), fermer }.
 */
export async function ouvrir(o = {}) {
  const e = etat(o.lumi);
  const compte = o.compte ?? 'proprioA';
  const email = compte.includes('@') ? compte : e.comptes[compte]?.email;
  if (!email) throw new Error(`compte inconnu : ${compte}`);
  const org = o.org ?? (compte === 'proprioB' ? e.orgB : e.orgA);
  const s = o.sansSession ? null : await session(email);
  const type = o.navigateur ?? 'chromium';
  const browser = await pw[type].launch({ headless: o.visible ? false : true });
  const viewport = typeof o.viewport === 'string' ? VIEWPORTS[o.viewport] : (o.viewport ?? VIEWPORTS.bureau);
  const langue = o.langue ?? 'fr';
  const context = await browser.newContext({
    viewport,
    locale: langue === 'en' ? 'en-CA' : 'fr-CA',
    timezoneId: 'America/Toronto',
    ...(o.tactile && type !== 'firefox' ? { hasTouch: true, isMobile: viewport.width < 800 } : {}),
    ...(o.tactile && type === 'firefox' ? { hasTouch: true } : {}),
  });
  if (s) {
    const jeton = {
      access_token: s.access_token, refresh_token: s.refresh_token,
      expires_at: s.expires_at, expires_in: s.expires_in, token_type: 'bearer', user: s.user,
    };
    await context.addInitScript(({ jeton, org, langue, origine, version }) => {
      if (location.origin !== origine) return;
      if (sessionStorage.getItem('qa-ui-init')) return;   // une fois par onglet : l'app rafraîchit ensuite SON jeton
      sessionStorage.setItem('qa-ui-init', '1');
      localStorage.setItem('lume-auth-token', JSON.stringify(jeton));
      localStorage.setItem('lume-active-org', org);
      localStorage.setItem('lume-language', langue);
      localStorage.setItem('lume.cookieConsent.v1', JSON.stringify({
        analytics: false, marketing: false, preferences: false, decidedAt: new Date().toISOString(), docVersion: version,
      }));
      localStorage.setItem('lume-setup-dismissed', '1');
    }, { jeton, org, langue, origine: e.base, version: VERSION_TEMOINS });
  }
  const page = await context.newPage();
  page.setDefaultTimeout(o.delai ?? 15_000);
  const m = moniteur(page, e.base);
  return {
    page, context, browser, base: e.base, api: e.api, org, email, jeton: s?.access_token ?? null, m,
    fermer: async () => { await context.close().catch(() => undefined); await browser.close().catch(() => undefined); },
  };
}

/**
 * Moniteur console + réseau, actif pendant toute la visite.
 *  m.console   : erreurs de console (et avertissements React « Warning: »)
 *  m.exceptions: exceptions de page et promesses rejetées non gérées
 *  m.reseau    : réponses >= 400 { status, method, url }
 *  m.echecs    : requêtes qui n'ont pas abouti { method, url, raison }
 *  m.marque()  : rend un index ; m.depuis(index) rend ce qui est arrivé depuis
 */
export function moniteur(page, base) {
  const m = { console: [], exceptions: [], reseau: [], echecs: [] };
  const bruit = (t) => /Download the React DevTools|\[vite\]|favicon/i.test(t);
  page.on('console', (msg) => {
    const t = msg.text();
    if (bruit(t)) return;
    if (msg.type() === 'error' || (msg.type() === 'warning' && /^Warning:/.test(t))) m.console.push({ type: msg.type(), texte: t.slice(0, 500), url: page.url() });
  });
  page.on('pageerror', (err) => m.exceptions.push({ texte: String(err?.message ?? err).slice(0, 500), url: page.url() }));
  page.on('response', (r) => {
    const s = r.status();
    if (s >= 400) m.reseau.push({ status: s, method: r.request().method(), url: r.url().replace(base, '').slice(0, 220), page: page.url().replace(base, '') });
  });
  page.on('requestfailed', (r) => {
    const raison = r.failure()?.errorText ?? '';
    if (/ERR_ABORTED|NS_BINDING_ABORTED|cancelled|Load request cancelled/i.test(raison)) return;   // navigation qui annule une requête
    m.echecs.push({ method: r.method(), url: r.url().replace(base, '').slice(0, 220), raison });
  });
  m.marque = () => ({ c: m.console.length, x: m.exceptions.length, r: m.reseau.length, e: m.echecs.length });
  m.depuis = (i) => ({ console: m.console.slice(i.c), exceptions: m.exceptions.slice(i.x), reseau: m.reseau.slice(i.r), echecs: m.echecs.slice(i.e) });
  m.propre = (i) => { const d = m.depuis(i); return !d.console.length && !d.exceptions.length && !d.echecs.length && !d.reseau.some((x) => x.status >= 500); };
  return m;
}

/** Tous les éléments interactifs VISIBLES de la page (ou d'un conteneur). */
export async function inventaire(page, racine = 'body') {
  return page.evaluate((racine) => {
    const sel = 'a[href], button, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="switch"], [role="checkbox"], [role="link"], input, select, textarea, summary, [tabindex]:not([tabindex="-1"]), [draggable="true"], [onclick]';
    const vus = new Set();
    const out = [];
    for (const el of document.querySelector(racine)?.querySelectorAll(sel) ?? []) {
      if (vus.has(el)) continue; vus.add(el);
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || st.visibility === 'hidden' || st.display === 'none') continue;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const dansEcran = cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight;
      let couvert = null;
      if (dansEcran) {
        const haut = document.elementFromPoint(cx, cy);
        if (haut && haut !== el && !el.contains(haut) && !haut.contains(el)) couvert = (haut.tagName + (haut.className && typeof haut.className === 'string' ? '.' + haut.className.split(' ')[0] : '')).slice(0, 60);
      }
      const nom = (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || (el.labels?.[0]?.textContent) || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90);
      out.push({
        tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '', type: el.getAttribute('type') || '',
        nom, texte: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        desactive: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
        href: el.getAttribute('href') || '',
        x: Math.round(r.left), y: Math.round(r.top), l: Math.round(r.width), h: Math.round(r.height),
        dansEcran, couvert, debordeX: r.right > innerWidth + 1 || r.left < -1,
      });
    }
    return { url: location.pathname + location.search, largeur: innerWidth, defilementX: document.documentElement.scrollWidth > innerWidth + 1, elements: out };
  }, racine);
}

/** Capture d'écran hors dépôt. Rend le chemin. */
export async function capture(page, nom, plein = false) {
  const chemin = join(CAPTURES, `${nom.replace(/[^a-z0-9-]+/gi, '_').slice(0, 90)}.png`);
  await page.screenshot({ path: chemin, fullPage: plein }).catch(() => undefined);
  return chemin;
}

/** Consigne un constat (une ligne JSON) dans le fichier de la section. */
export function noter(section, c) {
  appendFileSync(join(SORTIES, `constats-${section}.jsonl`), JSON.stringify({ quand: new Date().toISOString(), ...c }) + '\n');
}

/** Crée une règle dans un bureau de test (service_role). `ligne` : colonnes d'automation_rules. */
export async function creerRegle(org, ligne) {
  const { data, error } = await admin.from('automation_rules').insert({
    org_id: org, trigger_event: 'lead.created', conditions: {}, delay_seconds: 0,
    actions: [{ type: 'log_activity', config: {} }], is_active: false, ...ligne,
  }).select('*').single();
  if (error) throw new Error(`creerRegle : ${error.message}`);
  return data;
}
export async function lireRegle(id) {
  const { data, error } = await admin.from('automation_rules').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`lireRegle : ${error.message}`);
  return data;
}
/** Ménage : supprime les règles du bureau de test dont le nom contient la marque (et leurs tâches/journaux). */
export async function nettoyer(org, marque) {
  const e = etat();
  if (org !== e.orgA && org !== e.orgB) throw new Error('REFUS : nettoyer() ne touche que les bureaux de test de l’audit.');
  const { data } = await admin.from('automation_rules').select('id').eq('org_id', org).ilike('name', `%${marque}%`);
  const ids = (data ?? []).map((r) => r.id);
  if (!ids.length) return 0;
  await admin.from('automation_scheduled_tasks').delete().in('automation_rule_id', ids);
  await admin.from('automation_execution_logs').delete().in('automation_rule_id', ids);
  await admin.from('automation_rules').delete().in('id', ids);
  return ids.length;
}

/** Attend qu'une lecture satisfasse une condition (pas de délai fixe). */
export async function attendre(lire, ok, delaiMs = 15_000, pasMs = 300) {
  const fin = Date.now() + delaiMs;
  let v;
  for (;;) {
    v = await lire();
    if (ok(v)) return v;
    if (Date.now() > fin) throw new Error(`attendre : délai dépassé, dernière valeur = ${JSON.stringify(v)?.slice(0, 300)}`);
    await new Promise((r) => setTimeout(r, pasMs));
  }
}
