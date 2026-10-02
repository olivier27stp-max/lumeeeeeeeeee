#!/usr/bin/env node
/**
 * Lecture seule : l'état des bureaux de test sur la pile LOCALE (noms, bac à sable, forfait, adhésions).
 *   node D:/lume-uiaudit/outils/roles/etat-jeu-local.mjs [filtre sur le nom du bureau, défaut « roles »]
 * Parle à GoTrue / PostgREST directement (client-local.mjs) ; refuse toute adresse qui n'est pas 127.0.0.1.
 */
import { clientService } from './client-local.mjs';

const a = clientService();
const filtre = process.argv[2] ?? 'roles';

const { data: membres, error } = await a.from('memberships').select('org_id, role, full_name, status, permissions').ilike('full_name', 'QA %');
if (error) { console.error(error.message); process.exit(3); }
const orgIds = [...new Set(membres.map((m) => m.org_id))];
const { data: orgs } = await a.from('orgs').select('id, name, deleted_at, created_at').in('id', orgIds).order('created_at');
const { data: bac } = await a.from('orgs_envois_simules').select('org_id').in('org_id', orgIds);
const { data: abos } = await a.from('subscriptions').select('org_id, status, plans:plan_id(slug)').in('org_id', orgIds);
const { data: cs } = await a.from('company_settings').select('org_id, company_name, default_language, automations_paused').in('org_id', orgIds);
// Un bureau du jeu « roles » renommé par un test reste reconnaissable à ses comptes « QA Editeur A » / « QA Vendeur A ».
const duJeu = (o) => o.name.includes(`(${filtre})`) || (filtre === 'roles' && membres.some((m) => m.org_id === o.id && /QA (Editeur|Vendeur|Lecteur)/.test(m.full_name)));
for (const o of (orgs ?? []).filter(duJeu)) {
  console.log(`\n${o.id}  « ${o.name} »${o.deleted_at ? '  [corbeille]' : ''}`);
  console.log(`  bac à sable : ${(bac ?? []).some((b) => b.org_id === o.id) ? 'oui' : 'NON'} · abonnements : ${(abos ?? []).filter((x) => x.org_id === o.id).map((x) => `${x.status}/${x.plans?.slug}`).join(', ') || 'aucun'}`);
  const c = (cs ?? []).find((x) => x.org_id === o.id);
  console.log(`  réglages : ${c ? `${c.company_name} · langue ${c.default_language} · pause ${c.automations_paused}` : 'aucun'}`);
  for (const m of membres.filter((x) => x.org_id === o.id)) console.log(`  ${m.role.padEnd(11)} ${m.full_name.padEnd(18)} ${m.status} ${JSON.stringify(m.permissions ?? null)}`);
}
