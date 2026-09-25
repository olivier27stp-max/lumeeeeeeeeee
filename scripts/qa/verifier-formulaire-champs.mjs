/**
 * Formulaire de demande → champs personnalisés, de bout en bout (staging).
 *
 *   FRONTEND_URL=http://localhost:5288 API_URL=http://localhost:3188 \
 *     node --env-file=.env.local scripts/qa/verifier-formulaire-champs.mjs
 *
 * Ajoute au formulaire du compte QA deux questions liées à un champ (client :
 * liste ; opportunité : nombre), soumet le formulaire PUBLIC comme un
 * visiteur, vérifie les valeurs sur le client et le deal créés, capture
 * Réglages du formulaire et la fiche de la demande, puis remet tout en place.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const BASE = (process.env.FRONTEND_URL || 'http://localhost:5288').replace(/\/$/, '');
const API = (process.env.API_URL || 'http://localhost:3188').replace(/\/$/, '');
const url = process.env.VITE_SUPABASE_URL;
if (!url?.includes(process.env.SUPABASE_PROJECT_REF) || url.includes(process.env.SUPABASE_PROJECT_REF_PROD)) throw new Error('staging seulement');
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(url, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: l } = await admin.auth.admin.generateLink({ type: 'magiclink', email: process.env.QA_COMPTE || 'willhebert30@gmail.com' });
const { data: s } = await anon.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' });
const { data: m } = await admin.from('memberships').select('org_id').eq('user_id', s.user.id).eq('status', 'active').limit(1).maybeSingle();
const org = m.org_id;
const jeton = { access_token: s.session.access_token, refresh_token: s.session.refresh_token, expires_at: s.session.expires_at, expires_in: s.session.expires_in, token_type: 'bearer', user: s.user };
const api = async (methode, chemin, corps, auth = true) => {
  const r = await fetch(`${API}${chemin}`, {
    method: methode,
    headers: { ...(auth ? { Authorization: `Bearer ${jeton.access_token}`, 'x-org-id': org } : {}), 'Content-Type': 'application/json' },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  return { status: r.status, j: await r.json().catch(() => null) };
};
const ok = [];
const ko = [];
const verifier = (nom, cond, detail = '') => (cond ? ok : ko).push(`${nom}${detail ? ` — ${detail}` : ''}`);

await admin.from('org_features').upsert({ org_id: org, feature: 'custom_fields_v2', enabled: true }, { onConflict: 'org_id,feature' });
const creesChamps = [];
const nouveauChamp = async (corps) => {
  const r = await api('POST', '/api/custom-fields', corps);
  if (r.status !== 201) throw new Error(`champ : ${r.status} ${JSON.stringify(r.j)}`);
  creesChamps.push(r.j.field.id);
  return r.j.field;
};
const suffixe = Date.now().toString(36);
const champClient = await nouveauChamp({ object_type: 'client', label: `QA batiment ${suffixe}`, field_type: 'dropdown_single', options: [{ label: 'Résidentiel' }, { label: 'Commercial' }] });
const champDeal = await nouveauChamp({ object_type: 'deal', label: `QA fenetres ${suffixe}`, field_type: 'number' });

const { j: { form: original } } = await api('GET', '/api/request-forms');
if (!original?.api_key) throw new Error("le compte QA n'a pas de formulaire de demande");
const base = {
  title: original.title, description: original.description ?? null, success_message: original.success_message,
  enabled: original.enabled ?? true, logo_url: original.logo_url ?? null, custom_fields: original.custom_fields ?? [],
  notify_email: original.notify_email ?? false, notify_in_app: original.notify_in_app ?? true,
};
const questions = [
  { id: `qa_bat_${suffixe}`, label: 'Type de bâtiment ?', type: 'dropdown', options: ['Résidentiel', 'Commercial'], required: false, section: 'service_details', cf_field_id: champClient.id },
  { id: `qa_fen_${suffixe}`, label: 'Combien de fenêtres ?', type: 'number', required: false, section: 'service_details', cf_field_id: champDeal.id },
];
let courriel = '';
try {
  const up = await api('POST', '/api/request-forms', { ...base, enabled: true, custom_fields: [...base.custom_fields, ...questions] });
  verifier('formulaire enregistré avec les liens vers les champs', up.status === 200 || up.status === 201, String(up.status));
  const { j: { form: relu } } = await api('GET', '/api/request-forms');
  verifier('le lien question → champ est conservé', (relu.custom_fields ?? []).filter((q) => q.cf_field_id).length >= 2);

  const pub = await api('GET', `/api/public/form/${original.api_key}`, null, false);
  verifier('page publique : les deux questions sont servies', JSON.stringify(pub.j ?? {}).includes('Combien de fen'), String(pub.status));
  courriel = `qa.formulaire.${suffixe}@exemple.invalid`;
  const envoi = await api('POST', `/api/public/form/${original.api_key}/submit`, {
    first_name: 'QA', last_name: `Formulaire ${suffixe}`, email: courriel, phone: '5145550199',
    custom_responses: { [questions[0].id]: 'Commercial', [questions[1].id]: '14' },
  }, false);
  verifier('soumission publique acceptée', envoi.status === 200 && envoi.j?.ok, `${envoi.status} ${JSON.stringify(envoi.j)}`);

  await new Promise((r) => setTimeout(r, 2500));
  const { data: client } = await admin.from('clients').select('id').eq('org_id', org).eq('email', courriel).is('deleted_at', null).maybeSingle();
  const { data: deal } = client
    ? await admin.from('deals').select('id').eq('org_id', org).eq('client_id', client.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  verifier('client et opportunité créés', !!client && !!deal);
  if (client && deal) {
    const vc = await api('GET', `/api/custom-values/client/${client.id}`);
    const vd = await api('GET', `/api/custom-values/deal/${deal.id}`);
    const valC = vc.j?.values?.[champClient.id]?.value;
    const valD = vd.j?.values?.[champDeal.id]?.value;
    const commercial = champClient.options.find((o) => o.label === 'Commercial')?.id;
    verifier('client : « Commercial » écrit dans le champ liste (libellé → option)', valC === commercial, JSON.stringify(valC));
    verifier('opportunité : « 14 » écrit dans le champ nombre', valD === 14, JSON.stringify(valD));
  }

  const dir = path.join(process.cwd(), 'qa-captures');
  fs.mkdirSync(dir, { recursive: true });
  const nav = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await nav.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t, o) => {
    localStorage.setItem('lume-auth-token', JSON.stringify(t));
    localStorage.setItem('lume-active-org', o);
    localStorage.setItem('lume-language', 'fr');
    localStorage.setItem('lume-setup-dismissed', '1');
    localStorage.setItem('lume.cookieConsent.v1', JSON.stringify({ analytics: false, marketing: false, preferences: false, decidedAt: new Date().toISOString(), docVersion: 'cookie-policy-2026-07-23' }));
  }, jeton, org);
  const trouverEtCentrer = (motif) => page.evaluate((src) => {
    const re = new RegExp(src);
    const el = [...document.querySelectorAll('*')].find((x) => x.children.length <= 1 && re.test(x.textContent || ''));
    if (el) el.scrollIntoView({ block: 'center' });
    return el ? (el.textContent || '').trim().slice(0, 120) : null;
  }, motif);
  await page.goto(`${BASE}/settings/request-form`, { waitUntil: 'networkidle2', timeout: 60000 });
  // Page de réglages chargée à la demande : attendre la question plutôt qu'un délai fixe.
  await page.waitForFunction(() => [...document.querySelectorAll('input')].some((i) => /Combien de fen/.test(i.value)), { timeout: 20000 }).catch(() => {});
  // Le libellé d'une question est la VALEUR d'un champ de saisie ; son sélecteur
  // « champ personnalisé » est un <select> dans le même bloc.
  const lie = await page.evaluate((idChamp) => {
    const entree = [...document.querySelectorAll('input')].find((i) => /Combien de fen/.test(i.value));
    if (!entree) return null;
    entree.scrollIntoView({ block: 'center' });
    // Remonter jusqu'au bloc de la question qui contient le sélecteur de champ.
    let bloc = entree.parentElement;
    const selecteurDe = (b) => [...b.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === idChamp));
    while (bloc && !selecteurDe(bloc)) bloc = bloc.parentElement;
    const choix = bloc ? selecteurDe(bloc) : null;
    return choix ? choix.value === idChamp : false;
  }, champDeal.id);
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(dir, 'formulaire-1-reglages.png') });
  verifier('réglages du formulaire : la question affiche le champ auquel elle est liée', lie === true, String(lie));
  if (envoi.j?.submission_id) {
    await page.goto(`${BASE}/requests/${envoi.j.submission_id}`, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 2000));
    const lien = await trouverEtCentrer('a rempli le champ');
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: path.join(dir, 'formulaire-2-demande.png') });
    verifier('fiche de la demande : « a rempli le champ »', !!lien, lien ?? page.url());
  }
  await nav.close();
  verifier('aucune erreur navigateur', erreurs.length === 0, erreurs.join(' | '));
} finally {
  await api('POST', '/api/request-forms', base);
  if (courriel) {
    const { data: c } = await admin.from('clients').select('id').eq('org_id', org).eq('email', courriel).maybeSingle();
    if (c) {
      await admin.from('deals').delete().eq('org_id', org).eq('client_id', c.id);
      await admin.from('form_submissions').delete().eq('org_id', org).eq('email', courriel);
      await admin.from('custom_field_values').delete().eq('client_id', c.id);
      await admin.from('clients').delete().eq('id', c.id);
    }
  }
  if (creesChamps.length) {
    await admin.from('custom_field_values').delete().in('field_id', creesChamps);
    await admin.from('custom_field_options').delete().in('field_id', creesChamps);
    await admin.from('custom_fields').delete().in('id', creesChamps);
  }
}
for (const x of ok) console.log('  ✓', x);
for (const x of ko) console.log('  ✗', x);
console.log(`${ok.length}/${ok.length + ko.length} vérifications`);
process.exit(ko.length ? 1 : 0);
