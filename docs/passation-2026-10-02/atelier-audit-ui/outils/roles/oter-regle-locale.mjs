#!/usr/bin/env node
/**
 * Retire UNE règle de test restée derrière une passe interrompue — pile LOCALE seulement, par identifiant exact.
 *   node D:/lume-uiaudit/outils/roles/oter-regle-locale.mjs <id>
 * Refuse tout ce qui n'est pas : une règle du jeu « roles » (bureau A ou B), non fournie, dont le nom porte la marque
 * « [E2E … ] » que le banc pose sur ce qu'un test crée. Même ménage que le banc (`_outils/banc.ts`, fixture `marque`) :
 * tâches planifiées, journaux, puis la règle. Parle à PostgREST directement (client-local.mjs, 127.0.0.1 seulement).
 */
import { clientService } from './client-local.mjs';

const id = process.argv[2];
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id ?? '')) { console.error('usage : oter-regle-locale.mjs <uuid>'); process.exit(1); }
const a = clientService();

const { data: bureaux, error: eB } = await a.from('orgs').select('id, name').in('name', ['A', 'B'].map((l) => `[TEST] QA Automatisations ${l} (roles) — ne pas utiliser`)).is('deleted_at', null);
if (eB) { console.error(eB.message); process.exit(3); }
const { data: regle, error } = await a.from('automation_rules').select('id, name, org_id, is_preset, preset_key').eq('id', id).maybeSingle();
if (error) { console.error(error.message); process.exit(3); }
if (!regle) { console.log('aucune règle de cet identifiant : rien à faire.'); process.exit(0); }
if (!(bureaux ?? []).some((b) => b.id === regle.org_id)) { console.error(`REFUS : la règle n'est pas dans un bureau du jeu « roles » (${regle.org_id}).`); process.exit(2); }
if (regle.is_preset || regle.preset_key) { console.error('REFUS : automatisation fournie.'); process.exit(2); }
if (!/^\[E2E [^\]]+\]/.test(regle.name)) { console.error(`REFUS : « ${regle.name} » ne porte pas la marque d'un test.`); process.exit(2); }

for (const table of ['automation_scheduled_tasks', 'automation_execution_logs']) {
  const { error: e } = await a.from(table).delete().eq('automation_rule_id', id);
  if (e) { console.error(`${table} : ${e.message}`); process.exit(3); }
}
const { data: otee, error: e2 } = await a.from('automation_rules').delete().eq('id', id).select('id');
if (e2) { console.error(e2.message); process.exit(3); }
console.log(`règle « ${regle.name} » retirée (${(otee ?? []).length} ligne).`);
