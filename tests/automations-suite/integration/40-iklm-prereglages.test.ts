/**
 * K — Préréglages : ce qui est semé à la création d'une entreprise, et si
 * chaque automatisation PUBLIÉE d'office fonctionne SANS configuration.
 *
 * Le bureau A reçoit le socle comme une vraie entreprise : seedOrgComplete
 * (ce que font /onboarding/complete, le webhook de paiement et
 * /workspaces/create), industrie « residential_cleaning » ; le bureau B
 * « roofing » (le plus proche de « Construction », qui n'existe pas dans
 * l'interface). Puis chaque préréglage publié est déclenché par son VRAI
 * chemin (transition en base → automation_evenements_base → bus, ou émission
 * identique à la route) et son parcours est déroulé jusqu'au bout en forçant
 * l'échéance des tâches (traiterFile, bureau A seulement). Rien ne part :
 * bac à sable ; les envois sont lus dans envois_simules.
 *
 * Fenêtre d'envoi : les messages différés attendent 8 h-20 h dans le fuseau
 * de l'entreprise. Pour que le test ne dépende pas de l'heure où il tourne,
 * le fuseau du bureau A est posé, le temps du fichier, sur une zone où il
 * est midi-ish maintenant (restauré à la fin).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { demarrerMoteur, marque, traiterFile, envoisSimules } from '../harnais/moteur';
import { NUMERO_A } from '../harnais/bureau-test';

let b: Awaited<ReturnType<typeof demarrerMoteur>>;
let fuseauAvant = 'America/Toronto';
const nettoyer: Array<() => PromiseLike<unknown>> = [];

const ZONES = ['Pacific/Honolulu', 'America/Los_Angeles', 'America/Toronto', 'America/Halifax', 'Atlantic/Azores', 'Europe/Paris', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland'];
function zoneDeJour(): string {
  const heure = (tz: string) => Number(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date()));
  return ZONES.find((z) => heure(z) >= 10 && heure(z) <= 16) ?? 'America/Toronto';
}

async function etatPresets(org: string) {
  const { data } = await b.admin.from('automation_rules').select('id, preset_key, is_active, trigger_event').eq('org_id', org).eq('is_preset', true).is('deleted_at', null);
  return (data ?? []) as Array<{ id: string; preset_key: string; is_active: boolean; trigger_event: string }>;
}

/** Fait avancer la file du bureau A jusqu'à ce qu'aucune tâche de ces règles ne soit due. */
async function derouler(regles: string[], tours = 30): Promise<void> {
  for (let i = 0; i < tours; i++) {
    const { data } = await b.admin.from('automation_scheduled_tasks').select('id').eq('org_id', b.orgA).in('automation_rule_id', regles).eq('status', 'pending');
    if (!data?.length) return;
    await b.admin.from('automation_scheduled_tasks').update({ execute_at: new Date(Date.now() - 1000).toISOString() }).in('id', data.map((t) => t.id));
    await traiterFile(b.admin, b.orgA);
  }
}

async function evenementsBase(): Promise<void> {
  const { traiterEvenementsBase } = await import('../../../server/lib/evenementsBase');
  await traiterEvenementsBase(b.admin, { orgId: b.orgA });
}

async function journal(regles: string[], depuis: string) {
  const { data } = await b.admin.from('automation_execution_logs').select('automation_rule_id, action_type, result_success, result_error, result_data')
    .eq('org_id', b.orgA).in('automation_rule_id', regles).gte('created_at', depuis);
  return data ?? [];
}

async function client(m: string): Promise<string> {
  const { data, error } = await b.admin.from('clients').insert({
    org_id: b.orgA, created_by: b.users.proprioA, first_name: 'Préréglage', last_name: m, status: 'lead',
    phone: '+15555550143', email: 'prereglage@lume-qa.test',
    sms_consent_at: new Date().toISOString(), email_consent_at: new Date().toISOString(),
  }).select('id').single();
  if (error) throw new Error(error.message);
  nettoyer.push(() => b.admin.from('clients').delete().eq('id', data.id));
  return data.id as string;
}

