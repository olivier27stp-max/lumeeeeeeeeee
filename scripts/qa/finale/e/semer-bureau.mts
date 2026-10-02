/**
 * Agent E — sème MON bureau A (suffixe « e ») comme une VRAIE entreprise :
 *   1. le socle que reçoit toute nouvelle entreprise (`seedOrgComplete` : catalogue
 *      de métier, automatisations fournies, taxes) ;
 *   2. les avis clients réglés (lien Google), pour que les demandes d'avis partent ;
 *   3. quelques fiches réalistes (client, prospect, devis envoyé, facture en retard,
 *      job avec un rendez-vous) — coordonnées fictives (555-01xx, lume-qa.test).
 *
 * Pile LOCALE seulement. Idempotent (retrouve ses fiches par la marque [E-SEME]).
 *
 *   QA_AUTO_SUFFIXE=e npx tsx --env-file=.env.local scripts/qa/finale/e/semer-bureau.mts
 */
import { assurerBureauTest } from '../../../../tests/automations-suite/harnais/bureau-test';
import { seedOrgComplete } from '../../../../server/lib/seedOrgDefaults';

if (!String(process.env.VITE_SUPABASE_URL ?? '').includes('localhost')) {
  throw new Error('REFUS : ce script ne sème que la pile LOCALE.');
}
if ((process.env.QA_AUTO_SUFFIXE ?? '') !== 'e') throw new Error('REFUS : QA_AUTO_SUFFIXE=e attendu (bureaux de l’agent E).');

const MARQUE = '[E-SEME]';
const b = await assurerBureauTest();
const { admin, orgA } = b;
const proprio = b.users.proprioA;

const socle = await seedOrgComplete(admin, orgA, { industry: 'window_cleaning', taxRegion: 'QC' });

const ok = async <T,>(p: PromiseLike<{ data: T; error: { message: string } | null }>, quoi: string): Promise<T> => {
  const { data, error } = await p;
  if (error) throw new Error(`${quoi} : ${error.message}`);
  return data;
};

await ok(admin.from('company_settings').update({
  review_enabled: true, google_review_url: 'https://g.page/r/exemple-lume-qa/review',
}).eq('org_id', orgA).select('org_id'), 'avis clients');

async function unClient(prenom: string, nom: string, extra: Record<string, unknown> = {}): Promise<string> {
  const { data: deja } = await admin.from('clients').select('id').eq('org_id', orgA).eq('last_name', `${nom} ${MARQUE}`).maybeSingle();
  if (deja) return deja.id as string;
  const maintenant = new Date().toISOString();
  const cree = await ok(admin.from('clients').insert({
    org_id: orgA, created_by: proprio, first_name: prenom, last_name: `${nom} ${MARQUE}`, status: 'active',
    email: `${prenom.toLowerCase()}.${nom.toLowerCase()}@lume-qa.test`, phone: '+15145550142',
    address: '120 rue Principale, Montréal', sms_consent_at: maintenant, email_consent_at: maintenant, ...extra,
  }).select('id').single(), 'client');
  return (cree as { id: string }).id;
}

const client = await unClient('Marie', 'Tremblay');
const prospect = await unClient('Luc', 'Gagnon', { status: 'lead', lead_status: 'new' });

const { data: devisDeja } = await admin.from('quotes').select('id').eq('org_id', orgA).eq('title', `Lavage de vitres ${MARQUE}`).maybeSingle();
const devis = devisDeja?.id ?? (await ok(admin.from('quotes').insert({
  org_id: orgA, created_by: proprio, quote_number: `E-${Date.now().toString(36)}`, title: `Lavage de vitres ${MARQUE}`,
  client_id: client, context_type: 'client', status: 'awaiting_response',
  subtotal_cents: 125000, tax_cents: 18719, total_cents: 143719, valid_until: new Date(Date.now() + 20 * 86400_000).toISOString().slice(0, 10),
}).select('id').single(), 'devis') as { id: string }).id;

const { data: factureDeja } = await admin.from('invoices').select('id').eq('org_id', orgA).eq('subject', `Lavage de vitres ${MARQUE}`).maybeSingle();
const facture = factureDeja?.id ?? (await ok(admin.from('invoices').insert({
  org_id: orgA, created_by: proprio, invoice_number: `E-${Date.now().toString(36)}`, subject: `Lavage de vitres ${MARQUE}`,
  client_id: client, status: 'sent', subtotal_cents: 45000, tax_cents: 6739, total_cents: 51739,
  due_date: new Date(Date.now() - 5 * 86400_000).toISOString().slice(0, 10),
}).select('id').single(), 'facture') as { id: string }).id;

const { data: jobDeja } = await admin.from('jobs').select('id').eq('org_id', orgA).eq('title', `Lavage de vitres ${MARQUE}`).maybeSingle();
const job = jobDeja?.id ?? (await ok(admin.from('jobs').insert({
  org_id: orgA, created_by: proprio, job_number: `E-${Date.now().toString(36)}`, title: `Lavage de vitres ${MARQUE}`,
  client_id: client, client_name: 'Marie Tremblay', property_address: '120 rue Principale, Montréal', status: 'scheduled',
}).select('id').single(), 'job') as { id: string }).id;

const { data: visiteDeja } = await admin.from('schedule_events').select('id').eq('org_id', orgA).eq('job_id', job).maybeSingle();
const debut = new Date(Date.now() + 3 * 86400_000); debut.setUTCHours(14, 0, 0, 0);
const visite = visiteDeja?.id ?? (await ok(admin.from('schedule_events').insert({
  org_id: orgA, created_by: proprio, job_id: job, title: `Lavage de vitres ${MARQUE}`,
  start_at: debut.toISOString(), end_at: new Date(debut.getTime() + 2 * 3600_000).toISOString(), status: 'scheduled',
}).select('id').single(), 'visite') as { id: string }).id;

const { data: regles } = await admin.from('automation_rules').select('id, name, trigger_event, preset_key, is_active, steps')
  .eq('org_id', orgA).is('deleted_at', null).order('trigger_event');
const { data: champs } = await admin.from('custom_fields').select('object_type, key, label, field_type').eq('org_id', orgA).is('archived_at', null).order('object_type');

console.log(JSON.stringify({
  orgA, socle, fiches: { client, prospect, devis, facture, job, visite },
  regles: (regles ?? []).map((r) => ({ id: r.id, nom: r.name, declencheur: r.trigger_event, cle: r.preset_key, publiee: r.is_active, parcours: Array.isArray(r.steps) && r.steps.length > 0 })),
  champs,
}, null, 2));
