/**
 * Sonde jetable : S-02 (variantes de chemin), S-04 (base directe), S-05 (corbeille), S-06 (/test), S-17, S-18.
 *   cd D:/lume-uiaudit/wt && QA_AUTO_SUFFIXE=roles node --env-file=.env.local node_modules/tsx/dist/cli.mjs ../outils/roles/sonde-securite.mts
 */
import { randomBytes } from 'node:crypto';
import { assurerBureauTest, COMPTES } from '../../wt/tests/automations-suite/harnais/bureau-test';
import { assurerComptesPerso, sessionParEmail, clientAvecJeton, TOUS_LES_ROLES, type Role } from '../../wt/e2e/automations/roles/_comptes';
import { assurerDecor, regleA, type Outils } from '../../wt/e2e/automations/roles/_routes';

const API = 'http://127.0.0.1:3112';
const VITE = 'http://127.0.0.1:5183';
const b = await assurerBureauTest();
const emailAdmin = COMPTES.proprioA.email.replace('proprio-a', 'admin-a');
const perso = await assurerComptesPerso(b.admin, b.orgA, COMPTES.proprioA.email);
const emails: Record<Role, string> = {
  proprioA: COMPTES.proprioA.email, adminA: emailAdmin, techA: COMPTES.techA.email, proprioB: COMPTES.proprioB.email,
  vendeurA: perso.vendeurA.email, lecteurA: perso.lecteurA.email, editeurA: perso.editeurA.email,
};
const jetons = {} as Record<Role, string>;
for (const r of TOUS_LES_ROLES) jetons[r] = (await sessionParEmail(b.admin, emails[r])).access_token;
const decor = await assurerDecor(b.admin, b.orgA, b.users.proprioA);
const marque = `[E2E S-00 ${randomBytes(3).toString('hex')}]`;
const o: Outils = { admin: b.admin, orgA: b.orgA, orgB: b.orgB, idProprioA: b.users.proprioA, marque, decor: { ...decor, modele: 'quote_opened_notify' } };

async function appel(base: string, jeton: string | null, org: string | null, methode: string, chemin: string, corps?: unknown) {
  const h: Record<string, string> = { 'Content-Type': 'application/json', 'x-requested-with': 'XMLHttpRequest' };
  if (jeton) h.Authorization = `Bearer ${jeton}`;
  if (org) h['x-org-id'] = org;
  try {
    const r = await fetch(`${base}${chemin}`, { method: methode, headers: h, body: corps === undefined ? undefined : JSON.stringify(corps) });
    return { status: r.status, texte: await r.text() };
  } catch (e) { return { status: 0, texte: String(e) }; }
}
const dire = (quoi: string, r: { status: number; texte: string }) => console.log(`  ${quoi.padEnd(70)} ${r.status}  ${r.texte.slice(0, 220).replace(/\s+/g, ' ')}`);

