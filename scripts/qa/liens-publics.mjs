#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   LES LIENS QU'UN CLIENT REÇOIT — ouverts SANS session, comme lui.

   Le parcours (qa:parcours) prouve que les données se créent. Mais ce
   que le client final voit passe par trois pages publiques, atteintes
   par un jeton dans un courriel : le devis à accepter, la facture à
   payer, son portail. Personne n'est connecté sur ces pages. Si l'une
   casse, le client ne peut ni accepter ni payer — et ne le dira pas.

   CE QU'IL FAIT
     1. crée client + devis (avec une ligne) + facture + lien de paiement,
        par les MÊMES chemins que l'application
     2. ouvre chaque lien dans un navigateur vierge
     3. vérifie que la page montre ce que le client doit voir
     4. accepte le devis depuis la page publique et relit la base
     5. vérifie qu'un jeton faux ne montre RIEN
     6. range tout

   Usage : FRONTEND_URL=http://localhost:5174 node --env-file=.env.local scripts/qa/liens-publics.mjs
   ═══════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const RACINE = process.cwd();
const BASE = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const API = (process.env.API_URL || 'http://localhost:3002').replace(/\/$/, '');
const URL_SB = process.env.VITE_SUPABASE_URL;
const CLE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLE_ANON = process.env.VITE_SUPABASE_ANON_KEY;
const COMPTE = process.env.QA_COMPTE || 'willhebert30@gmail.com';
const MARQUE = '[QA]';
if (!URL_SB || !CLE_SERVICE || !CLE_ANON) { console.error('Variables Supabase manquantes'); process.exit(2); }

const admin = createClient(URL_SB, CLE_SERVICE, { auth: { persistSession: false } });
const resultats = [];
const ok = (nom, vrai, detail = '') => { resultats.push({ nom, vrai: !!vrai, detail }); console.log(`  ${vrai ? '✓' : '✗'} ${nom}${detail ? ' — ' + detail : ''}`); return !!vrai; };

async function session() {
  const { data: lien } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTE });
  const anon = createClient(URL_SB, CLE_ANON, { auth: { persistSession: false } });
  const { data } = await anon.auth.verifyOtp({ token_hash: lien.properties.hashed_token, type: 'magiclink' });
  return data.session;
}

