/**
 * Clients supabase-js pour la pile LOCALE des E2E des automatisations — SANS le proxy.
 *
 * Le proxy (façon Kong) ne vit que le temps d'une commande `lancer.mjs` ; GoTrue et PostgREST, eux, sont des
 * conteneurs qui restent debout. Les outils de ce dossier leur parlent donc directement : les chemins
 * `/auth/v1/…` et `/rest/v1/…` que supabase-js fabrique sont réécrits vers `PILE.authUrl` et `PILE.restUrl`
 * (scripts/qa/automations-e2e/local.mjs). Aucun port de proxy n'entre en jeu.
 *
 * Ceinture : toute adresse qui n'est pas http://127.0.0.1 est REFUSÉE, ici et à chaque requête.
 * Aucune écriture sur staging ni en prod, jamais.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { PILE, clesLocales } from './local.mjs';

/** La racine du dépôt : ces outils se lancent depuis elle (`node scripts/qa/automations-e2e/…`). */
export const WT = process.cwd().replace(/[\\]/g, '/');
const { createClient } = createRequire(pathToFileURL(`${WT}/package.json`).href)('@supabase/supabase-js');

function exigerLocal(nom, u) {
  const x = new URL(u);
  if (x.hostname !== '127.0.0.1' || x.protocol !== 'http:') {
    console.error(`REFUS : ${nom} (${u}) n'est pas la pile locale (http://127.0.0.1 seulement).`);
    process.exit(2);
  }
}
exigerLocal('GoTrue', PILE.authUrl);
exigerLocal('PostgREST', PILE.restUrl);

/** Adresse factice : jamais contactée, chaque requête est réécrite ci-dessous. */
const FACTICE = 'http://127.0.0.1:9';

function reecrire(url) {
  const u = new URL(url);
  let cible;
  if (u.pathname.startsWith('/auth/v1')) cible = new URL(u.pathname.slice('/auth/v1'.length) + u.search, PILE.authUrl);
  else if (u.pathname.startsWith('/rest/v1')) cible = new URL((u.pathname.slice('/rest/v1'.length) || '/') + u.search, PILE.restUrl);
  else throw new Error(`REFUS : ${u.pathname} n'est ni /auth/v1 ni /rest/v1 (stockage, temps réel et fonctions ne sont pas servis ici).`);
  if (cible.hostname !== '127.0.0.1') throw new Error(`REFUS : ${cible.href} n'est pas sur 127.0.0.1.`);
  return cible.href;
}

const fetchLocal = (entree, init) => {
  const url = typeof entree === 'string' ? entree : entree instanceof URL ? entree.href : entree.url;
  return fetch(reecrire(url), init);
};

const { anon, service } = clesLocales();
const OPTS = { auth: { persistSession: false, autoRefreshToken: false } };

/** Client de service (contourne la RLS) — préparation et relecture. */
export function clientService() {
  return createClient(FACTICE, service, { ...OPTS, global: { fetch: fetchLocal } });
}
/** Client anonyme (échange d'un lien magique contre une session). */
export function clientAnon() {
  return createClient(FACTICE, anon, { ...OPTS, global: { fetch: fetchLocal } });
}
/** Client agissant COMME le porteur du jeton : la RLS s'applique. */
export function clientAvecJeton(jeton) {
  return createClient(FACTICE, anon, { ...OPTS, global: { fetch: fetchLocal, headers: { Authorization: `Bearer ${jeton}` } } });
}

export { PILE };