console.log('\n=== S-02 variantes de chemin, jeton du technicien, API directe');
const regle = await regleA(o, 'cible');
const temoin = await regleA(o, 'témoin lead', { trigger_event: 'lead.created', is_active: true, delay_seconds: 3600 });
const variantes: Array<[string, string, unknown?]> = [
  ['POST', '/api/automations/rules/generer', { demande: 'Envoie un texto de bienvenue aux nouveaux prospects.', langue: 'fr' }],
  ['POST', '/api/automations/rules/generer/', { demande: 'Envoie un texto de bienvenue aux nouveaux prospects.', langue: 'fr' }],
  ['POST', '/api/automations/rules/GENERER', { demande: 'Envoie un texto de bienvenue aux nouveaux prospects.', langue: 'fr' }],
  ['POST', '/api/Automations/rules/generer', { demande: 'Envoie un texto de bienvenue aux nouveaux prospects.', langue: 'fr' }],
  ['POST', '/API/automations/rules/generer', { demande: 'Envoie un texto de bienvenue aux nouveaux prospects.', langue: 'fr' }],
  ['POST', '/api//automations/rules/generer', { demande: 'Envoie un texto de bienvenue aux nouveaux prospects.', langue: 'fr' }],
  ['POST', '//api/automations/rules/generer', { demande: 'Envoie un texto de bienvenue aux nouveaux prospects.', langue: 'fr' }],
  ['POST', '/api/automations/rules%2Fgenerer', { demande: 'Envoie un texto de bienvenue aux nouveaux prospects.', langue: 'fr' }],
  ['POST', '/api/automations/rules/generer?x=1', { demande: 'Envoie un texto de bienvenue aux nouveaux prospects.', langue: 'fr' }],
  ['POST', '/api/automations/rules/generer/?x=1', { demande: 'Envoie un texto de bienvenue aux nouveaux prospects.', langue: 'fr' }],
  ['GET', '/api/automations/rules/'],
  ['GET', '/api/AUTOMATIONS/rules'],
  ['GET', '/api/automations/pause/'],
  ['GET', '/api/automations/templates/'],
  ['GET', `/api/automations/editeur/?rule_id=${regle}`],
  ['GET', '/api/automations/rules/stats/'],
  ['GET', '/api/automations/folders/'],
  ['GET', '/api/automations/webhooks/'],
  ['GET', '/api/automations/bureaux-cibles/'],
  ['GET', '/api/automations/test/'],
  ['GET', '/api/automations/clients-inactifs/apercu/?mois=6'],
  ['POST', '/api/automations/rules/', { name: `${marque} créée par contournement`, trigger_event: 'lead.created', delay_seconds: 0, actions: [{ type: 'log_activity', config: {} }] }],
  ['PATCH', `/api/automations/rules/${regle}/`, { description: 'contournée' }],
  ['DELETE', `/api/automations/rules/${regle}/`],
  ['POST', `/api/automations/rules/${regle}/duplicate/`],
  ['POST', `/api/automations/rules/${regle}/publication/`, { actif: true }],
  ['POST', `/api/automations/rules/${regle}/apercu/`],
  ['POST', '/api/automations/pause/', { paused: true }],
  ['POST', '/api/automations/folders/', { name: `${marque} dossier` }],
  ['POST', '/api/automations/webhooks/', { name: `${marque} webhook` }],
  ['POST', '/api/automations/events/lead-created/', { leadId: decor.client }],
  ['POST', '/api/automations/events/LEAD-CREATED', { leadId: decor.client }],
  ['POST', '/api/automations/events/lead-status-changed/', { leadId: decor.client, oldStatus: 'a', newStatus: 'b' }],
  ['POST', '/api/automations/events/quote-sent/', { quoteId: decor.devis }],
  ['POST', '/api/automations/events/deal-stage-changed/', { dealId: decor.client, leadId: decor.client }],
  ['POST', '/api/automations/events/client-tagged/', { clientId: decor.client, tag: decor.etiquette }],
  ['POST', '/api/automations/events/invoice-paid/', {}],
];
for (const [m, c, corps] of variantes) dire(`tech ${m} ${c}`, await appel(API, jetons.techA, b.orgA, m, c, corps));
console.log('  — sans jeton :');
for (const c of ['/api/automations/events/invoice-paid/', '/api/automations/events/appointment-created/', '/api/automations/events/quote-approved/', '/api/automations/events/lead-created/', '/api/automations/rules/']) {
  dire(`anonyme POST ${c}`, await appel(API, null, null, 'POST', c, { leadId: decor.client }));
}
console.log('  — par le mandataire Vite :');
dire('tech POST (vite) /api/automations/events/lead-created/', await appel(VITE, jetons.techA, b.orgA, 'POST', '/api/automations/events/lead-created/', { leadId: decor.client }));
{
  const { count: t } = await b.admin.from('automation_scheduled_tasks').select('id', { count: 'exact', head: true }).eq('automation_rule_id', temoin);
  const { count: j } = await b.admin.from('automation_execution_logs').select('id', { count: 'exact', head: true }).eq('automation_rule_id', temoin);
  const { data: r } = await b.admin.from('automation_rules').select('description, deleted_at, is_active').eq('id', regle).maybeSingle();
  const { count: crees } = await b.admin.from('automation_rules').select('id', { count: 'exact', head: true }).eq('org_id', b.orgA).ilike('name', `%${marque}%`);
  console.log('  EFFETS → tâches du témoin lead.created :', t, 'journaux :', j, '| règle cible :', JSON.stringify(r), '| règles marquées :', crees);
  const { data: act } = await b.admin.from('activity_log').select('event_type, entity_id, actor_id, created_at').eq('org_id', b.orgA).eq('actor_id', (await b.admin.auth.admin.generateLink({ type: 'magiclink', email: emails.techA })).data.user?.id ?? '').order('created_at', { ascending: false }).limit(10);
  console.log('  activity_log par le technicien :', JSON.stringify(act));
}