const suffixe = Date.now().toString(36);
const cree = {};
let nav;
try {
  const s = await session();
  const user = createClient(URL_SB, CLE_ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${s.access_token}` } } });
  const { data: membre } = await admin.from('memberships').select('org_id').eq('user_id', s.user.id).eq('status', 'active').limit(1).maybeSingle();
  const orgId = membre.org_id;
  console.log(`  Compte : ${COMPTE}\n`);

  /* ── 1. Les données, par les chemins de l'application ─────── */
  console.log('1. Préparation');
  const { data: client, error: eC } = await user.from('clients').insert({
    org_id: orgId, first_name: `${MARQUE} Public`, last_name: suffixe,
    email: `qa-public-${suffixe}@exemple.invalid`, phone: '+15005550006', status: 'active',
  }).select('id, portal_token, first_name, last_name').single();
  if (!ok('client créé', !eC && client, eC?.message)) throw new Error('sans client');
  cree.client = client.id;

  const { data: creation, error: eQ } = await user.rpc('rpc_create_quote', {
    p_lead_id: null, p_client_id: client.id, p_title: `${MARQUE} Devis public ${suffixe}`,
    p_salesperson_id: s.user.id, p_context_type: 'client', p_currency: 'CAD', p_valid_days: 30,
    p_notes: null, p_contract: null, p_deposit_required: false, p_require_payment_method: false,
  });
  const quoteId = creation?.quote_id ? String(creation.quote_id) : null;
  if (!ok('devis créé', !eQ && quoteId, eQ?.message)) throw new Error('sans devis');
  cree.quote = quoteId;
  const { error: eL } = await user.from('quote_line_items').insert({
    org_id: orgId, quote_id: quoteId, name: 'Lavage de vitres', quantity: 2, unit_price_cents: 12500, total_cents: 25000,
  });
  ok('une ligne de 250 $ ajoutée au devis', !eL, eL?.message);
  { const { error: eR } = await user.rpc('rpc_recalculate_quote', { p_quote_id: quoteId }); if (eR) console.log('  · recalcul : ' + eR.message.slice(0, 80)); }
  const { data: devis } = await admin.from('quotes').select('view_token, total_cents, quote_number, status').eq('id', quoteId).single();
  ok('le devis a un jeton public et un total', devis?.view_token && Number(devis.total_cents) > 0, `n° ${devis?.quote_number}, ${(devis?.total_cents || 0) / 100} $`);

  const { data: facture, error: eF } = await user.from('invoices').insert({
    org_id: orgId, client_id: client.id, subject: `${MARQUE} Facture publique ${suffixe}`, status: 'sent',
    subtotal_cents: 25000, tax_cents: 3744, total_cents: 28744, issued_at: new Date().toISOString(),
  }).select('id, invoice_number').single();
  if (!ok('facture créée', !eF && facture, eF?.message)) throw new Error('sans facture');
  cree.invoice = facture.id;

  const rep = await fetch(`${API}/api/payment-requests/create`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.access_token}`, 'x-org-id': orgId },
    body: JSON.stringify({ invoiceId: facture.id, orgId }),
  });
  const corps = await rep.json().catch(() => ({}));
  const jetonPaiement = corps?.public_token || corps?.paymentRequest?.public_token || corps?.request?.public_token || null;
  if (!rep.ok && /not ready|onboarding/i.test(String(corps?.error || ''))) {
    // Pas de compte Stripe Connect sur cette organisation (normal sur
    // staging) : la page de paiement n'est pas testable ici. On le dit,
    // sans compter un échec — mais sans le compter comme réussi non plus.
    console.log('  · lien de paiement : aucun compte Stripe Connect sur cette org — page /pay non testable ici');
  } else {
    ok('lien de paiement créé (POST /api/payment-requests/create)', rep.ok && jetonPaiement, rep.ok ? '' : `${rep.status} ${JSON.stringify(corps).slice(0, 120)}`);
  }

  /* ── 2. Les pages, sans session ────────────────────────────── */
  nav = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const dir = path.join(RACINE, 'qa-captures'); fs.mkdirSync(dir, { recursive: true });

  async function ouvrir(nom, chemin) {
    const ctx = await nav.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const erreurs = []; const echecs = [];
    page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 120)); });
    page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/api/')) echecs.push(`${r.status()} ${r.url().replace(BASE, '').replace(API, '').split('?')[0]}`); });
    await page.goto(BASE + chemin, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));
    const texte = await page.evaluate(() => document.body.innerText);
    await page.screenshot({ path: path.join(dir, `${nom}.png`), fullPage: true });
    return { page, ctx, texte, erreurs, echecs };
  }

  console.log('\n2. Le devis, tel que le client le voit');
  {
    const { page, ctx, texte, erreurs, echecs } = await ouvrir('devis-public', `/quote/${devis.view_token}`);
    ok('la page s affiche', texte.length > 200, `${texte.length} caractères`);
    ok('elle montre le titre du devis', texte.includes(`Devis public ${suffixe}`));
    ok('elle montre le montant', /250[,.]00|287[,.]44/.test(texte), (texte.match(/\d+[,.]\d{2}\s?\$/g) || []).slice(0, 3).join(' '));
    ok('elle propose d accepter', /Accepter la soumission|Accept Quote/i.test(texte));
    ok('aucune requête en échec', echecs.length === 0, echecs.join(' | '));
    ok('aucune erreur console', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    // L'ouverture doit être COMPTÉE : c'est ce qui déclenche « le client a
    // ouvert votre devis ». Bug du 2026-09-06 : le serveur rejetait tout
    // jeton en forme d'UUID — soit 100 % des jetons — et ne comptait rien.
    {
      const { data: vu } = await admin.from('quotes').select('is_viewed, view_count').eq('id', quoteId).single();
      ok('l ouverture est enregistrée en base (is_viewed)', vu?.is_viewed === true && Number(vu?.view_count) > 0, `is_viewed=${vu?.is_viewed}, view_count=${vu?.view_count}`);
    }

    // Accepter depuis la page publique
    const clique = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((e) => /Accepter la soumission|Accept Quote/i.test(e.innerText));
      if (!b) return false; b.click(); return true;
    });
    await new Promise((r) => setTimeout(r, 1500));
    // La fenêtre d'acceptation exige une signature dessinée (PNG validé par
    // ses octets magiques côté serveur) et un nom. On dessine un trait.
    const canvas = await page.$('canvas');
    if (canvas) {
      const b = await canvas.boundingBox();
      await page.mouse.move(b.x + 20, b.y + b.height / 2);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + 20 + i * (b.width - 40) / 8, b.y + b.height / 2 + (i % 2 ? -8 : 8), { steps: 3 });
      await page.mouse.up();
    }
    const champNom = await page.$('input[type="text"], input:not([type])');
    if (champNom) { await champNom.click({ clickCount: 3 }); await champNom.type('QA Client'); }
    ok('la fenêtre d acceptation offre une signature', !!canvas);
    // Puis le bouton de confirmation.
    const confirme = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((e) => /^(Confirmer|Confirm|Accepter|Accept|Signer|Sign)/i.test(e.innerText.trim()) && !/la soumission|Quote/i.test(e.innerText));
      if (!b) return null; b.click(); return b.innerText.trim();
    });
    await new Promise((r) => setTimeout(r, 3000));
    const { data: apres } = await admin.from('quotes').select('status, approved_at').eq('id', quoteId).single();
    ok('accepter depuis la page publique change le statut en base', clique && apres?.status === 'approved', `bouton ${clique ? 'cliqué' : 'INTROUVABLE'}${confirme ? ', confirmé « ' + confirme + ' »' : ''} → statut ${apres?.status}`);
    await page.screenshot({ path: path.join(dir, 'devis-public-apres.png'), fullPage: true });
    await ctx.close();
  }

  console.log('\n3. La page de paiement');
  if (jetonPaiement) {
    const { ctx, texte, erreurs, echecs } = await ouvrir('paiement-public', `/pay/${jetonPaiement}`);
    ok('la page s affiche', texte.length > 100, `${texte.length} caractères`);
    ok('elle montre le montant à payer', /287[,.]44/.test(texte), (texte.match(/\d+[,.]\d{2}\s?\$/g) || []).slice(0, 3).join(' '));
    ok('elle montre le numéro de facture ou le sujet', texte.includes(String(facture.invoice_number)) || texte.includes(`Facture publique ${suffixe}`));
    ok('aucune requête en échec', echecs.length === 0, echecs.join(' | '));
    ok('aucune erreur console', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    ok('un moyen de payer est proposé (ou un message clair)', /Payer|Pay now|Pay \$|carte|card|Stripe|PayPal|non configur|not configured|indisponible/i.test(texte), texte.slice(0, 160).replace(/\n+/g, ' | '));
    await ctx.close();
  } else {
    console.log('  · sautée (pas de lien de paiement)');
  }

  console.log('\n4. Le portail client');
  {
    const { ctx, texte, erreurs, echecs } = await ouvrir('portail-client', `/portal/${client.portal_token}`);
    ok('la page s affiche', texte.length > 100, `${texte.length} caractères`);
    ok('elle nomme le client', texte.includes(client.first_name) || texte.includes(suffixe));
    ok('elle liste sa facture', texte.includes(String(facture.invoice_number)) || /287[,.]44/.test(texte));
    ok('elle liste son devis', texte.includes(String(devis.quote_number)) || /250[,.]00/.test(texte));
    ok('aucune requête en échec', echecs.length === 0, echecs.join(' | '));
    ok('aucune erreur console', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  console.log('\n5. Un jeton faux ne montre rien');
  for (const [nom, chemin] of [['devis', '/quote/00000000-0000-0000-0000-000000000000'], ['paiement', '/pay/' + 'a'.repeat(48)], ['portail', '/portal/00000000-0000-0000-0000-000000000000']]) {
    const { ctx, texte } = await ouvrir(`faux-${nom}`, chemin);
    const fuite = texte.includes(suffixe) || /287[,.]44|250[,.]00/.test(texte);
    ok(`${nom} : rien du vrai dossier n apparaît`, !fuite, /introuvable|not found|invalide|invalid|expir/i.test(texte) ? 'message d\'erreur affiché' : texte.slice(0, 80).replace(/\n+/g, ' | '));
    await ctx.close();
  }
} catch (e) {
  console.log(`\n  interrompu : ${e.message}`);
} finally {
  if (nav) await nav.close();
  /* ── 6. Rangement ──────────────────────────────────────────── */
  console.log('\n6. Rangement');
  const rates = resultats.filter((r) => !r.vrai).length;
  if (rates === 0) {
    if (cree.invoice) { await admin.from('payment_requests').delete().eq('invoice_id', cree.invoice); await admin.from('invoices').delete().eq('id', cree.invoice); }
    if (cree.quote) { await admin.from('quote_line_items').delete().eq('quote_id', cree.quote); await admin.from('quotes').delete().eq('id', cree.quote); }
    if (cree.client) await admin.from('clients').delete().eq('id', cree.client);
    console.log('  · tout est rangé');
  } else {
    console.log(`  · ${rates} échec(s) : les données sont GARDÉES comme pièces à conviction (${Object.entries(cree).map(([k, v]) => k + ' ' + String(v).slice(0, 8)).join(', ')})`);
  }
  console.log('\n' + '═'.repeat(60));
  console.log(`  ${resultats.filter((r) => r.vrai).length}/${resultats.length} vérifications passées`);
  for (const r of resultats.filter((r) => !r.vrai)) console.log(`  ✗ ${r.nom}${r.detail ? ' — ' + r.detail : ''}`);
  fs.writeFileSync(path.join(RACINE, 'qa-liens-publics.json'), JSON.stringify({ genereLe: new Date().toISOString(), resultats, cree }, null, 2));
  process.exit(rates ? 1 : 0);
}
