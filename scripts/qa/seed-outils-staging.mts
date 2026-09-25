/**
 * Seed de l'org QA sur STAGING pour la batterie des outils (evaluer-outils.mts).
 * ─────────────────────────────────────────────────────────────────────────
 * La passe 2 (2026-09-16) comptait 90 « partiels » dont l'immense majorité
 * était « la donnée n'existe pas » (aucun préréglage, modèle, équipe, taxe,
 * formation, facture récurrente, maison, territoire…) ou « deux fiches
 * identiques ». Ici on crée ces données UNE fois, par les outils de Lumi
 * eux-mêmes (mêmes validations, même identité JWT + RLS), pour que chaque
 * demande d'écriture de la batterie ait quelque chose sur quoi porter.
 *
 * Idempotent : chaque entité n'est créée que si sa liste ne la contient pas.
 * Refuse la prod. L'API locale doit tourner (PORT, défaut 3012) : les outils
 * d'écriture rejouent les routes de l'app.
 *
 *   PORT=3012 node --env-file=.env.local --import tsx scripts/qa/seed-outils-staging.mts
 */
import { createClient } from '@supabase/supabase-js';

process.env.PORT = process.env.PORT || '3012';
const url = process.env.VITE_SUPABASE_URL ?? '';
if (process.env.SUPABASE_PROJECT_REF_PROD && url.includes(process.env.SUPABASE_PROJECT_REF_PROD)) throw new Error('Refus : la prod.');
const COMPTE = process.env.QA_COMPTE || 'willhebert30@gmail.com';
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false, autoRefreshToken: false } });
const anonOpts = { auth: { persistSession: false, autoRefreshToken: false } };

const { data: l, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTE });
if (error) throw new Error(`lien magique : ${error.message}`);
const { data: s, error: e2 } = await createClient(url, process.env.VITE_SUPABASE_ANON_KEY ?? '', anonOpts).auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' });
if (e2 || !s.session) throw new Error(`session : ${e2?.message}`);
const userId = s.session.user.id;
const { data: m } = await admin.from('memberships').select('org_id').eq('user_id', userId).eq('status', 'active').limit(1).maybeSingle();
if (!m) throw new Error('aucune org');
const orgId = m.org_id as string;
const client = createClient(url, process.env.VITE_SUPABASE_ANON_KEY ?? '', { ...anonOpts, global: { headers: { Authorization: `Bearer ${s.session.access_token}` } } });
const ctx = { client, orgId, userId, accessToken: s.session.access_token };

const { AGENT_TOOLS } = await import('../../server/lib/agent/tools');
const outil = (n: string) => { const t = AGENT_TOOLS.find((x) => x.declaration.name === n); if (!t?.handler) throw new Error(`outil absent : ${n}`); return t; };
async function lire(n: string, args: Record<string, any> = {}): Promise<any> { return outil(n).handler!(args, ctx as any); }
async function ecrire(n: string, args: Record<string, any>): Promise<any> {
  try {
    const r = await outil(n).handler!(args, ctx as any);
    if (r && typeof r === 'object' && 'error' in r) { console.log(`  ERR ${n} : ${String((r as any).error).slice(0, 160)}`); return null; }
    console.log(`  OK  ${n} ${JSON.stringify(args).slice(0, 90)}`);
    return r;
  } catch (e: any) { console.log(`  ERR ${n} : ${String(e?.message || e).slice(0, 160)}`); return null; }
}
const contient = (r: unknown, aiguille: string) => JSON.stringify(r ?? '').toLowerCase().includes(aiguille.toLowerCase());
/** Tous les objets { id, … } du résultat dont une valeur texte contient l'aiguille. */
function objets(r: unknown, aiguille: string): Array<Record<string, any>> {
  const out: Array<Record<string, any>> = [];
  const marcher = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(marcher); return; }
    if (v && typeof v === 'object') {
      const o = v as Record<string, any>;
      if (typeof o.id === 'string' && Object.values(o).some((x) => typeof x === 'string' && x.toLowerCase().includes(aiguille.toLowerCase()))) out.push(o);
      Object.values(o).forEach(marcher);
    }
  };
  marcher(r);
  return out;
}
/** Crée si la liste ne contient pas déjà l'aiguille ; renvoie le résultat de la création ou null. */
async function siAbsent(liste: string, argsListe: Record<string, any>, aiguille: string, creation: string, args: Record<string, any>): Promise<any> {
  const r = await lire(liste, argsListe);
  if (contient(r, aiguille)) { console.log(`  =   ${creation} : « ${aiguille} » existe déjà`); return null; }
  return ecrire(creation, args);
}

