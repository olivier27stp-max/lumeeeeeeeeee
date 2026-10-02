#!/usr/bin/env node
/**
 * Sonde (pile LOCALE seulement) : un rôle peut-il retirer / poser une étiquette de client par PostgREST ?
 * L'étiquette du décor est remise à la fin.
 *   node D:/lume-uiaudit/outils/roles/sonde-etiquette-local.mjs [tech-a|vendeur-a|lecteur-a|editeur-a|admin-a|proprio-a]
 * Parle à GoTrue / PostgREST directement (client-local.mjs) ; refuse toute adresse qui n'est pas 127.0.0.1.
 * Si l'API de la passe est debout (E2E_PORT_API, défaut 48305), la route d'annonce « étiquette retirée » est
 * appelée aussi ; sinon cette ligne est sautée (relevé du 2026-10-01, API debout : 403 « Permission denied:
 * clients.update or leads.update » pour le technicien).
 */
import { PILE, clientAnon, clientAvecJeton, clientService } from './client-local.mjs';

const a = clientService();
const fragment = process.argv[2] || 'tech-a';
const email = `qa-auto-${fragment}+roles@lume-qa.test`;
const { data: orgA } = await a.from('orgs').select('id').eq('name', '[TEST] QA Automatisations A (roles) — ne pas utiliser').is('deleted_at', null).single();
const { data: client } = await a.from('clients').select('id').eq('org_id', orgA.id).eq('last_name', 'Décor-Rôles').is('deleted_at', null).limit(1).single();
const TAG = 'e2e-roles';

const { data: l, error } = await a.auth.admin.generateLink({ type: 'magiclink', email });
if (error) { console.error(error.message); process.exit(3); }
const { data: s } = await clientAnon().auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' });
const jeton = s.session.access_token;
const u = clientAvecJeton(jeton);

const compter = async () => (await a.from('client_tags').select('id', { count: 'exact', head: true }).eq('client_id', client.id).eq('tag', TAG)).count;
console.log(`rôle : ${email}`);
console.log(`avant : ${await compter()} étiquette « ${TAG} » sur le client du décor`);
const lu = await u.from('client_tags').select('tag').eq('client_id', client.id);
console.log(`lecture des étiquettes par le rôle : ${lu.error ? `erreur ${lu.error.code} ${lu.error.message}` : `${lu.data.length} ligne(s)`}`);
const d = await u.from('client_tags').delete().eq('client_id', client.id).eq('tag', TAG).select('id');
console.log(`DELETE client_tags par le rôle : ${d.error ? `erreur ${d.error.code} ${d.error.message}` : `${d.data.length} ligne(s) supprimée(s)`}`);
console.log(`après : ${await compter()} étiquette en base`);
const portApi = Number(process.env.E2E_PORT_API || 48305);
try {
  const r = await fetch(`http://127.0.0.1:${portApi}/api/automations/events/client-untagged`, {
    method: 'POST', signal: AbortSignal.timeout(8000),
    headers: { 'Content-Type': 'application/json', 'x-requested-with': 'XMLHttpRequest', Authorization: `Bearer ${jeton}`, 'x-org-id': orgA.id },
    body: JSON.stringify({ clientId: client.id, tag: TAG }),
  });
  console.log(`POST /api/automations/events/client-untagged par le rôle : ${r.status} ${(await r.text()).slice(0, 200)}`);
} catch {
  console.log(`POST /api/automations/events/client-untagged : API absente sur le port ${portApi} (elle ne vit que le temps d'une passe) — non rejoué.`);
}
const i = await u.from('client_tags').insert({ client_id: client.id, tag: 'e2e-roles-sonde' }).select('id');
console.log(`INSERT client_tags par le rôle : ${i.error ? `erreur ${i.error.code} ${i.error.message}` : `${i.data.length} ligne(s) insérée(s)`}`);
await a.from('client_tags').delete().eq('client_id', client.id).eq('tag', 'e2e-roles-sonde');
if ((await compter()) === 0) await a.from('client_tags').insert({ client_id: client.id, tag: TAG });
console.log(`remis en état : ${await compter()} étiquette « ${TAG} » (PostgREST ${PILE.restUrl})`);