beforeAll(async () => {
  b = await demarrerMoteur();
  const { data: cs } = await b.admin.from('company_settings').select('timezone').eq('org_id', b.orgA).single();
  fuseauAvant = (cs?.timezone as string) || 'America/Toronto';
  const { seedOrgComplete } = await import('../../../server/lib/seedOrgDefaults');
  await seedOrgComplete(b.admin, b.orgA, { industry: 'residential_cleaning', taxRegion: 'QC' });
  await seedOrgComplete(b.admin, b.orgB, { industry: 'roofing', taxRegion: 'QC' });
  await b.admin.from('company_settings').update({ timezone: zoneDeJour() }).eq('org_id', b.orgA);
}, 180_000);

afterAll(async () => {
  await b.admin.from('company_settings').update({ timezone: fuseauAvant }).eq('org_id', b.orgA);
  for (const f of nettoyer.reverse()) await f();
});

describe('K — ce qui est semé', () => {
  it('[K-001] le métier ne change RIEN aux automatisations : Nettoyage et Toiture (≈ Construction) reçoivent le même socle', async () => {
    // Les métiers proposés à l'inscription (WorkspaceForm.tsx, INDUSTRY_KEYS) : pas de « construction ».
    const { readFileSync } = await import('node:fs');
    const bloc = /INDUSTRY_KEYS = \[([^\]]+)\]/.exec(readFileSync('src/components/workspace/WorkspaceForm.tsx', 'utf8'))?.[1] ?? '';
    const metiers = [...bloc.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(metiers).toContain('residential_cleaning');
    expect(metiers).not.toContain('construction');
    const a = (await etatPresets(b.orgA)).map((r) => `${r.preset_key}:${r.is_active}`).sort();
    const bb = (await etatPresets(b.orgB)).map((r) => `${r.preset_key}:${r.is_active}`).sort();
    expect(a).toEqual(bb);
  });

  it('[K-002] publiés d’office = le pack de base ; sollicitations commerciales et demandes d’avis en brouillon', async () => {
    const { PACK_ACTIF } = await import('../../../server/lib/automationPack.data');
    const { PRESETS_SOLLICITATION, PRESETS_ATTENDENT_AVIS } = await import('../../../server/lib/automationPresetSeeder');
    const etat = await etatPresets(b.orgA);
    const actifs = etat.filter((r) => r.is_active).map((r) => r.preset_key).sort();
    expect(actifs).toEqual([...PACK_ACTIF].filter((k) => !PRESETS_SOLLICITATION.has(k)).sort());
    for (const k of [...PRESETS_SOLLICITATION, ...PRESETS_ATTENDENT_AVIS, 'estimate_followup']) {
      expect(etat.find((r) => r.preset_key === k)?.is_active, k).toBe(false);
    }
  });

  it('[K-003] estimate_followup est mort : aucun chemin de l’app n’émet estimate.sent (préréglage laissé en brouillon)', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const fichiers: string[] = [];
    const parcourir = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) parcourir(p); else if (/\.tsx?$/.test(f)) fichiers.push(p); } };
    parcourir('server'); parcourir('src');
    const emetteurs = fichiers.filter((f) => /emit\(\s*['"]estimate\.sent['"]/.test(readFileSync(f, 'utf8')));
    // Le seul émetteur est POST /emails/send-quote, que l'interface n'appelle plus (quotesApi → /api/quotes/send-email).
    expect(emetteurs.map((f) => f.replace(/\\/g, '/'))).toEqual(['server/routes/emails.ts']);
    const front = fichiers.filter((f) => f.startsWith('src') && readFileSync(f, 'utf8').includes('/emails/send-quote'));
    expect(front).toEqual([]);
  });
});

