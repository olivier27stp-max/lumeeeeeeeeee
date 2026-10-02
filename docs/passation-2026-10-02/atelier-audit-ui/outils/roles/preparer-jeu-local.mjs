#!/usr/bin/env node
/**
 * Jeu de bureaux « roles » sur la PILE LOCALE des E2E des automatisations — préparation et garde.
 *
 *   node D:/lume-uiaudit/outils/roles/preparer-jeu-local.mjs
 *
 * Pendant local de `garde-bureaux.mjs` (qui, lui, vise staging par `.env.local` et porte des identifiants
 * de bureaux de staging : ne pas le lancer contre la pile locale). Ce script :
 *   0. REFUSE toute adresse qui n'est pas 127.0.0.1 (aucune écriture sur staging ni en prod, jamais) —
 *      il parle directement à GoTrue et à PostgREST (conteneurs), sans le proxy : voir client-local.mjs ;
 *   0 bis. rend son nom à un bureau du jeu qu'un test a renommé (voir plus bas) ;
 *   1. si les bureaux « [TEST] QA Automatisations A / B (roles) » n'existent pas, lance UNE fois le banc commun
 *      (`lancer.mjs 00-banc --project=bureau`, E2E_JEU=roles) qui les crée par la même porte que tout bureau
 *      (bac à sable d'abord, forfait Autopilot, comptes propriétaire / admin / technicien / propriétaire B).
 *      `lancer.mjs` démarre alors lui-même proxy, API et Vite sur les ports E2E_PORT_* et les arrête à la fin :
 *      ne pas lancer ce script pendant qu'une autre commande `lancer.mjs` tourne sur les mêmes ports ;
 *   2. met à la corbeille tout doublon de A ou de B (le plus ancien est gardé), comme la garde de staging ;
 *   3. vérifie : un bureau A et un bureau B, tous deux en bac à sable, abonnement actif, les quatre comptes du banc ;
 *   4. pose les comptes de rôle que `_roles.ts` réclame en plus (vendeur, lecteur, éditeur, et les deux comptes
 *      « Messagerie SMS » — `_comptes.ts`).
 * Idempotent : relancé, il ne fait que vérifier.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { WT, PILE, clientService } from './client-local.mjs';

const a = clientService();

const JEU = 'roles';
const NOM = (l) => `[TEST] QA Automatisations ${l} (${JEU}) — ne pas utiliser`;
const EMAIL = (fragment) => `qa-auto-${fragment}+${JEU}@lume-qa.test`;

async function lire(quoi, f) {
  const r = await f();
  if (r.error) { console.error(`[jeu-local] ARRÊT : ${quoi} — ${r.error.message}`); process.exit(3); }
  return r.data ?? [];
}
const bureaux = (l) => lire(`lecture du bureau ${l}`, () => a.from('orgs').select('id, name, created_at').eq('name', NOM(l)).is('deleted_at', null).order('created_at'));

// ── 0 bis. Un bureau du jeu RENOMMÉ par un test ? ───────────────────────────
// Enregistrer Réglages › Entreprise recopie `company_name` dans `orgs.name` (server/routes/billing.ts) : le bureau
// « [TEST] … A (roles) » devient « Nettoyage Test A », plus personne ne le retrouve par son nom, et le banc commun en
// créerait un second. On le retrouve par son propriétaire (compte `+roles`) et on lui rend son nom.
for (const [l, fragment] of [['A', 'proprio-a'], ['B', 'proprio-b']]) {
  if ((await bureaux(l)).length > 0) continue;
  const { data: lien } = await a.auth.admin.generateLink({ type: 'magiclink', email: EMAIL(fragment) });
  const idProprio = lien?.user?.id;
  if (!idProprio) continue; // compte inconnu : le jeu n'a jamais été créé, le banc s'en charge ci-dessous
  const adhesions = await lire(`adhésions du propriétaire ${l}`, () => a.from('memberships').select('org_id').eq('user_id', idProprio).eq('role', 'owner').eq('status', 'active'));
  if (adhesions.length !== 1) { console.error(`[jeu-local] ARRÊT : le propriétaire ${l} a ${adhesions.length} bureau(x) — à regarder à la main.`); process.exit(3); }
  const org = adhesions[0].org_id;
  const [o] = await lire('bureau renommé', () => a.from('orgs').select('id, name, deleted_at').eq('id', org));
  const enBac = await lire('bac à sable', () => a.from('orgs_envois_simules').select('org_id').eq('org_id', org));
  if (!o || o.deleted_at || enBac.length !== 1) { console.error(`[jeu-local] ARRÊT : bureau ${org} du propriétaire ${l} à la corbeille ou hors bac à sable.`); process.exit(3); }
  await lire('nom du bureau', () => a.from('orgs').update({ name: NOM(l) }).eq('id', org).select('id'));
  console.log(`[jeu-local] bureau ${l} ${org} retrouvé sous le nom « ${o.name} » : nom du jeu rendu.`);
}

// ── 1. Création par le banc commun, une seule fois. ─────────────────────────
if ((await bureaux('A')).length === 0 || (await bureaux('B')).length === 0) {
  console.log('[jeu-local] bureaux « (roles) » absents : lancement du banc commun (00-banc) avec E2E_JEU=roles…');
  const r = spawnSync(process.execPath, ['scripts/qa/automations-e2e/lancer.mjs', '00-banc', '--project=bureau'], {
    cwd: WT, stdio: 'inherit', windowsHide: true,
    env: {
      ...process.env,
      E2E_PORT_PROXY: process.env.E2E_PORT_PROXY || '48424',
      E2E_PORT_API: process.env.E2E_PORT_API || '48305',
      E2E_PORT_VITE: process.env.E2E_PORT_VITE || '5196',
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || 'D:/lume-uiaudit/pw-browsers',
      E2E_SORTIES: process.env.E2E_SORTIES || 'D:/lume-uiaudit/sorties/tri-roles',
      E2E_JEU: JEU, E2E_WORKERS: '1',
    },
  });
  if (r.status !== 0) { console.error(`[jeu-local] ARRÊT : le banc commun a échoué (code ${r.status}).`); process.exit(4); }
}

// ── 2. Doublons : le plus ancien est gardé. ─────────────────────────────────
const ids = {};
for (const l of ['A', 'B']) {
  const lignes = await bureaux(l);
  if (lignes.length === 0) { console.error(`[jeu-local] ARRÊT : aucun bureau « ${NOM(l)} » après le banc.`); process.exit(5); }
  ids[l] = lignes[0].id;
  for (const o of lignes.slice(1)) {
    await lire('adhésions du doublon', () => a.from('memberships').delete().eq('org_id', o.id).select('user_id'));
    await lire('abonnement du doublon', () => a.from('subscriptions').update({ status: 'canceled' }).eq('org_id', o.id).select('id'));
    await lire('règles du doublon', () => a.from('automation_rules').update({ is_active: false }).eq('org_id', o.id).select('id'));
    await lire('doublon', () => a.from('orgs').update({ deleted_at: new Date().toISOString(), name: `[TEST] doublon du banc (${JEU}) ${o.id.slice(0, 8)} — supprimé` }).eq('id', o.id).select('id'));
    console.log(`[jeu-local] doublon ${o.id} (${o.created_at}) mis à la corbeille.`);
  }
}

// ── 3. Bac à sable, abonnement, comptes du banc. ────────────────────────────
const bac = await lire('bac à sable', () => a.from('orgs_envois_simules').select('org_id').in('org_id', [ids.A, ids.B]));
if (bac.length !== 2) { console.error('[jeu-local] ARRÊT : un bureau du jeu n’est pas en bac à sable.'); process.exit(6); }
const abos = await lire('abonnements', () => a.from('subscriptions').select('org_id, status, plans:plan_id(slug)').in('org_id', [ids.A, ids.B]).in('status', ['active', 'trialing']));
if (abos.length !== 2) { console.error(`[jeu-local] ARRÊT : ${abos.length} abonnement(s) actif(s) pour deux bureaux.`); process.exit(7); }
const horsForfait = abos.filter((x) => x.plans?.slug !== 'autopilot');
if (horsForfait.length) {
  // 55-forfait passe le bureau B sur « starter » le temps d'un test et le remet dans un `finally` : une passe tuée
  // au milieu le laisse là, et tous les écrans de B répondent alors « Fonctionnalité premium ».
  const { data: plan } = await a.from('plans').select('id').eq('slug', 'autopilot').single();
  for (const x of horsForfait) {
    await lire('forfait du bureau', () => a.from('subscriptions').update({ plan_id: plan.id }).eq('org_id', x.org_id).in('status', ['active', 'trialing']).select('id'));
    console.log(`[jeu-local] bureau ${x.org_id} retrouvé sur le forfait « ${x.plans?.slug} » : remis sur Autopilot.`);
  }
}
const membres = await lire('adhésions', () => a.from('memberships').select('user_id, org_id, role, full_name, status, permissions').in('org_id', [ids.A, ids.B]).eq('status', 'active'));
for (const [o, role, nom] of [[ids.A, 'owner', 'QA Proprio A'], [ids.A, 'admin', 'QA Admin A'], [ids.A, 'technician', 'QA Technicien A'], [ids.B, 'owner', 'QA Proprio B']]) {
  if (!membres.some((m) => m.org_id === o && m.role === role && m.full_name === nom)) {
    console.error(`[jeu-local] ARRÊT : compte « ${nom} » (${role}) absent — relancer le banc commun avec E2E_JEU=roles.`);
    process.exit(8);
  }
}

// ── 4. Les comptes de rôle supplémentaires (mêmes définitions que roles/_comptes.ts). ──
const PERSO = [
  { fragment: 'vendeur-a', nom: 'QA Vendeur A', permissions: null },
  { fragment: 'lecteur-a', nom: 'QA Lecteur A', permissions: { 'automations.read': true } },
  { fragment: 'editeur-a', nom: 'QA Editeur A', permissions: { 'automations.read': true, 'automations.update': true } },
  // Hors matrice : les deux comptes des tests de Réglages › Messagerie SMS (`CompteMessagerie` dans _comptes.ts).
  { fragment: 'lecteur-sms-a', nom: 'QA Lecteur SMS A', permissions: { 'automations.read': true, 'integrations.read': true } },
  { fragment: 'vendeur-sms-a', nom: 'QA Vendeur SMS A', permissions: { 'integrations.read': true } },
];
for (const def of PERSO) {
  const m = membres.find((x) => x.org_id === ids.A && x.full_name === def.nom);
  if (m && m.role === 'sales_rep' && JSON.stringify(m.permissions ?? null) === JSON.stringify(def.permissions)) continue;
  const email = EMAIL(def.fragment);
  if (!/@lume-qa\.test$/.test(email)) { console.error(`[jeu-local] REFUS : adresse inattendue (${email}).`); process.exit(9); }
  const cree = await a.auth.admin.createUser({ email, password: randomBytes(24).toString('base64url'), email_confirm: true, user_metadata: { full_name: def.nom } });
  let id = cree.data?.user?.id;
  if (!id) {
    const { data: lien, error } = await a.auth.admin.generateLink({ type: 'magiclink', email });
    if (!lien?.user) { console.error(`[jeu-local] ARRÊT : compte ${email} — ${cree.error?.message} / ${error?.message}`); process.exit(10); }
    id = lien.user.id;
  }
  await lire(`adhésion ${email}`, () => a.from('memberships').upsert(
    { user_id: id, org_id: ids.A, role: 'sales_rep', status: 'active', full_name: def.nom, permissions: def.permissions },
    { onConflict: 'user_id,org_id' },
  ).select('user_id'));
  await a.from('profiles').update({ location_consent: false, location_consent_at: new Date().toISOString() }).eq('id', id);
  console.log(`[jeu-local] compte « ${def.nom} » posé (${email}).`);
}

console.log(`[jeu-local] jeu « ${JEU} » sain (GoTrue ${PILE.authUrl}, PostgREST ${PILE.restUrl}) : A ${ids.A}, B ${ids.B}, bac à sable, forfait Autopilot, neuf comptes.`);
