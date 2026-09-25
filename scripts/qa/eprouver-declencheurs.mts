/* ═══════════════════════════════════════════════════════════════
   ÉPROUVER CHAQUE DÉCLENCHEUR — sur le vrai moteur.

   Le catalogue en propose 23. Mesuré en prod le 2026-09-25, 10
   seulement avaient déjà laissé une trace : les 13 autres étaient
   « plausibles », pas prouvés. Un déclencheur qui ne part jamais est
   une promesse creuse — et on ne le découvre qu'avec un client au
   téléphone.

   CE QUE FAIT CE BANC. Pour chaque déclencheur : il crée une règle qui
   le vise, émet le VRAI événement par le bus (le même chemin que le
   code de production), et vérifie qu'une tâche est armée. Puis il
   nettoie tout.

   L'action choisie est inoffensive — `create_task` — : aucun message ne
   part vers un client. Le banc ne tourne que sur STAGING.

   Usage : npx tsx scripts/qa/eprouver-declencheurs.mts
   ═══════════════════════════════════════════════════════════════ */

import { createClient } from '@supabase/supabase-js';

const URL = process.env.VITE_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (/bbzcuzqfgsdvjsymfwmr/.test(URL)) {
  console.error('REFUS : ce banc crée des règles et des tâches — jamais sur la production.');
  process.exit(1);
}

const admin = createClient(URL, KEY, { auth: { persistSession: false } });

/**
 * Chaque déclencheur avec l'entité que le serveur émet vraiment et des
 * métadonnées plausibles. Le moteur s'en sert pour résoudre le client.
 */
const CAS: Array<{ cle: string; entite: string; metadata?: Record<string, unknown> }> = [
  { cle: 'quote.sent', entite: 'quote' },
  { cle: 'quote.approved', entite: 'quote' },
  { cle: 'quote.declined', entite: 'quote' },
  { cle: 'quote.changes_requested', entite: 'quote' },
  { cle: 'invoice.sent', entite: 'invoice' },
  { cle: 'invoice.paid', entite: 'invoice' },
  { cle: 'invoice.overdue', entite: 'invoice' },
  { cle: 'appointment.created', entite: 'schedule_event' },
  { cle: 'appointment.cancelled', entite: 'schedule_event' },
  { cle: 'job.completed', entite: 'job' },
  { cle: 'job.ready_for_invoicing', entite: 'job' },
  { cle: 'lead.created', entite: 'client' },
  { cle: 'lead.status_changed', entite: 'client', metadata: { new_status: 'qualified' } },
  { cle: 'client.replied', entite: 'client' },
  { cle: 'client.tagged', entite: 'client', metadata: { tag: 'VIP' } },
  { cle: 'agreement.signed', entite: 'job' },
  { cle: 'task.completed', entite: 'task' },
  { cle: 'note.added', entite: 'client' },
  { cle: 'date.reached', entite: 'client' },
  { cle: 'custom_field.changed', entite: 'client' },
  { cle: 'webhook.received', entite: 'automation_webhook' },
  { cle: 'deal.stage_entered', entite: 'deal' },
  { cle: 'deal.stage_idle', entite: 'deal' },
];

const { data: org } = await admin.from('orgs').select('id').limit(1).single();
const ORG = org!.id;

// Le bus vit dans le processus du serveur : on l'importe ici pour émettre
// exactement comme le code de production le fait.
const { eventBus } = await import('../../server/lib/eventBus');
const { initAutomationEngine } = await import('../../server/lib/automationEngine');
initAutomationEngine({ supabase: admin, twilio: null, baseUrl: 'http://localhost:3002' } as never);

const resultats: Array<[string, boolean, string]> = [];

for (const cas of CAS) {
  const marque = `[QA-DECL] ${cas.cle}`;
  const entityId = crypto.randomUUID();

  const { data: regle, error } = await admin.from('automation_rules').insert({
    org_id: ORG, name: marque, trigger_event: cas.cle,
    conditions: {}, delay_seconds: 0, is_active: true, is_preset: false,
    actions: [{ type: 'create_task', config: { title: marque, priority: 'medium' } }],
  }).select('id').single();

  if (error) { resultats.push([cas.cle, false, `règle refusée : ${error.message.slice(0, 50)}`]); continue; }

  await eventBus.emit(cas.cle as never, {
    orgId: ORG, entityType: cas.entite, entityId, metadata: cas.metadata ?? {},
  });
  /*
   * 3 s, pas 1,2 : sur un déclencheur déjà très utilisé (`lead.created`
   * porte déjà plusieurs préréglages), les règles s'exécutent en série
   * et la nôtre passe en dernier. Une attente trop courte faisait
   * conclure à un déclencheur MORT alors qu'il fonctionnait — un faux
   * négatif qui aurait envoyé chercher un bug inexistant.
   */
  await new Promise((r) => setTimeout(r, 3000));

  // Une tâche créée, OU une tâche planifiée : les deux prouvent que le
  // moteur a reconnu le déclencheur et retenu la règle.
  const { count: faites } = await admin.from('tasks')
    .select('id', { count: 'exact', head: true }).eq('org_id', ORG).eq('title', marque);
  const { count: prevues } = await admin.from('automation_scheduled_tasks')
    .select('id', { count: 'exact', head: true }).eq('automation_rule_id', regle.id);

  const ok = (faites ?? 0) > 0 || (prevues ?? 0) > 0;
  resultats.push([cas.cle, ok, ok ? `${faites} tâche(s), ${prevues} planifiée(s)` : 'rien ne s’est produit']);

  // Nettoyage
  await admin.from('tasks').delete().eq('org_id', ORG).eq('title', marque);
  await admin.from('automation_scheduled_tasks').delete().eq('automation_rule_id', regle.id);
  await admin.from('automation_rules').delete().eq('id', regle.id);
}

const ok = resultats.filter(([, v]) => v);
const ko = resultats.filter(([, v]) => !v);

console.log('\n✓ DÉCLENCHEURS QUI PARTENT');
for (const [c, , d] of ok) console.log(`   ${c.padEnd(26)} ${d}`);
if (ko.length) {
  console.log('\n✗ DÉCLENCHEURS QUI NE PARTENT PAS');
  for (const [c, , d] of ko) console.log(`   ${c.padEnd(26)} ${d}`);
}
console.log(`\n${ok.length} / ${resultats.length} déclencheurs prouvés`);
process.exit(ko.length ? 1 : 0);
