#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   LES FORMULAIRES — ce qu'on remplit reste-t-il vraiment ?

   Le pire bug d'une application de gestion n'est pas celui qui
   plante : c'est celui qui dit « enregistré » et ne garde rien.
   L'utilisateur ne s'en aperçoit que des jours plus tard, quand il
   revient chercher une information qui a disparu.

   Ce projet l'a déjà vécu : l'onboarding de facturation perdait
   toutes les données saisies, en silence.

   LA MÉTHODE, la seule qui prouve quelque chose :
     1. remplir un champ avec une valeur reconnaissable
     2. enregistrer
     3. RECHARGER la page — c'est l'étape que personne ne fait
     4. vérifier que la valeur est toujours là
     5. la relire aussi EN BASE, car l'écran peut mentir

   Un champ qui survit à l'écran mais pas en base est encore pire :
   il donne confiance jusqu'au prochain appareil.

   Usage : npm run qa:formulaires
   ═══════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const RACINE = process.cwd();
const BASE = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const URL_SB = process.env.VITE_SUPABASE_URL;
const CLE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLE_ANON = process.env.VITE_SUPABASE_ANON_KEY;
const COMPTE = process.env.QA_COMPTE || 'willhebert30@gmail.com';

if (!URL_SB || !CLE_SERVICE || !CLE_ANON) {
  console.error('Variables Supabase manquantes — lancer avec --env-file=.env.local');
  process.exit(2);
}
if (process.env.SUPABASE_PROJECT_REF_PROD && URL_SB.includes(process.env.SUPABASE_PROJECT_REF_PROD)) {
  console.error('REFUS : ce banc écrit dans les réglages. La cible est la PRODUCTION.');
  process.exit(2);
}

const admin = createClient(URL_SB, CLE_SERVICE, { auth: { persistSession: false } });
const resultats = [];
const ok = (nom, vrai, detail = '') => {
  resultats.push({ nom, vrai, detail });
  console.log(`  ${vrai ? '✓' : '✗'} ${nom}${detail ? ` — ${detail}` : ''}`);
  return vrai;
};

/* Les pages de réglages à éprouver, et où leurs données atterrissent.
   Sans la table, on ne saurait pas si l'écran ment. */
const PAGES = [
  { chemin: '/settings/company', nom: 'Entreprise', table: 'company_settings' },
  { chemin: '/settings/profile', nom: 'Mon profil', table: 'profiles', cle: 'id' },
  { chemin: '/settings/taxes', nom: 'Taxes', table: null },
  { chemin: '/settings/products', nom: 'Produits & Services', table: null },
  { chemin: '/settings/messaging', nom: 'Messagerie', table: null },
  { chemin: '/settings/request-form', nom: 'Formulaire de demande', table: null },
];

async function ouvrirSession() {
  const { data: lien } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTE });
  const anon = createClient(URL_SB, CLE_ANON, { auth: { persistSession: false } });
  const { data: sess } = await anon.auth.verifyOtp({
    token_hash: lien.properties.hashed_token, type: 'magiclink',
  });
  return sess.session;
}

async function degager(page) {
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (['Refuser', 'Tout refuser', 'Decline'].includes((b.textContent || '').trim())) b.click();
    }
  }).catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
}