console.log('\n=== S-05 corbeille');
{
  const corb = await regleA(o, 'corbeille', { deleted_at: new Date().toISOString(), actions: [{ type: 'create_task', config: { title: 'Rappeler' } }] });
  dire('admin PATCH is_active:true sur règle à la corbeille', await appel(API, jetons.adminA, b.orgA, 'PATCH', `/api/automations/rules/${corb}`, { is_active: true }));
  console.log('   base →', JSON.stringify((await b.admin.from('automation_rules').select('is_active, deleted_at').eq('id', corb).maybeSingle()).data));
  dire('admin POST publication sur règle à la corbeille', await appel(API, jetons.adminA, b.orgA, 'POST', `/api/automations/rules/${corb}/publication`, { actif: true }));
  dire('admin GET editeur d’une règle à la corbeille', await appel(API, jetons.adminA, b.orgA, 'GET', `/api/automations/editeur?rule_id=${corb}`));
  dire('admin POST apercu d’une règle à la corbeille', await appel(API, jetons.adminA, b.orgA, 'POST', `/api/automations/rules/${corb}/apercu`));
  const purge = await regleA(o, 'purgée', { deleted_at: new Date().toISOString(), purged_at: new Date().toISOString() });
  dire('admin POST duplicate d’une règle supprimée définitivement', await appel(API, jetons.adminA, b.orgA, 'POST', `/api/automations/rules/${purge}/duplicate`));
  dire('admin PATCH d’une règle supprimée définitivement', await appel(API, jetons.adminA, b.orgA, 'PATCH', `/api/automations/rules/${purge}`, { is_active: true }));
  dire('admin POST restaurer d’une règle supprimée définitivement', await appel(API, jetons.adminA, b.orgA, 'POST', `/api/automations/rules/${purge}/restaurer`));
  dire('admin GET editeur d’une règle supprimée définitivement', await appel(API, jetons.adminA, b.orgA, 'GET', `/api/automations/editeur?rule_id=${purge}`));
  console.log('   base purgée →', JSON.stringify((await b.admin.from('automation_rules').select('is_active, deleted_at, purged_at').eq('id', purge).maybeSingle()).data));
}

console.log('\n=== S-06 /api/automations/test (admin)');
{
  const r = await appel(API, jetons.adminA, b.orgA, 'GET', '/api/automations/test');
  try { const j = JSON.parse(r.texte); for (const x of j.results ?? []) if (!/^Preset exists/.test(x.name)) console.log('   ·', x.name, '|', x.passed, '|', String(x.details).slice(0, 200), x.data ? `| data: ${JSON.stringify(x.data).slice(0, 300)}` : ''); } catch { console.log(r.texte.slice(0, 500)); }
}

