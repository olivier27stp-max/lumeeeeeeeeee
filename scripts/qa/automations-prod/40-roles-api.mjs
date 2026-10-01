// Vrai site, rôles : un technicien et un vendeur n'ont AUCUN accès aux automatisations, même en appelant
// l'API directement (sans passer par les boutons), même avec une barre finale ou des majuscules dans l'adresse.
// Un propriétaire et un admin lisent. Aucun appel ne peut rien écrire : les corps sont vides (un appel qui
// passerait la garde tomberait sur la validation), et seuls des refus sont attendus pour les écritures.
import { session, COMPTES, ORG, SITE } from './outils.mjs';

const ID = '00000000-0000-4000-8000-000000000000';
const LECTURES = [
  ['GET', '/api/automations/rules'], ['GET', '/api/automations/rules/stats'], ['GET', '/api/automations/editeur'],
  ['GET', '/api/automations/templates'], ['GET', '/api/automations/folders'], ['GET', '/api/automations/webhooks'],
  ['GET', '/api/automations/pause'], ['GET', '/api/automations/test'], ['POST', `/api/automations/rules/${ID}/apercu`],
];
const ECRITURES = [
  ['POST', '/api/automations/rules'], ['PATCH', `/api/automations/rules/${ID}`], ['DELETE', `/api/automations/rules/${ID}`],
  ['POST', `/api/automations/rules/${ID}/duplicate`], ['POST', '/api/automations/templates/utiliser'],
  ['POST', `/api/automations/rules/${ID}/copier-bureaux`], ['POST', `/api/automations/rules/${ID}/publication`],
  ['POST', '/api/automations/rules/publication'], ['GET', '/api/automations/bureaux-cibles'], ['POST', '/api/automations/rules/generer'],
  ['POST', `/api/automations/rules/${ID}/restaurer`], ['DELETE', `/api/automations/rules/${ID}/definitivement`],
  ['POST', '/api/automations/folders'], ['PATCH', `/api/automations/folders/${ID}`], ['DELETE', `/api/automations/folders/${ID}`],
  ['POST', '/api/automations/webhooks'], ['POST', `/api/automations/webhooks/${ID}/regenerer`], ['PATCH', `/api/automations/webhooks/${ID}`],
  ['DELETE', `/api/automations/webhooks/${ID}`], ['POST', '/api/automations/pause'],
  ['POST', '/api/automations/events/lead-created'], ['POST', '/api/automations/events/quote-sent'], ['POST', '/api/automations/events/deal-stage-changed'],
];
/** Les écritures d'adresse qui contournaient la garde avant #862. */
const VARIANTES = ['/api/automations/pause/', '/API/automations/pause', '/api/Automations/Rules', '/api//automations/rules', '/api/automations/rules/'];

const appeler = async (jeton, methode, chemin) => {
  const r = await fetch(SITE + chemin, {
    method: methode,
    headers: { ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}), 'x-org-id': ORG, 'Content-Type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
    body: methode === 'GET' || methode === 'DELETE' ? undefined : '{}',
  });
  let json = null; try { json = await r.json(); } catch { /* corps non JSON */ }
  return { status: r.status, json };
};

let ok = 0; let total = 0;
const verifier = (nom, reussi, detail) => { total += 1; if (reussi) ok += 1; console.log(`${reussi ? '✓' : '✗'} ${nom} — ${detail}`); };

for (const role of ['technicien', 'vendeur']) {
  const jeton = (await session(COMPTES[role])).access_token;
  const passes = [];
  let sansPhrase = 0;
  for (const [methode, chemin] of [...LECTURES, ...ECRITURES]) {
    const r = await appeler(jeton, methode, chemin);
    if (r.status !== 403) passes.push(`${methode} ${chemin} → ${r.status}`);
    else if (!r.json?.message || /\w+\.\w+/.test(r.json.message)) sansPhrase += 1;
  }
  verifier(`${role}-refuse-partout`, passes.length === 0, passes.length ? `NON REFUSÉ : ${passes.join(' ; ').slice(0, 400)}` : `${LECTURES.length + ECRITURES.length} routes, toutes en 403`);
  verifier(`${role}-refus-lisible`, sansPhrase === 0, sansPhrase ? `${sansPhrase} refus sans phrase lisible` : 'chaque refus porte une phrase, sans nom de clé');
  const contournes = [];
  for (const chemin of VARIANTES) { const r = await appeler(jeton, 'GET', chemin); if (r.status !== 403) contournes.push(`${chemin} → ${r.status}`); }
  verifier(`${role}-adresses-detournees`, contournes.length === 0, contournes.length ? `CONTOURNEMENT : ${contournes.join(' ; ')}` : `${VARIANTES.length} écritures d’adresse (barre finale, majuscules, double barre), toutes en 403`);
}

const anonymes = [];
for (const [methode, chemin] of [['GET', '/api/automations/rules'], ['GET', '/api/automations/pause/'], ['POST', '/api/automations/events/lead-created/'], ['POST', '/api/automations/pause']]) {
  const r = await appeler(null, methode, chemin);
  if (r.status !== 401) anonymes.push(`${methode} ${chemin} → ${r.status}`);
}
verifier('sans-session-refuse', anonymes.length === 0, anonymes.length ? `NON REFUSÉ : ${anonymes.join(' ; ')}` : 'quatre routes sans jeton, toutes en 401');

for (const role of ['proprietaire', 'admin']) {
  const jeton = (await session(COMPTES[role])).access_token;
  const lues = [];
  for (const chemin of ['/api/automations/rules', '/api/automations/pause', '/api/automations/templates', '/api/automations/folders']) {
    const r = await appeler(jeton, 'GET', chemin);
    if (r.status !== 200) lues.push(`${chemin} → ${r.status}`);
  }
  verifier(`${role}-lit`, lues.length === 0, lues.length ? `ÉCHEC : ${lues.join(' ; ')}` : 'règles, pause, modèles et dossiers lus (200)');
}
console.log(`BILAN : ${ok}/${total}`);
