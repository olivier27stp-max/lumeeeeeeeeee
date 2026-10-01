/**
 * H — Langue et contenu : le réglage FR/EN de l'entreprise est respecté par
 * chaque type de message d'automatisation (courriel, texto, pied de
 * désabonnement, demande d'avis, date/heure de rendez-vous, notification
 * envoyée par courriel à un membre).
 *
 * Le bureau B de ce suffixe est passé en ANGLAIS pour ce fichier (remis en
 * français à la fin) ; le bureau A reste en français — témoin.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { demarrerMoteur, marque, envoisSimules, attendre } from '../harnais/moteur';
import { journalDefinitif } from '../harnais/moteur';
import { COMPTES } from '../harnais/bureau-test';

let b: Awaited<ReturnType<typeof demarrerMoteur>>;
const m = marque('H');
const nettoyer: Array<() => PromiseLike<unknown>> = [];
const reglesDuTest: string[] = [];
let n = 0;
let reglagesB: Record<string, unknown> | null = null;

async function ok<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, quoi: string): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error || data === null || data === undefined) throw new Error(`${quoi} : ${error?.message ?? 'aucune donnée'}`);
  return data as NonNullable<T>;
}

async function unClient(org: string) {
  n += 1;
  const tel = `+1555555${String(100 + ((Math.floor(Date.now() / 1000) + n * 17) % 100)).padStart(4, '0')}`;
  const c = await ok(b.admin.from('clients').insert({
    org_id: org, created_by: org === b.orgA ? b.users.proprioA : b.users.proprioB, first_name: 'Harry', last_name: m, status: 'active',
    email: `h-${Date.now().toString(36)}-${n}@lume-qa.test`, phone: tel,
    email_consent_at: new Date().toISOString(), sms_consent_at: new Date().toISOString(),
  }).select('id, email, phone').single(), 'client');
  await b.admin.from('messages').delete().eq('org_id', org).eq('phone_number', c.phone);
  nettoyer.push(() => b.admin.from('clients').delete().eq('id', c.id));
  nettoyer.push(() => b.admin.from('email_unsubscribes').delete().eq('org_id', org).eq('email', c.email));
  nettoyer.push(() => b.admin.from('messages').delete().eq('org_id', org).eq('phone_number', c.phone));
  return c as { id: string; email: string; phone: string };
}

async function uneRegle(org: string, corps: Record<string, unknown>) {
  n += 1;
  const r = await ok(b.admin.from('automation_rules').insert({
    org_id: org, name: `${m} ${n}`, trigger_event: 'client.tagged', conditions: {}, delay_seconds: 0,
    is_active: true, is_preset: false, settings: { fenetre: { debut: 0, fin: 24 } }, ...corps,
  }).select('id').single(), 'règle');
  reglesDuTest.push(r.id);
  nettoyer.push(() => b.admin.from('automation_rules').delete().eq('id', r.id));
  return r.id as string;
}

async function journaux(regle: string) {
  const { data } = await b.admin.from('automation_execution_logs')
    .select('action_type, result_success, result_data, result_error').eq('automation_rule_id', regle);
  return data ?? [];
}
const termine = (l: Array<{ result_error: string | null }>, nb = 1) => l.length >= nb && l.every((x) => journalDefinitif(x.result_error));

async function declencher(org: string, regle: string, entite: { type: string; id: string }, nb = 1, evenement = 'client.tagged') {
  const depuis = new Date().toISOString();
  await b.eventBus.emit(evenement as never, { orgId: org, entityType: entite.type, entityId: entite.id, metadata: { tag: 'qa-secu' } });
  const logs = await attendre(() => journaux(regle), (l) => termine(l, nb), 30_000);
  return { logs, envois: await envoisSimules(b.admin, org, depuis) };
}

beforeAll(async () => {
  b = await demarrerMoteur();
  reglagesB = await ok(b.admin.from('company_settings').select('default_language, review_enabled, google_review_url').eq('org_id', b.orgB).single(), 'réglages B');
  await ok(b.admin.from('company_settings').update({ default_language: 'en', review_enabled: true, google_review_url: 'https://g.page/r/qa-secu-b/review' }).eq('org_id', b.orgB).select('org_id'), 'B en anglais');
  const { oublierLanguesOrg } = await import('../../../server/lib/automationEngine');
  oublierLanguesOrg();
}, 120_000);
afterEach(async () => {
  if (reglesDuTest.length) await b.admin.from('automation_rules').update({ is_active: false }).in('id', reglesDuTest.splice(0));
});
afterAll(async () => {
  if (reglagesB) await b.admin.from('company_settings').update(reglagesB).eq('org_id', b.orgB);
  await b.admin.from('memberships').update({ language: 'fr' }).eq('org_id', b.orgB).eq('user_id', b.users.proprioB);
  for (const f of nettoyer.reverse()) await f();
});

const bilingue = (type_envoi: string) => [
  { type: 'send_email', config: { subject: `Bonjour ${m}`, subject_en: `Hello ${m}`, body: '<p>Merci {client_first_name}</p>', body_en: '<p>Thanks {client_first_name}</p>', type_envoi } },
  { type: 'send_sms', config: { body: `Merci ${m}`, body_en: `Thanks ${m}`, type_envoi } },
];

describe('H — la langue de l’entreprise pour chaque message', () => {
  it('[H-001] entreprise ANGLAISE : courriel et texto en anglais, mention STOP et pied de désabonnement en anglais, <html lang="en">', async () => {
    const client = await unClient(b.orgB);
    const regle = await uneRegle(b.orgB, { actions: bilingue('marketing') });
    const { logs, envois } = await declencher(b.orgB, regle, { type: 'client', id: client.id }, 2);
    const courriel = envois.find((e) => e.destinataire === client.email);
    const texto = envois.find((e) => e.destinataire === client.phone);
    expect(courriel, JSON.stringify(logs)).toBeTruthy();
    expect(courriel!.sujet).toBe(`Hello ${m}`);
    expect(String(courriel!.corps)).toContain('Thanks Harry');
    expect(String(courriel!.corps)).toContain('<html lang="en">');
    expect(String(courriel!.corps)).toContain('Unsubscribe from these emails');
    expect(String(courriel!.corps)).not.toMatch(/Se désabonner|Merci/);
    expect(texto!.corps).toBe(`Thanks ${m}\nNettoyage Test B - Reply STOP to opt out.`);
  });

  it('[H-002] entreprise FRANÇAISE (témoin) : les mêmes messages en français', async () => {
    const client = await unClient(b.orgA);
    const regle = await uneRegle(b.orgA, { actions: bilingue('marketing') });
    const { logs, envois } = await declencher(b.orgA, regle, { type: 'client', id: client.id }, 2);
    const courriel = envois.find((e) => e.destinataire === client.email);
    const texto = envois.find((e) => e.destinataire === client.phone);
    expect(courriel!.sujet, JSON.stringify(logs)).toBe(`Bonjour ${m}`);
    expect(String(courriel!.corps)).toContain('Se désabonner de ces communications');
    expect(texto!.corps).toBe(`Merci ${m}\nNettoyage Test A - Répondez STOP pour ne plus recevoir.`);
  });

  it('[H-003] demande d’avis dans une entreprise anglaise : courriel ET texto en anglais (inv-2 : texto toujours en français)', async () => {
    const client = await unClient(b.orgB);
    const job = await ok(b.admin.from('jobs').insert({ org_id: b.orgB, created_by: b.users.proprioB, client_id: client.id, title: `Window cleaning ${m}`, status: 'completed', job_number: `H-${Date.now().toString(36)}` }).select('id').single(), 'job');
    nettoyer.push(() => b.admin.from('jobs').delete().eq('id', job.id));
    nettoyer.push(() => b.admin.from('review_requests').delete().eq('job_id', job.id));
    nettoyer.push(() => b.admin.from('satisfaction_surveys').delete().eq('job_id', job.id));
    const regle = await uneRegle(b.orgB, { trigger_event: 'task.completed', actions: [{ type: 'request_review', config: {} }] });
    const { logs, envois } = await declencher(b.orgB, regle, { type: 'job', id: job.id }, 1, 'task.completed');
    const courriel = envois.find((e) => e.destinataire === client.email);
    const texto = envois.find((e) => e.destinataire === client.phone);
    expect(courriel, JSON.stringify(logs)).toBeTruthy();
    const { DEFAULT_REVIEW_EMAIL_SUBJECT_EN } = await import('../../../server/lib/reviews');
    expect(courriel!.sujet).toBe(DEFAULT_REVIEW_EMAIL_SUBJECT_EN);
    expect(courriel!.sujet).not.toMatch(/avis|Votre/i);
    expect(texto, JSON.stringify(logs)).toBeTruthy();
    expect(String(texto!.corps), 'texto de demande d’avis en français dans une entreprise anglaise').not.toMatch(/Bonjour|merci d'avoir|Notez-nous|Répondez/);
    expect(String(texto!.corps)).toMatch(/^Hi Harry, thanks for choosing Nettoyage Test B!/);
    expect(String(texto!.corps)).toContain('Reply STOP to opt out.');
  });

  it('[H-004] heure du rendez-vous dans une entreprise anglaise : format anglais, pas « 14 h 00 »', async () => {
    const client = await unClient(b.orgB);
    const job = await ok(b.admin.from('jobs').insert({ org_id: b.orgB, created_by: b.users.proprioB, client_id: client.id, title: `Visit ${m}`, status: 'scheduled', job_number: `H-${Date.now().toString(36)}` }).select('id').single(), 'job');
    nettoyer.push(() => b.admin.from('jobs').delete().eq('id', job.id));
    // 18:00 UTC le 15 octobre 2026 = 14:00 à Toronto (heure avancée). Le harnais
    // met les bureaux « en journée » (fuseau variable) : ce test pose Toronto.
    const { viderCacheFuseau } = await import('../../../server/lib/automations-fuseau-org');
    const { fuseauEnJournee } = await import('../harnais/moteur');
    await b.admin.from('company_settings').update({ timezone: 'America/Toronto' }).eq('org_id', b.orgB);
    viderCacheFuseau();
    nettoyer.push(async () => { await b.admin.from('company_settings').update({ timezone: fuseauEnJournee() }).eq('org_id', b.orgB); viderCacheFuseau(); });
    const rdv = await ok(b.admin.from('schedule_events').insert({ org_id: b.orgB, created_by: b.users.proprioB, job_id: job.id, title: `Visit ${m}`, start_at: '2026-10-15T18:00:00Z', end_at: '2026-10-15T19:00:00Z' }).select('id').single(), 'rdv');
    nettoyer.push(() => b.admin.from('schedule_events').delete().eq('id', rdv.id));
    const { resolveEntityVariables } = await import('../../../server/lib/actions');
    const en = await resolveEntityVariables(b.admin, b.orgB, 'schedule_event', rdv.id);
    expect(en.appointment_time).toMatch(/^0?2:00\s?p\.?m\.?$/i);
    expect(en.appointment_date).toBe('2026-10-15');
    // Témoin : une entreprise française garde « 14 h 00 ».
    const { error } = await b.admin.from('company_settings').update({ default_language: 'fr' }).eq('org_id', b.orgB);
    expect(error).toBeNull();
    try {
      const fr = await resolveEntityVariables(b.admin, b.orgB, 'schedule_event', rdv.id);
      expect(fr.appointment_time).toBe('14 h 00');
    } finally {
      await b.admin.from('company_settings').update({ default_language: 'en' }).eq('org_id', b.orgB);
    }
  });

  it('[H-005] notification envoyée par courriel à un membre anglophone : titre anglais (title_en)', async () => {
    await ok(b.admin.from('memberships').update({ language: 'en' }).eq('org_id', b.orgB).eq('user_id', b.users.proprioB).select('user_id'), 'langue du membre');
    const client = await unClient(b.orgB);
    const regle = await uneRegle(b.orgB, { actions: [{ type: 'create_notification', config: {
      title: `Nouveau client ${m}`, title_en: `New client ${m}`, body: 'À rappeler', body_en: 'Call back', destinataire: 'proprietaire', par_courriel: 'true',
    } }] });
    const { logs, envois } = await declencher(b.orgB, regle, { type: 'client', id: client.id });
    const courriel = envois.find((e) => e.destinataire === COMPTES.proprioB.email);
    expect(courriel, JSON.stringify(logs)).toBeTruthy();
    expect(String(courriel!.sujet)).toContain(`New client ${m}`);
    await b.admin.from('notifications').delete().eq('org_id', b.orgB).ilike('title', `%${m}%`);
  });

  it('[H-006] une langue « en-CA » ne peut pas être enregistrée (CHECK fr|en) : l’écart langueOrg / langueDe est sans effet', async () => {
    const { error } = await b.admin.from('company_settings').update({ default_language: 'en-CA' }).eq('org_id', b.orgB);
    expect(error?.code).toBe('23514');
  });
});