console.log('\n=== S-04 / S-17 base directe');
{
  const sb = clientAvecJeton;
  const admin = sb(jetons.adminA); const edit = sb(jetons.editeurA);
  const incomplete = await regleA(o, 'incomplète', { actions: [{ type: 'send_sms', config: { body: '' } }] });
  const pub = await admin.from('automation_rules').update({ is_active: true }).eq('id', incomplete).select('id, is_active');
  console.log('  admin is_active:true sur parcours incomplet →', JSON.stringify(pub.data), pub.error?.message);
  dire('  (référence) route de publication sur la même règle', await appel(API, jetons.adminA, b.orgA, 'POST', `/api/automations/rules/${incomplete}/publication`, { actif: true }));
  const cols = await edit.from('automation_rules').update({ is_preset: true, preset_key: 'invente', deleted_at: new Date().toISOString(), purged_at: new Date().toISOString(), trigger_event: 'nimporte.quoi' }).eq('id', regle).select('id, is_preset, preset_key, deleted_at, purged_at, trigger_event');
  console.log('  éditeur is_preset/preset_key/deleted_at/purged_at/trigger_event →', JSON.stringify(cols.data), cols.error?.message);
  const org = await admin.from('automation_rules').update({ org_id: b.orgB }).eq('id', incomplete).select('id, org_id');
  console.log('  admin org_id → bureau B :', JSON.stringify(org.data), org.error?.message);
  const insB = await admin.from('automation_rules').insert({ org_id: b.orgB, name: `${marque} chez B`, trigger_event: 'lead.created', actions: [] }).select('id');
  console.log('  admin insert dans bureau B :', JSON.stringify(insB.data), insB.error?.message);
  const { data: preset } = await b.admin.from('automation_rules').select('id, name, preset_key').eq('org_id', b.orgA).eq('is_preset', true).limit(1).maybeSingle();
  console.log('  un préréglage :', JSON.stringify(preset));
  const del = await edit.from('automation_rules').delete().eq('id', incomplete).select('id');
  console.log('  éditeur DELETE dur d’une règle →', JSON.stringify(del.data), del.error?.message);
  const cle = await admin.from('automation_webhooks').select('api_key').limit(1);
  console.log('  admin select api_key →', JSON.stringify(cle.data), cle.error?.message);
  const cle2 = await sb(jetons.proprioA).from('automation_webhooks').select('*').limit(1);
  console.log('  proprio select * webhooks →', JSON.stringify(cle2.data)?.slice(0, 200), cle2.error?.message);
  const insCle = await admin.from('automation_webhooks').insert({ org_id: b.orgA, name: `${marque} clé choisie`, api_key: 'a'.repeat(64) }).select('id');
  console.log('  admin insert avec api_key choisie →', JSON.stringify(insCle.data), insCle.error?.message);
  const cs = await edit.from('company_settings').update({ default_language: 'en' }).eq('org_id', b.orgA).select('default_language');
  console.log('  éditeur company_settings.default_language →', JSON.stringify(cs.data), cs.error?.message);
}

// Ménage
for (const org of [b.orgA, b.orgB]) {
  const { data } = await b.admin.from('automation_rules').select('id').eq('org_id', org).ilike('name', `%${marque}%`);
  const ids = (data ?? []).map((l) => l.id as string);
  if (ids.length) {
    await b.admin.from('automation_scheduled_tasks').delete().in('automation_rule_id', ids);
    await b.admin.from('automation_execution_logs').delete().in('automation_rule_id', ids);
    await b.admin.from('automation_rules').delete().in('id', ids);
  }
}
await b.admin.from('automation_folders').delete().in('org_id', [b.orgA, b.orgB]).ilike('name', `%${marque}%`);
await b.admin.from('automation_webhooks').delete().in('org_id', [b.orgA, b.orgB]).ilike('name', `%${marque}%`);
await b.admin.from('company_settings').update({ automations_paused: false, automations_paused_at: null, automations_paused_by: null, default_language: 'fr' }).in('org_id', [b.orgA, b.orgB]);
process.exit(0);