console.log(`Seed staging — org ${orgId}, compte ${COMPTE}, API sur le port ${process.env.PORT}`);

// ── Doublons de clients : une seule fiche par personne (les cas « lequel ? » disparaissent) ──
for (const nom of ['Gagnon', 'Bouchard']) {
  const r = await lire('search_clients', { query: nom, limit: 10 });
  const fiches = objets(r, nom).filter((o) => 'id' in o);
  const uniques = [...new Map(fiches.map((f) => [f.id, f])).values()];
  if (uniques.length > 1) {
    console.log(`  ${nom} : ${uniques.length} fiches → fusion`);
    for (const doublon of uniques.slice(1)) await ecrire('merge_clients', { keep_client_id: uniques[0].id, absorb_client_id: doublon.id });
  } else console.log(`  =   ${nom} : une seule fiche`);
}
const gagnon = objets(await lire('search_clients', { query: 'Gagnon', limit: 5 }), 'Gagnon')[0]?.id as string | undefined;

// ── Prospects, adresses, notes ──
await siAbsent('search_leads', { query: 'Fortin', limit: 5 }, 'Fortin', 'create_lead', { first_name: 'Julie', last_name: 'Fortin', phone: '514-555-0199', notes: 'Intéressée par un lavage de vitres' });
if (gagnon) {
  await siAbsent('list_properties', { client_id: gagnon }, 'Chalet', 'create_property', { client_id: gagnon, name: 'Chalet', address: '12 chemin du Lac', city: 'Magog', province: 'QC', country: 'CA', kind: 'service' });
  await siAbsent('list_notes', { entity_type: 'client', entity_id: gagnon }, 'Code de porte', 'add_note', { entity_type: 'client', entity_id: gagnon, note: 'Code de porte 4321' });
}

// ── Devis : préréglages, modèles ; factures : modèles, récurrentes ──
await siAbsent('list_quote_presets', {}, 'Nettoyage printemps', 'create_quote_preset', { name: 'Nettoyage printemps', description: 'Vitres et gouttières', services: [{ name: 'Lavage de vitres', quantity: 1 }, { name: 'Nettoyage de gouttières', quantity: 1 }] });
await siAbsent('list_quote_templates', {}, 'Vitres résidentiel', 'create_quote_template', { name: 'Vitres résidentiel', services: [{ name: 'Lavage de vitres', quantity: 1, unit_price_cents: 15000 }], tax_enabled: true });
await siAbsent('list_invoice_templates', {}, 'Entretien mensuel', 'create_invoice_template', { name: 'Entretien mensuel', title: 'Entretien mensuel', line_items: [{ description: 'Entretien mensuel', qty: 1, unit_price_cents: 12000 }] });
if (gagnon) await siAbsent('list_recurring_invoices', {}, 'Entretien mensuel', 'create_recurring_invoice', { client_id: gagnon, subject: 'Entretien mensuel', items: [{ description: 'Entretien mensuel', qty: 1, unit_price_cents: 12000 }], frequency: 'monthly', start_date: '2026-10-01' });

// ── Listes de vérification, courriels, étiquettes, services, taxes, objectifs, rapports ──
await siAbsent('list_checklist_templates', {}, 'Fin de chantier', 'create_checklist_template', { name: 'Fin de chantier', items: [{ id: 'outils', type: 'checkbox', label: 'Ramasser les outils', required: true }, { id: 'photos', type: 'checkbox', label: 'Photos après', required: false }] });
await siAbsent('list_email_templates', {}, 'Merci', 'create_email_template', { name: 'Merci', type: 'generic', subject: 'Merci !', body: 'Merci pour votre confiance, à bientôt.' });
await siAbsent('list_job_tags', {}, 'Urgent', 'create_job_tag', { name: 'Urgent', color_hex: '#dc2626' });
await siAbsent('list_services', {}, 'Lavage de vitres', 'create_service', { name: 'Lavage de vitres', price_cents: 15000, category: 'Extérieur' });
await siAbsent('list_services', {}, 'Plantation de fleurs', 'create_service', { name: 'Plantation de fleurs annuelles', price_cents: 9000, category: 'Paysagement' });
await siAbsent('get_tax_config', {}, 'TPS', 'create_tax_config', { name: 'TPS', rate: 5, region: 'QC', country: 'CA' });
await siAbsent('get_tax_config', {}, 'TVQ', 'create_tax_config', { name: 'TVQ', rate: 9.975, region: 'QC', country: 'CA' });
await siAbsent('list_goals', {}, '2026-10', 'set_goal', { metric: 'revenue', target_value: 5000000, period: 'monthly', start_date: '2026-10-01', end_date: '2026-10-31' });
await siAbsent('list_scheduled_reports', {}, COMPTE, 'create_scheduled_report', { recipient_email: COMPTE, frequency: 'monthly', day_of_month: 1 });

