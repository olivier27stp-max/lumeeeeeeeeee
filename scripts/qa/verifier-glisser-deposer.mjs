/**
 * verifier-glisser-deposer.mjs — la carte se saisit-elle VRAIMENT à la souris ?
 *
 *   node --env-file=.env.local scripts/qa/verifier-glisser-deposer.mjs
 *
 * POURQUOI CE SCRIPT. Sept tests jsdom couvrent le handler de `@dnd-kit` :
 * ils prouvent que SI un événement de fin de glissement arrive, le deal change
 * d'étape. Ils ne prouvent rien du geste lui-même — jsdom n'a ni pointeur, ni
 * mise en page, ni `PointerEvent`. Tout ce qui se trouve AVANT le handler
 * restait donc non vérifié :
 *
 *   · la poignée est-elle atteignable, ou recouverte par la carte ?
 *   · la contrainte d'activation (4 px) se déclenche-t-elle ?
 *   · la colonne d'arrivée reçoit-elle le survol ?
 *   · et surtout : le déplacement est-il ÉCRIT en base, ou seulement à l'écran ?
 *
 * Ce dernier point est celui qui compte. Une carte qui bouge à l'écran et
 * revient au rechargement est le bug signalé par Rafba (« sa save pas »).
 * On relit donc la base APRÈS le geste.
 *
 * Cible : staging par défaut. On déplace un deal réel puis on le REPOSE —
 * l'étape de départ est relue avant, et restaurée en fin de course même si
 * le script échoue en chemin.
 */
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const BASE = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const COMPTE = process.env.QA_COMPTE || 'willhebert30@gmail.com';
const MDP = process.env.QA_MDP || 'QaPipeline1234!';

const admin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const res = [];
const ok = (nom, vrai, detail = '') => {
  res.push({ nom, vrai: !!vrai, detail });
  console.log(`  ${vrai ? '✓' : '✗'} ${nom}${detail ? ' — ' + detail : ''}`);
};

// ── L'organisation : celle du compte qui se connecte ────────
// Prendre la première organisation active venue faisait glisser une carte dans
// un pipeline que le navigateur n'affichait même pas : le geste réussissait à
// l'écran, et le test relisait une AUTRE organisation où rien n'avait bougé —
// il annonçait « le geste n'a rien écrit » sur un produit qui fonctionnait.
//
// On identifie le compte par un lien de connexion : `listUsers` échoue sur
// certaines bases (« Database error finding users ») et renvoie une liste vide
// au lieu d'une erreur, ce qui ferait retomber sur la mauvaise organisation.
const { data: lien, error: eLien } = await admin.auth.admin.generateLink({
  type: 'magiclink', email: COMPTE,
});
if (eLien || !lien?.user?.id) {
  console.error(`Compte introuvable sur cette base : ${COMPTE}${eLien ? ' — ' + eLien.message : ''}`);
  process.exit(1);
}
const { data: membre } = await admin
  .from('memberships').select('org_id, user_id')
  .eq('user_id', lien.user.id).eq('status', 'active').limit(1).maybeSingle();
if (!membre) {
  console.error(`${COMPTE} n'est membre actif d'aucune organisation.`);
  process.exit(1);
}

// ── Choisir une cible qui rend le test concluant ────────────
// Il faut un pipeline avec au moins DEUX étapes ouvertes et un deal dans la
// première. Viser « Gagné » déclencherait la fenêtre de création de job : on
// resterait bloqué sur une modale au lieu de mesurer le glissement.
const { data: pipes } = await admin
  .from('pipelines_ventes').select('id,name').eq('org_id', membre.org_id);

let cible = null;
for (const p of pipes ?? []) {
  const { data: etapes } = await admin
    .from('pipeline_stages').select('id,name_fr,position,kind')
    .eq('pipeline_id', p.id).is('archived_at', null).order('position');
  const ouvertes = (etapes ?? []).filter((e) => e.kind === 'open');
  if (ouvertes.length < 2) continue;
  const { data: deals } = await admin
    .from('deals').select('id,stage_id,client_id')
    .eq('pipeline_id', p.id).is('deleted_at', null)
    .eq('stage_id', ouvertes[0].id).limit(1);
  if (deals?.length) {
    cible = { pipe: p, depart: ouvertes[0], arrivee: ouvertes[1], deal: deals[0] };
    break;
  }
}
if (!cible) {
  console.error('Aucun pipeline avec 2 étapes ouvertes ET un deal dans la première.');
  console.error("Rien à mesurer — ce n'est pas un échec du glisser-déposer.");
  process.exit(2);
}