/** Les champs de texte visibles et modifiables de la page. */
async function champsModifiables(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const out = [];
    // On ne regarde QUE la zone de contenu : la barre de recherche du haut et
    // les champs de la barre latérale ne sont pas des réglages. Sans ce
    // filtre, le banc modifiait « Rechercher partout… » et concluait à tort
    // que la saisie ne tenait pas.
    const zone = document.querySelector('#page-content-area') || document.body;
    const els = zone.querySelectorAll('input[type="text"], input:not([type]), input[type="email"], input[type="tel"], textarea');
    els.forEach((el, i) => {
      if (!visible(el) || el.disabled || el.readOnly) return;
      // Écarter explicitement tout ce qui est une recherche ou un filtre.
      const indice = `${el.getAttribute('name') || ''} ${el.getAttribute('id') || ''} ${el.getAttribute('placeholder') || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
      if (/recherch|search|filtre|filter/.test(indice)) return;
      // Un sélecteur de couleur (#111111) n'est pas un champ de saisie utile :
      // y ajouter du texte ne prouve rien sur la persistance des réglages.
      if (/^#[0-9a-f]{3,8}$/i.test(String(el.value || ''))) return;
      if (/couleur|color/.test(indice)) return;
      el.setAttribute('data-qa-champ', String(i));
      out.push({
        i,
        nom: el.getAttribute('name') || el.getAttribute('id') || el.getAttribute('placeholder') || `champ ${i}`,
        valeur: el.value,
        type: el.tagName.toLowerCase(),
      });
    });
    return out;
  });
}

async function main() {
  console.log('\n═══ Formulaires — ce qui est saisi reste-t-il ? ═══\n');

  const session = await ouvrirSession();
  const { data: membre } = await admin
    .from('memberships').select('org_id').eq('user_id', session.user.id)
    .eq('status', 'active').limit(1).maybeSingle();
  if (!membre) throw new Error(`aucune organisation active pour ${COMPTE}`);

  const nav = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await nav.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const jeton = {
    access_token: session.access_token, refresh_token: session.refresh_token,
    expires_at: session.expires_at, expires_in: session.expires_in,
    token_type: 'bearer', user: session.user,
  };
  await page.evaluateOnNewDocument((t, o) => {
    localStorage.setItem('lume-auth-token', JSON.stringify(t));
    localStorage.setItem('lume-active-org', o);
    localStorage.setItem('lume-language', 'fr');
  }, jeton, membre.org_id);

  for (const p of PAGES) {
    console.log(`\n── ${p.nom} (${p.chemin}) ──`);
    try {

    await page.goto(BASE + p.chemin, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2200));
    await degager(page);

    const champs = await champsModifiables(page);
    if (!champs.length) {
      console.log('  · aucun champ modifiable trouvé');
      continue;
    }

    // On modifie UN champ, le premier qui porte déjà une valeur : c'est le
    // plus représentatif d'une vraie modification, et le moins risqué.
    const cible = champs.find((c) => c.valeur && c.valeur.length > 1) || champs[0];
    const marqueur = `QA${Date.now().toString(36).slice(-5)}`;
    const nouvelle = `${cible.valeur || ''} ${marqueur}`.trim().slice(0, 80);

    const saisi = await page.evaluate((idx, val) => {
      const el = document.querySelector(`[data-qa-champ="${idx}"]`);
      if (!el) return false;
      // Passer par le setter natif : React ignore une écriture directe sur
      // `.value` et le champ reviendrait à son état d'avant.
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, cible.i, nouvelle);

    if (!ok(`le champ « ${cible.nom} » accepte la saisie`, saisi)) continue;
    await new Promise((r) => setTimeout(r, 600));

    // Enregistrer : on cherche le bouton qui le dit.
    const enregistre = await page.evaluate(() => {
      const MOTS = /^(enregistrer|sauvegarder|save|mettre à jour|update|appliquer|confirmer)$/i;
      for (const b of document.querySelectorAll('button')) {
        const t = (b.textContent || '').trim();
        if (MOTS.test(t) && !b.disabled) { b.click(); return t; }
      }
      return null;
    });

    if (!enregistre) {
      console.log('  · aucun bouton d\'enregistrement — le formulaire s\'enregistre peut-être seul');
    } else {
      console.log(`  · bouton « ${enregistre} » cliqué`);
    }
    await new Promise((r) => setTimeout(r, 2500));

    // LE test : recharger, et regarder si la valeur a survécu.
    console.log('  · rechargement…');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch((e) => console.log('    (reload: ' + String(e.message).slice(0,60) + ')'));
    console.log('  · rechargé');
    await new Promise((r) => setTimeout(r, 2400));
    await degager(page);

    const apres = await page.evaluate((marque) => {
      const els = document.querySelectorAll('input, textarea');
      for (const el of els) if (String(el.value || '').includes(marque)) return el.value;
      return null;
    }, marqueur);

    ok('la valeur survit au rechargement', !!apres, apres ? `« ${String(apres).slice(0, 40)} »` : 'PERDUE — la saisie ne tient pas');

    // L'écran peut mentir : la valeur peut n'être qu'en mémoire du navigateur.
    if (p.table) {
      // `profiles` est indexée par l'utilisateur (cle: 'id'), pas par l'org :
      // interroger org_id y renvoyait null et déclarait la valeur « absente »
      // alors qu'elle était bien en base (faux positif du 2026-09-02).
      const cle = p.cle || 'org_id';
      const valeur = cle === 'id' ? session.user.id : membre.org_id;
      const { data } = await admin.from(p.table).select('*').eq(cle, valeur).maybeSingle();
      const enBase = data ? JSON.stringify(data).includes(marqueur) : false;
      ok('elle est bien arrivée en base', enBase,
        enBase ? p.table : `absente de ${p.table} — l'écran affiche une valeur qui n'existe pas`);
    }
    } catch (e) {
      // Une page qui trébuche ne doit pas emporter les suivantes.
      console.log(`  · page interrompue : ${String(e.message).slice(0, 90)}`);
    }
  }

  await nav.close();

  const passees = resultats.filter((r) => r.vrai).length;
  fs.writeFileSync(
    path.join(RACINE, 'qa-formulaires.json'),
    JSON.stringify({ genereLe: new Date().toISOString(), passees, total: resultats.length, resultats }, null, 2),
    'utf8',
  );

  console.log('\n' + '═'.repeat(60));
  console.log(`  ${passees}/${resultats.length} vérifications passées`);
  const rates = resultats.filter((r) => !r.vrai);
  if (rates.length) {
    console.log('');
    rates.forEach((r) => console.log(`  ✗ ${r.nom}${r.detail ? ` — ${r.detail}` : ''}`));
  }
  console.log('\n  → qa-formulaires.json\n');
}

main().catch((e) => {
  console.error('\nBanc interrompu :', e.message);
  process.exit(1);
});