// ── Équipe : une équipe nommée, une plage le samedi matin, une invitation en attente ──
let equipe = objets(await lire('list_teams', {}), 'Équipe Nord')[0]?.id as string | undefined;
if (!equipe) { const r = await ecrire('create_team', { name: 'Équipe Nord', color_hex: '#2563eb' }); equipe = (r?.team_id ?? r?.id ?? objets(r, 'Nord')[0]?.id) as string | undefined; }
if (equipe) await siAbsent('list_availability', { team_id: equipe }, '"6"', 'create_availability', { team_id: equipe, weekday: 6, start_time: '08:00', end_time: '12:00' });
await siAbsent('list_invitations', { status: 'all' }, 'marc.tremblay@example.com', 'invite_member', { email: 'marc.tremblay@example.com', role: 'technician' });

// ── Formation : cours → module → leçon ──
let cours = objets(await lire('list_courses', { with_lessons: true }), 'Accueil du client')[0] as Record<string, any> | undefined;
if (!cours) { const r = await ecrire('create_course', { title: 'Accueil du client', description: 'Les bases du premier contact' }); cours = r ? { id: r.course_id ?? r.id } : undefined; }
const coursId = cours?.course_id ?? cours?.id;
if (coursId) {
  const detail = objets(await lire('list_courses', { with_lessons: true }), 'Accueil du client');
  let moduleId = objets(detail, 'Se présenter').find((o) => o.module_id || o.titre === 'Se présenter')?.module_id ?? objets(detail, 'Se présenter')[0]?.id;
  if (!moduleId) { const r = await ecrire('create_course_module', { course_id: coursId, title: 'Se présenter' }); moduleId = r?.module_id ?? r?.id; }
  if (moduleId && !contient(detail, 'Le sourire')) await ecrire('create_course_lesson', { module_id: moduleId, title: 'Le sourire', content_type: 'text', text_content: 'Souriez avant de parler.' });
}

// ── Terrain : une maison, un territoire ──
await siAbsent('list_houses', { query: 'Principale' }, '123 rue Principale', 'create_house', { address: '123 rue Principale', lat: 45.5017, lng: -73.5673, status: 'no_answer' });
await siAbsent('list_territories', {}, 'Vieux-Longueuil', 'create_territory', { name: 'Vieux-Longueuil', polygon: [[-73.515, 45.531], [-73.515, 45.539], [-73.505, 45.539], [-73.505, 45.531]] });

// ── Job 33 : une liste de vérification et une récurrence (la batterie les lit, coche, arrête) ──
const job33 = objets(await lire('list_jobs', { query: '33', limit: 5 }), '33').find((o) => String(o.number ?? o.numero ?? '') === '33' || contient(o, 'Lavage de vitres'))?.id as string | undefined;
if (job33) {
  await siAbsent('list_job_checklists', { job_id: job33 }, 'Fin de chantier', 'create_job_checklist', { job_id: job33, items: [{ id: 'outils', type: 'checkbox', label: 'Ramasser les outils', required: true }, { id: 'fenetres', type: 'checkbox', label: 'Vérifier les fenêtres', required: false }] });
  await siAbsent('list_recurrence_rules', {}, 'Lavage de vitres', 'create_recurrence_rule', { job_id: job33, frequency: 'monthly', start_date: '2026-10-27', max_occurrences: 3 });
} else console.log('  ?   job 33 introuvable');

console.log('Seed terminé.');
process.exit(0);