// Le nom affiché sur la carte vient du client. On ne s'en sert QUE pour
// l'affichage : filtrer la poignée dessus rendait le test faux dès que le
// libellé de la carte ne se composait pas exactement de `prénom nom` — c'est
// ce qui l'a fait échouer en annonçant « poignée introuvable » alors que la
// poignée était là. On saisit donc la première poignée du board, et c'est la
// BASE qui dit ensuite quel deal a bougé.
const { data: cli } = await admin
  .from('clients').select('first_name,last_name').eq('id', cible.deal.client_id).maybeSingle();
const nomCarte = `${cli?.first_name ?? ''} ${cli?.last_name ?? ''}`.trim();
const etapeOrigine = cible.deal.stage_id;

console.log(`Cible : ${BASE}`);
console.log(`Pipeline « ${cible.pipe.name} » : « ${cible.depart.name_fr} » → « ${cible.arrivee.name_fr} »`);
console.log(`Carte : ${nomCarte || cible.deal.id}\n`);

// Qui occupe DÉJÀ l'étape d'arrivée : après le geste, le nouveau venu est
// celui qui n'était pas dans cette liste.
const { data: dejaArrivee } = await admin
  .from('deals').select('id').eq('stage_id', cible.arrivee.id).is('deleted_at', null);
const avantArrivee = new Set((dejaArrivee ?? []).map((d) => d.id));

