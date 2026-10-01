/**
 * Outillage des vérifications de la section Automatisations AU VRAI NAVIGATEUR, sur le VRAI site
 * (https://lumecrm.net), dans le bureau de test « Grok Audit (TEST) ».
 *
 * Garde-fous :
 *  · refuse tout autre bureau que celui-là (vérifié par son nom en base, à chaque lancement) ;
 *  · exige que le bureau soit en bac à sable (`orgs_envois_simules`) : aucun texto, courriel ni
 *    webhook ne peut partir ;
 *  · n'écrit, par le client service_role, QUE dans ce bureau, et seulement des brouillons de test
 *    qu'il retire ensuite par identifiant ;
 *  · ne clique jamais « M'envoyer un essai ».
 *
 * Variables attendues (dans `.env.local`, jamais ailleurs) : SUPABASE_URL_PROD,
 * SUPABASE_SERVICE_ROLE_KEY_PROD. Sorties (captures, JSON) : QA_SORTIES, sinon le dossier temporaire.
 */
import { chromium, firefox, webkit } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pw = { chromium, firefox, webkit };

export const SITE = 'https://lumecrm.net';
export const ORG = '0df93da0-dc34-481c-be91-bab69a4989b0';
export const NOM_ORG = 'Grok Audit (TEST)';
/** Les comptes du bureau de test, par rôle (adresses fictives). */
export const COMPTES = {
  proprietaire: 'viktor.audit@lume-test.ca',
  admin: 'grok1.audit@lume-test.ca',
  vendeur: 'grok2.audit@lume-test.ca',
  technicien: 'grok3.audit@lume-test.ca',
};
export const SORTIES = process.env.QA_SORTIES || join(tmpdir(), 'lume-qa-automations-prod');
export const CAPTURES = join(SORTIES, 'captures');
mkdirSync(CAPTURES, { recursive: true });

const url = process.env.SUPABASE_URL_PROD;
const cle = process.env.SUPABASE_SERVICE_ROLE_KEY_PROD;
if (!url || !cle) throw new Error('SUPABASE_URL_PROD / SUPABASE_SERVICE_ROLE_KEY_PROD manquants (.env.local).');
export const admin = createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: org } = await admin.from('orgs').select('name').eq('id', ORG).single();
if (org?.name !== NOM_ORG) throw new Error('REFUS : ce n’est pas le bureau de test.');

let anon = null;
/** La clé publique, lue dans le paquet servi par le site : celle que le navigateur d'un client utilise. */
async function cleAnon() {
  if (anon) return anon;
  const html = await (await fetch(SITE)).text();
  const js = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
  anon = (await (await fetch(SITE + js)).text()).match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0];
  if (!anon) throw new Error('clé publique introuvable');
  return anon;
}

export async function enBacASable() {
  const { data } = await admin.from('orgs_envois_simules').select('org_id').eq('org_id', ORG).maybeSingle();
  return !!data;
}

