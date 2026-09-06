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

   ⚠ CE QUE CE BANC A APPRIS À SES DÉPENS (2026-09-02)
   Il a accusé l'application de perdre les données saisies. C'était FAUX
   à chaque fois. Vérification manuelle : le PATCH renvoie 204, la valeur
   est bien en base, et elle se réaffiche au retour sur la page.

   Les six défauts qui produisaient ces fausses accusations :
     1. `page.reload()` restait bloqué sur le « voulez-vous quitter ? »
     2. il remplissait un sélecteur de couleur avec du texte
     3. il lisait `profiles` par `org_id` (cette table a pour clé `id`)
     4. il choisissait un champ AU HASARD — souvent l'autocomplétion
        d'adresse (`addr-xxxx`), qui ne s'enregistre pas au clavier
     5. il relisait l'écran AVANT que la page ait rechargé ses données
     6. il AJOUTAIT le marqueur à la valeur au lieu de la remplacer

   La leçon, valable pour tout banc de ce genre : quand l'outil accuse
   l'application, VÉRIFIER À LA MAIN avant de rapporter quoi que ce soit.
   Un rapport faux coûte plus cher qu'un test manquant.

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
  { chemin: '/settings/company', nom: 'Entreprise', table: 'company_settings', champs: ['acme corp'] },
  { chemin: '/settings/profile', nom: 'Mon profil', table: 'profiles', cle: 'id', champs: ['olivier'] },
  { chemin: '/settings/taxes', nom: 'Taxes', table: null },
  { chemin: '/settings/products', nom: 'Produits & Services', table: null },
  { chemin: '/settings/messaging', nom: 'Messagerie', table: null },
  { chemin: '/settings/request-form', nom: 'Formulaire de demande', table: 'request_forms', champs: ['demande de service', 'titre'] },
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
      // Un sélecteur de couleur peut se présenter en `type="color"` sans que
      // ni son nom ni sa valeur ne le trahissent : écarter le type lui-même.
      // Sans cela le banc « testait » #111111 et ne prouvait rien.
      if ((el.getAttribute('type') || '').toLowerCase() === 'color') return;
      // Un sélecteur de couleur se présente souvent en DEUX champs : une
      // pastille `type="color"` et un `type="text"` qui montre le code hexa.
      // Le second n'a ni nom ni étiquette — son « nom » finissait par être
      // sa propre valeur, « #111111 ». Écrire du texte dedans ne prouve rien
      // et fait échouer l'enregistrement pour une raison légitime.
      const voisinCouleur = el.parentElement
        && el.parentElement.querySelector('input[type="color"]');
      if (voisinCouleur) return;
      // Les champs d'autocomplétion d'adresse (`name="addr-xxxxxxxx"`) ne
      // s'enregistrent pas tels quels : ils attendent une sélection dans
      // leur liste de suggestions. Les remplir au clavier puis crier à la
      // perte de données était un faux positif — c'est ce qui rendait ce
      // banc irreproductible d'un passage à l'autre.
      if (/^addr-[a-z0-9]{6,}$/i.test(el.getAttribute('name') || '')) return;
      // Un champ sans nom ET sans étiquette n'est pas identifiable dans un
      // rapport : le signaler ne servirait à personne.
      // Un champ sans AUCUN repère (ni nom, ni id, ni placeholder, ni
      // étiquette) ne pourrait pas être nommé dans le rapport : on l'écarte.
      // Ici le placeholder suffit — c'est souvent le seul repère présent.
      if (!el.getAttribute('name') && !el.getAttribute('id')
          && !el.getAttribute('placeholder') && !el.getAttribute('aria-label')) return;
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
    // Le bandeau « Votre vie privée » recouvre la page et empêche d'atteindre
    // les champs. Cliquer « Tout refuser » ne suffit pas : le bandeau n'est
    // pas toujours monté quand on clique, et trois pages de réglages
    // restaient inaccessibles (taxes, produits, messagerie).
    // On dépose donc le choix DÉJÀ FAIT, avant même le chargement — ce que
    // fait `writeStoredConsent()` : refus de tout ce qui n'est pas essentiel.
    localStorage.setItem('lume.cookieConsent.v1', JSON.stringify({
      essential: true, analytics: false, marketing: false, preferences: false,
      decidedAt: new Date().toISOString(),
      docVersion: 'cookie-policy-2026-07-23',
    }));
  }, jeton, membre.org_id);

  for (const p of PAGES) {
    console.log(`\n── ${p.nom} (${p.chemin}) ──`);
    try {

    await page.goto(BASE + p.chemin, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await degager(page);
    // Attendre l'APPARITION d'un champ plutôt qu'un délai fixe : 2,2 s ne
    // suffisaient pas sur les pages qui chargent leurs données d'abord, et
    // le banc concluait à tort « aucun champ modifiable trouvé ».
    await page.waitForFunction(() => {
      const z = document.querySelector('#page-content-area');
      if (!z) return false;
      return [...z.querySelectorAll('input, textarea')]
        .some((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    }, { timeout: 15000 }).catch(() => {});

    const champs = await champsModifiables(page);
    if (!champs.length) {
      console.log('  · aucun champ modifiable trouvé');
      continue;
    }

    // On modifie UN champ, le premier qui porte déjà une valeur : c'est le
    // plus représentatif d'une vraie modification, et le moins risqué.
    // Choisir le champ au hasard rend le banc irreproductible : selon la
    // page, il tombait sur un champ d'autocomplétion d'adresse
    // (`addr-xxxxx`), le remplissait, cliquait « Enregistrer » — et
    // s'étonnait que le nom de l'entreprise n'ait pas changé. Deux passages
    // de suite donnaient deux verdicts opposés.
    //
    // On vise donc un champ NOMMÉ, celui que la page est censée enregistrer.
    const attendus = (p.champs || []).map((x) => x.toLowerCase());
    const identifiant = (c) => String(c.nom || '').toLowerCase();
    const cible = attendus.length
      ? champs.find((c) => attendus.some((a) => identifiant(c).includes(a)))
      : (champs.find((c) => c.valeur && c.valeur.length > 1) || champs[0]);

    if (!cible) {
      console.log(`  · aucun champ attendu (${attendus.join(', ') || 'non précisé'}) — page non éprouvée`);
      continue;
    }
    const marqueur = `QA${Date.now().toString(36).slice(-5)}`;
    // On REMPLACE la valeur au lieu de l'allonger. En ajoutant le marqueur à
    // la suite, chaque passage rallongeait le champ (« QAa QAb QAc … ») et
    // finissait par buter sur des limites de longueur ou de format : le banc
    // accusait alors l'application de perdre les données, alors qu'un test
    // manuel prouvait l'inverse (PATCH 204, valeur bien relue à l'écran).
    const nouvelle = marqueur;

    const saisi = await page.evaluate((idx, val) => {
      const el = document.querySelector(`[data-qa-champ="${idx}"]`);
      if (!el) return false;
      // Passer par le setter natif : React ignore une écriture directe sur
      // `.value` et le champ reviendrait à son état d'avant.
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      // `blur` manquait : plusieurs formulaires ne valident le champ qu'à la
      // sortie du focus. Sans lui, « Enregistrer » partait avec l'ancienne
      // valeur — l'enregistrement réussissait (204) mais n'écrivait rien de
      // nouveau, ce que le banc interprétait comme une perte de données.
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      // Confirmer que la valeur a bien pris : si React l'a rejetée, inutile
      // d'aller plus loin, on le dirait à tort « non enregistré ».
      return el.value === val;
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
    // On NE fait PAS page.reload() : si la page pose un « voulez-vous
    // vraiment quitter ? », le rechargement reste bloqué jusqu'au délai
    // d'attente et le banc s'arrête à la première page (constaté le
    // 2026-09-02). On repart de l'URL, ce qui prouve d'ailleurs mieux la
    // persistance : c'est le trajet d'un vrai utilisateur qui revient.
    console.log('  · rechargement…');
    page.removeAllListeners('dialog');
    page.on('dialog', (d) => d.accept().catch(() => {}));
    await page.goto('about:blank', { timeout: 15000 }).catch(() => {});
    await page.goto(BASE + p.chemin, { waitUntil: 'domcontentloaded', timeout: 30000 })
      .catch((e) => console.log('    (retour: ' + String(e.message).slice(0, 60) + ')'));
    console.log('  · rechargé');
    await new Promise((r) => setTimeout(r, 2400));
    await degager(page);

    // Après le retour sur la page, les champs sont d'abord VIDES : la page
    // doit encore aller chercher ses données. Lire tout de suite revenait à
    // conclure « valeur perdue » alors que l'enregistrement avait bien eu
    // lieu (vérifié : le PATCH renvoie 204 et la base contient la valeur).
    // On laisse donc au marqueur le temps de réapparaître avant de trancher.
    await page.waitForFunction((marque) => {
      for (const el of document.querySelectorAll('input, textarea')) {
        if (String(el.value || '').includes(marque)) return true;
      }
      return false;
    }, { timeout: 15000 }, marqueur).catch(() => {});

    const apres = await page.evaluate((marque) => {
      const els = document.querySelectorAll('input, textarea');
      for (const el of els) if (String(el.value || '').includes(marque)) return el.value;
      return null;
    }, marqueur);

    ok('la valeur survit au rechargement', !!apres, apres ? `« ${String(apres).slice(0, 40)} »` : 'PERDUE — la saisie ne tient pas');

    // L'écran peut mentir : la valeur peut n'être qu'en mémoire du navigateur.
    if (p.table) {
      // Toutes les tables ne sont pas indexées par `org_id` : `profiles`
      // l'est par `id` (l'utilisateur). Chercher au mauvais endroit faisait
      // conclure à une perte de données alors que tout était enregistré.
      const req = admin.from(p.table).select('*');
      const { data } = p.cle === 'id'
        ? await req.eq('id', session.user.id).maybeSingle()
        : await req.eq('org_id', membre.org_id).maybeSingle();
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