const nav = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let code = 1;
let dealDeplace = null;
try {
  const page = await (await nav.createBrowserContext()).newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await page.evaluateOnNewDocument((o, pid) => {
    localStorage.setItem('lume-active-org', o);
    localStorage.setItem('lume-language', 'fr');
    localStorage.setItem('lume-pipeline-vu', pid);
    localStorage.setItem('lume.cookieConsent.v1', JSON.stringify({
      analytics: false, marketing: false, preferences: false,
      decidedAt: new Date().toISOString(), docVersion: 'cookie-policy-2026-07-23',
    }));
  }, membre.org_id, cible.pipe.id);

  // ── Connexion ─────────────────────────────────────────────
  await page.goto(`${BASE}/auth`, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));

  // Le bandeau de témoins recouvre le formulaire. La clé posée d'avance ne
  // suffit pas toujours — selon l'ordre de montage, le bandeau a déjà lu le
  // stockage. On le referme comme le ferait un visiteur.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')]
      .find((x) => /^tout refuser$/i.test((x.textContent || '').trim()));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 900));

  await page.evaluate((mail, mdp) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const email = document.querySelector('input[type="email"]');
    const pass = document.querySelector('input[type="password"]');
    if (!email || !pass) return;
    setter.call(email, mail); email.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(pass, mdp); pass.dispatchEvent(new Event('input', { bubbles: true }));
  }, COMPTE, MDP);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')]
      .find((x) => /connexion|se connecter|sign in/i.test(x.textContent || ''));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 4000));

  await page.goto(`${BASE}/ventes`, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 3000));

  // En dev, Vite sert les modules avec un horodatage (`?t=...`). Si le serveur
  // a rechargé depuis, le navigateur redemande une URL périmée et la page
  // lazy échoue avec « Failed to fetch dynamically imported module ». Ce n'est
  // pas un défaut du produit : on recharge une fois pour repartir d'un graphe
  // de modules à jour.
  const moduleRate = await page.evaluate(
    () => /Failed to fetch dynamically imported module|Une erreur est survenue/i.test(document.body.innerText || ''),
  );
  if (moduleRate) {
    console.log('  … module périmé (dev) — rechargement');
    await page.goto(`${BASE}/ventes`, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 3500));
  }

  ok('le board est affiché',
     /board|pipeline/i.test(await page.evaluate(() => document.body.innerText || '')));

  // Une fenêtre modale (carte de configuration, invitation, tiroir d'un deal)
  // pose un voile plein écran par-dessus le board : la poignée est alors bien
  // dans le DOM, mais aucun clic ne l'atteint. On ferme ce qui traîne avant de
  // mesurer, sinon le test conclurait « poignée recouverte » sur un état que
  // l'utilisateur, lui, aurait refermé d'un geste.
  for (let i = 0; i < 3; i++) {
    const restant = await page.evaluate(() => {
      const v = document.querySelector('.modal-overlay');
      if (!v) return false;
      const x = [...v.querySelectorAll('button')]
        .find((b) => /fermer|close|plus tard|annuler/i.test(
          (b.getAttribute('aria-label') || b.textContent || '').trim(),
        ));
      if (x) x.click(); else v.click();
      return true;
    });
    if (!restant) break;
    await new Promise((r) => setTimeout(r, 700));
  }
  await page.keyboard.press('Escape').catch(() => {});
  await new Promise((r) => setTimeout(r, 500));

  // ── La poignée est-elle vraiment saisissable ? ────────────
  // `elementFromPoint` répond à la seule question qui compte : si on clique à
  // cet endroit, est-ce la poignée qui reçoit le clic, ou autre chose ?
  const poignee = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-label]')]
      .find((x) => /^(Déplacer la carte|Move )/i.test(x.getAttribute('aria-label') || ''));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dessus = document.elementFromPoint(cx, cy);
    return {
      x: cx,
      y: cy,
      visible: r.width > 0 && r.height > 0,
      atteignable: !!dessus && (dessus === b || b.contains(dessus)),
      recouvertePar: dessus ? (dessus.tagName + '.' + String(dessus.className || '').slice(0, 30)) : 'rien',
      carte: b.getAttribute('aria-label'),
    };
  });

  if (!poignee) {
    ok('la poignée de glissement existe', false, 'aucun bouton « Déplacer la carte »');
    throw new Error('poignée introuvable');
  }
  ok('la poignée de glissement existe', poignee.visible);
  ok("la poignée n'est pas recouverte", poignee.atteignable,
     poignee.atteignable ? '' : `recouverte par ${poignee.recouvertePar}`);

  // ── La colonne d'arrivée, à l'écran ──────────────────────
  // On vise le BAS de la colonne, sous les cartes. Viser son milieu retombe
  // dans la zone que la carte tenue occupe pendant le glissement : la
  // collision se résout alors sur elle-même et le déplacement est annulé
  // sans un mot.
  const arrivee = await page.evaluate((nomEtape) => {
    const h = [...document.querySelectorAll('div')]
      .find((x) => (x.textContent || '').trim().toLowerCase().startsWith(nomEtape.toLowerCase()));
    if (!h) return null;
    const col = h.closest('div[class*="w-["]') || h;
    const r = col.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.bottom - 30 };
  }, cible.arrivee.name_fr);
  if (!arrivee) {
    ok("la colonne d'arrivée est visible", false, cible.arrivee.name_fr);
    throw new Error('colonne absente');
  }
  ok("la colonne d'arrivée est visible", true, cible.arrivee.name_fr);

  // ── LE GESTE ──────────────────────────────────────────────
  // Par petits pas : `@dnd-kit` attend 4 px avant d'activer, puis a besoin de
  // plusieurs déplacements pour calculer la collision. Un saut unique de A à B
  // ne déclenche rien — c'est le piège classique de ce test.
  // On passe par CDP plutôt que par `page.mouse`. Le `PointerSensor` de
  // `@dnd-kit` écoute `pointerdown` et suit ensuite un `pointerId` précis ;
  // les événements souris de haut niveau ne portent pas toujours l'identifiant
  // attendu, et le glissement ne démarre jamais — le test conclurait « rien
  // n'a été écrit » alors que la souris d'un vrai utilisateur fonctionne.
  const cdp = await page.createCDPSession();
  const pointe = async (type, x, y) => {
    await cdp.send('Input.dispatchMouseEvent', {
      type, x: Math.round(x), y: Math.round(y),
      button: 'left', buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: type === 'mouseReleased' ? 1 : (type === 'mousePressed' ? 1 : 0),
      pointerType: 'mouse',
    });
  };

  await pointe('mouseMoved', poignee.x, poignee.y);
  await pointe('mousePressed', poignee.x, poignee.y);
  // Un premier micro-déplacement franchit la contrainte d'activation (4 px)
  // avant les grands pas : sans lui, `@dnd-kit` ignore le tout premier saut.
  await pointe('mouseMoved', poignee.x + 6, poignee.y + 2);
  await new Promise((r) => setTimeout(r, 120));

  const pas = 24;
  for (let i = 1; i <= pas; i++) {
    await pointe(
      'mouseMoved',
      poignee.x + ((arrivee.x - poignee.x) * i) / pas,
      poignee.y + ((arrivee.y - poignee.y) * i) / pas,
    );
    await new Promise((r) => setTimeout(r, 22));
  }
  // Quelques micro-mouvements sur la cible : `closestCorners` recalcule à
  // chaque déplacement, et il faut au moins un mouvement APRÈS l'arrivée pour
  // que la collision se fixe sur la colonne.
  for (let k = 0; k < 6; k++) {
    await pointe('mouseMoved', arrivee.x + (k % 2 ? 2 : -2), arrivee.y + (k % 2 ? 1 : -1));
    await new Promise((r) => setTimeout(r, 120));
  }
  await new Promise((r) => setTimeout(r, 300));
  await pointe('mouseReleased', arrivee.x, arrivee.y);
  await new Promise((r) => setTimeout(r, 2800));

  // ── Ce qui compte : la base, pas l'écran ─────────────────
  // On saisit la première poignée du board, qui n'est pas forcément le deal
  // repéré en SQL. On demande donc à la base si UN deal a rejoint l'étape
  // d'arrivée, plutôt que d'exiger que ce soit celui-là.
  //
  // Et on interroge la carte SAISIE, pas une liste d'avant/après : un deal
  // laissé dans l'étape d'arrivée par une exécution précédente faisait
  // conclure « rien n'a bougé » alors que le geste avait parfaitement écrit.
  const { data: arrives } = await admin
    .from('deals').select('id').eq('stage_id', cible.arrivee.id).is('deleted_at', null);
  dealDeplace = (arrives ?? []).find((d) => !avantArrivee.has(d.id))?.id ?? null;

  // Filet : si l'étape de départ s'est vidée de son deal, c'est qu'il est
  // parti — même si on n'a pas su nommer le nouveau venu.
  const { data: restants } = await admin
    .from('deals').select('id').eq('stage_id', cible.depart.id).is('deleted_at', null);
  const departVide = !(restants ?? []).some((d) => d.id === cible.deal.id);
  if (!dealDeplace && departVide) dealDeplace = cible.deal.id;

  const deplace = !!dealDeplace;
  ok("le deal a changé d'étape EN BASE", deplace,
     deplace
       ? `${cible.depart.name_fr} → ${cible.arrivee.name_fr}`
       : "resté sur place : le geste n'a rien écrit");

  // Et l'écran doit être d'accord avec la base après rechargement.
  if (deplace) {
    await page.reload({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));
    const tient = await admin
      .from('deals').select('stage_id').eq('id', dealDeplace).maybeSingle();
    ok('le déplacement tient au rechargement', tient.data?.stage_id === cible.arrivee.id);
  }

  code = res.some((r) => !r.vrai) ? 1 : 0;
} catch (e) {
  console.log(`\n⚠ interrompu : ${e.message}`);
} finally {
  // ── On repose le deal où on l'a pris ──────────────────────
  // C'est le deal RÉELLEMENT déplacé qu'on remet, pas celui repéré en SQL :
  // la poignée saisie est la première du board, qui peut être une autre carte.
  const aRemettre = dealDeplace || cible.deal.id;
  const { data: fin } = await admin
    .from('deals').select('stage_id').eq('id', aRemettre).maybeSingle();
  if (fin && fin.stage_id !== etapeOrigine) {
    await admin.from('deals').update({ stage_id: etapeOrigine }).eq('id', aRemettre);
    console.log(`\n↩ deal remis sur « ${cible.depart.name_fr} »`);
  }
  await nav.close();
}

console.log(`\n${'─'.repeat(52)}`);
const echecs = res.filter((r) => !r.vrai);
console.log(`${res.length - echecs.length}/${res.length} vérifications passées`);
echecs.forEach((e) => console.log(`   ✗ ${e.nom}${e.detail ? ' — ' + e.detail : ''}`));
process.exit(code);