/** Une session neuve par lien magique (aucun mot de passe, aucun courriel envoyé). */
export async function session(email) {
  const { data: lien, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new Error(`lien magique : ${error.message}`);
  const pub = createClient(url, await cleAnon(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: s, error: e2 } = await pub.auth.verifyOtp({ token_hash: lien.properties.hashed_token, type: 'magiclink' });
  if (e2 || !s.session) throw new Error(`session ${email} : ${e2?.message}`);
  return s.session;
}

/**
 * Moniteur console + réseau, actif pendant toute la visite.
 *  m.console, m.exceptions, m.reseau (réponses >= 400), m.echecs (requêtes qui n'aboutissent pas)
 *  m.marque() rend un index ; m.depuis(index) ce qui est arrivé depuis.
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
    // Une navigation annule les requêtes en vol : ce n'est pas un défaut.
    if (/ERR_ABORTED|NS_BINDING_ABORTED|cancelled|Load request cancelled/i.test(raison)) return;
    m.echecs.push({ method: r.method(), url: r.url().replace(base, '').slice(0, 220), raison });
  });
  m.marque = () => ({ c: m.console.length, x: m.exceptions.length, r: m.reseau.length, e: m.echecs.length });
  m.depuis = (i) => ({ console: m.console.slice(i.c), exceptions: m.exceptions.slice(i.x), reseau: m.reseau.slice(i.r), echecs: m.echecs.slice(i.e) });
  return m;
}

/** Ouvre un onglet connecté au bureau de test. o : { email, navigateur, viewport, langue, tactile, userAgent, delai } */
export async function ouvrir(o = {}) {
  if (!(await enBacASable())) throw new Error('ARRÊT : le bureau de test n’est pas en bac à sable — rien ne tourne.');
  const s = await session(o.email ?? COMPTES.proprietaire);
  const type = o.navigateur ?? 'chromium';
  const browser = await pw[type].launch({ headless: true });
  const viewport = o.viewport ?? { width: 1440, height: 900 };
  const langue = o.langue ?? 'fr';
  const context = await browser.newContext({
    viewport, locale: langue === 'en' ? 'en-CA' : 'fr-CA', timezoneId: 'America/Toronto',
    ...(o.tactile ? { hasTouch: true, ...(type !== 'firefox' && viewport.width < 800 ? { isMobile: true } : {}) } : {}),
    ...(o.userAgent ? { userAgent: o.userAgent } : {}),
  });
  await context.addInitScript(({ s, org, langue, site }) => {
    if (location.origin !== site) return;
    // Une seule fois par onglet : l'app rafraîchit ensuite SON jeton.
    if (sessionStorage.getItem('qa-init')) return;
    sessionStorage.setItem('qa-init', '1');
    localStorage.setItem('lume-auth-token', s);
    localStorage.setItem('lume-active-org', org);
    localStorage.setItem('lume-language', langue);
    localStorage.setItem('lume-setup-dismissed', '1');
  }, { s: JSON.stringify(s), org: ORG, langue, site: SITE });
  const page = await context.newPage();
  page.setDefaultTimeout(o.delai ?? 20_000);
  const m = moniteur(page, SITE);
  return {
    page, context, browser, base: SITE, m, jeton: s.access_token,
    /** Répond au bandeau de témoins s'il est là (il recouvre le bas de l'écran). */
    temoins: async () => { const b = page.getByRole('button', { name: /Tout refuser|Reject all/ }); if (await b.count()) await b.first().click().catch(() => undefined); },
    fermer: async () => { await context.close().catch(() => undefined); await browser.close().catch(() => undefined); },
  };
}

/** Capture d'écran, hors du dépôt. Rend le chemin. */
export async function capture(page, nom, plein = false) {
  const chemin = join(CAPTURES, `${nom.replace(/[^a-z0-9-]+/gi, '_').slice(0, 90)}.png`);
  await page.screenshot({ path: chemin, fullPage: plein }).catch(() => undefined);
  return chemin;
}

/** Ménage : retire les règles du bureau de test dont le nom contient la marque. Rend leur nombre. */
export async function nettoyer(marque) {
  if (!marque || marque.length < 6) throw new Error('marque trop courte');
  const { data } = await admin.from('automation_rules').select('id').eq('org_id', ORG).ilike('name', `%${marque}%`);
  const ids = (data ?? []).map((r) => r.id);
  if (!ids.length) return 0;
  await admin.from('automation_scheduled_tasks').delete().in('automation_rule_id', ids).eq('org_id', ORG);
  await admin.from('automation_rules').delete().in('id', ids).eq('org_id', ORG);
  return ids.length;
}

/** Retire UN brouillon de test par identifiant (jamais une règle publiée). Rend true s'il a été retiré. */
export async function retirerBrouillon(id) {
  const { data: r } = await admin.from('automation_rules').select('id, is_active').eq('org_id', ORG).eq('id', id).maybeSingle();
  if (!r || r.is_active) return false;
  await admin.from('automation_scheduled_tasks').delete().eq('automation_rule_id', id).eq('org_id', ORG);
  const { error } = await admin.from('automation_rules').delete().eq('id', id).eq('org_id', ORG);
  return !error;
}

/** Tous les éléments interactifs VISIBLES de la page (ou d'un conteneur), avec leur position. */
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
        tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '', type: el.getAttribute('type') || '', nom,
        desactive: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
        x: Math.round(r.left), y: Math.round(r.top), l: Math.round(r.width), h: Math.round(r.height),
        dansEcran, couvert, debordeX: r.right > innerWidth + 1 || r.left < -1,
      });
    }
    return { url: location.pathname + location.search, largeur: innerWidth, defilementX: document.documentElement.scrollWidth > innerWidth + 1, elements: out };
  }, racine);
}