describe('K — chaque préréglage publié fonctionne sans configuration', () => {
  async function verifier(cles: string[], depuis: string, attendMessages: boolean) {
    const etat = await etatPresets(b.orgA);
    const regles = cles.map((k) => etat.find((r) => r.preset_key === k)).filter((r): r is NonNullable<typeof r> => !!r);
    expect(regles.map((r) => r.preset_key)).toEqual(cles);
    await derouler(regles.map((r) => r.id));
    const lignes = await journal(regles.map((r) => r.id), depuis);
    const diag = JSON.stringify(lignes.map((l) => [etat.find((r) => r.id === l.automation_rule_id)?.preset_key, l.action_type, l.result_success, l.result_error, (l.result_data as Record<string, unknown> | null)?.saute ?? null]));
    for (const r of regles) {
      const siennes = lignes.filter((l) => l.automation_rule_id === r.id);
      expect(siennes.length, `${r.preset_key} ne s’est pas exécuté — ${diag}`).toBeGreaterThan(0);
      const echecs = siennes.filter((l) => !l.result_success && l.result_error !== 'en cours');
      expect(echecs, `${r.preset_key} en échec — ${diag}`).toEqual([]);
    }
    const messages = lignes.filter((l) => ['send_sms', 'send_email'].includes(l.action_type as string) && l.result_success && !(l.result_data as Record<string, unknown> | null)?.saute);
    const envois = await envoisSimules(b.admin, b.orgA, depuis);
    if (attendMessages) expect(messages.length, diag).toBeGreaterThan(0);
    expect(envois.length, `messages journalisés « partis » sans envoi simulé — ${diag}`).toBeGreaterThanOrEqual(messages.length);
    // Rien n'est parti d'un autre numéro que celui du bureau.
    for (const e of envois.filter((x) => x.canal === 'sms')) expect((e.meta as { from?: string }).from).toBe(NUMERO_A);
    return { lignes, envois };
  }

  it('[K-010] nouveau prospect → pack_suivi_prospect (bienvenue + suivis)', async () => {
    const depuis = new Date().toISOString();
    const c = await client(marque('K-010'));
    await b.eventBus.emit('lead.created', { orgId: b.orgA, entityType: 'lead', entityId: c, metadata: { name: 'Préréglage', email: 'prereglage@lume-qa.test', phone: '+15555550143' } });
    await new Promise((r) => setTimeout(r, 3000));
    await verifier(['pack_suivi_prospect'], depuis, true);
  }, 240_000);

  it('[K-011] soumission envoyée → pack_relance_devis + quote_sent_move_deal', async () => {
    const depuis = new Date().toISOString();
    const m = marque('K-011');
    const c = await client(m);
    const { data: q, error } = await b.admin.from('quotes').insert({
      org_id: b.orgA, client_id: c, created_by: b.users.proprioA, quote_number: `QA-${Date.now().toString(36)}`, status: 'awaiting_response', total_cents: 150000, title: m,
    }).select('id, quote_number').single();
    expect(error).toBeNull();
    nettoyer.push(() => b.admin.from('quotes').delete().eq('id', q!.id));
    await b.eventBus.emit('quote.sent', { orgId: b.orgA, entityType: 'quote', entityId: q!.id, actorId: b.users.proprioA, metadata: { lead_id: null, channel: 'email', quote_number: q!.quote_number, client_name: 'Préréglage' } });
    await new Promise((r) => setTimeout(r, 3000));
    await verifier(['pack_relance_devis', 'quote_sent_move_deal'], depuis, true);

    // [K-012] soumission ACCEPTÉE (transition en base) → pack_depot + quote_approved_move_deal
    const depuis2 = new Date().toISOString();
    await b.admin.from('quotes').update({ status: 'approved' }).eq('id', q!.id);
    await evenementsBase();
    await new Promise((r) => setTimeout(r, 3000));
    await verifier(['pack_depot', 'quote_approved_move_deal'], depuis2, true);
  }, 300_000);

  it('[K-013] facture envoyée (transition en base) → pack_relance_facture ; payée → payment_confirmation ; dépôt → deposit_received', async () => {
    const depuis = new Date().toISOString();
    const c = await client(marque('K-013'));
    const { data: inv, error } = await b.admin.from('invoices').insert({
      org_id: b.orgA, client_id: c, created_by: b.users.proprioA, invoice_number: `QA-${Date.now().toString(36)}`, status: 'draft',
      subtotal_cents: 100000, tax_cents: 0, total_cents: 100000, paid_cents: 0, balance_cents: 100000,
      due_date: new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10),
    }).select('id').single();
    expect(error).toBeNull();
    nettoyer.push(() => b.admin.from('invoices').delete().eq('id', inv!.id));
    await b.admin.from('invoices').update({ status: 'sent' }).eq('id', inv!.id);
    await evenementsBase();
    await new Promise((r) => setTimeout(r, 3000));
    await verifier(['pack_relance_facture'], depuis, true);

    const depuis2 = new Date().toISOString();
    await b.eventBus.emit('invoice.paid', { orgId: b.orgA, entityType: 'invoice', entityId: inv!.id, actorId: b.users.proprioA, relatedEntityType: 'client', relatedEntityId: c, metadata: { amount_cents: 100000, provider: 'manual', client_id: c, job_id: null, payment_type: 'full' } });
    await new Promise((r) => setTimeout(r, 3000));
    await verifier(['payment_confirmation'], depuis2, true);

    const depuis3 = new Date().toISOString();
    await b.eventBus.emit('invoice.paid', { orgId: b.orgA, entityType: 'invoice', entityId: inv!.id, actorId: b.users.proprioA, relatedEntityType: 'client', relatedEntityId: c, metadata: { amount_cents: 25000, provider: 'manual', client_id: c, job_id: null, payment_type: 'deposit' } });
    await new Promise((r) => setTimeout(r, 3000));
    await verifier(['deposit_received'], depuis3, false);
  }, 300_000);

  it('[K-014] visite planifiée (insertion en base) → pack_rendez_vous (confirmation + rappels) ; job terminé → thank_you_after_job ; contrat signé → agreement_signed', async () => {
    const depuis = new Date().toISOString();
    const m = marque('K-014');
    const c = await client(m);
    const { data: job, error } = await b.admin.from('jobs').insert({
      org_id: b.orgA, client_id: c, created_by: b.users.proprioA, job_number: `QA-${Date.now().toString(36)}`, title: m, status: 'scheduled',
    }).select('id').single();
    expect(error).toBeNull();
    nettoyer.push(() => b.admin.from('jobs').delete().eq('id', job!.id));
    const debut = new Date(Date.now() + 10 * 86400_000);
    const { data: ev, error: e2 } = await b.admin.from('schedule_events').insert({
      org_id: b.orgA, job_id: job!.id, title: m, start_at: debut.toISOString(), end_at: new Date(debut.getTime() + 7200_000).toISOString(),
      start_time: debut.toISOString(), end_time: new Date(debut.getTime() + 7200_000).toISOString(), status: 'scheduled', created_by: b.users.proprioA,
    }).select('id').single();
    expect(e2).toBeNull();
    nettoyer.push(() => b.admin.from('schedule_events').delete().eq('id', ev!.id));
    await evenementsBase();
    await new Promise((r) => setTimeout(r, 3000));
    const { envois } = await verifier(['pack_rendez_vous'], depuis, true);
    // Confirmation + 3 rappels (7 j, veille, 2 h) : au moins 4 textos.
    expect(envois.filter((e) => e.canal === 'sms').length).toBeGreaterThanOrEqual(4);

    const depuis2 = new Date().toISOString();
    await b.admin.from('jobs').update({ status: 'completed' }).eq('id', job!.id);
    await evenementsBase();
    await new Promise((r) => setTimeout(r, 3000));
    await verifier(['thank_you_after_job'], depuis2, true);

    const depuis3 = new Date().toISOString();
    await b.eventBus.emit('agreement.signed', { orgId: b.orgA, entityType: 'job', entityId: job!.id, metadata: { agreement_id: null, signer_name: 'Préréglage', job_number: 'QA' }, relatedEntityType: 'job_agreement' });
    await new Promise((r) => setTimeout(r, 3000));
    await verifier(['agreement_signed'], depuis3, true);
  }, 300_000);

  it('[K-015] soumission ouverte par le client → quote_opened_notify + quote_opened_move_deal', async () => {
    const depuis = new Date().toISOString();
    const m = marque('K-015');
    const c = await client(m);
    const { data: q } = await b.admin.from('quotes').insert({
      org_id: b.orgA, client_id: c, created_by: b.users.proprioA, quote_number: `QA-${Date.now().toString(36)}`, status: 'awaiting_response', total_cents: 90000, title: m,
    }).select('id, quote_number').single();
    nettoyer.push(() => b.admin.from('quotes').delete().eq('id', q!.id));
    await b.eventBus.emit('quote.viewed', {
      orgId: b.orgA, entityType: 'quote', entityId: q!.id, relatedEntityType: 'client', relatedEntityId: c,
      metadata: { quote_id: q!.id, quote_number: q!.quote_number, client_id: c, is_first_view: true, view_count: 1, ouverture: ['premiere', 'chaque'], total_cents: 90000, montant: 900, pipeline_id: null, stage_id: null, etiquette: [], service_id: [] },
    });
    await new Promise((r) => setTimeout(r, 3000));
    await verifier(['quote_opened_notify', 'quote_opened_move_deal'], depuis, false);
  }, 240_000);
});
