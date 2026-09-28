/**
 * PR 1 — Désabonnement par canal (drapeau `auto_desabonnement_canal`).
 *
 *  1. Mots-clés texto : STOP, ARRET, ARRÊT, DESABONNER, UNSUBSCRIBE (casse
 *     et accents ignorés) → retrait ; START, REPRENDRE → réabonnement.
 *  2. Le STOP ne vaut que pour l'entreprise du numéro qui l'a reçu, il est
 *     journalisé et confirmé ; une confirmation bloquée par Twilio (21610)
 *     ne casse rien.
 *  3. Moteur, drapeau ON : marketing sauté (« Client désabonné (texto) »,
 *     parcours qui continue), transactionnel envoyé.
 *  4. Moteur, drapeau OFF : exactement l'ancien comportement (le filet de
 *     régression le prouve pour tout le catalogue ; ici, le cas désabonné).
 *  5. Page de préférences par jeton : choix par canal, appliqué et journalisé.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';

const etat = vi.hoisted(() => ({
  e: { sms: [] as any[], courriels: [] as any[], appels: [] as any[], slack: [] as any[] },
  client: { current: null as any },
}));

vi.mock('../../server/lib/supabase', async (orig) => ({
  ...(await orig<any>()),
  getServiceClient: () => etat.client.current,
}));
vi.mock('../../server/lib/mailer', async (orig) => ({
  ...(await orig<any>()),
  isMailerConfigured: () => true,
  sendEmail: vi.fn(async (p: any) => { etat.e.courriels.push({ to: p.to, subject: p.subject, html: p.html, headers: p.headers }); return { sent: true, messageId: 't' }; }),
}));
vi.mock('../../server/lib/twilioProvisioning', async (orig) => ({
  ...(await orig<any>()),
  getOrgSmsFromNumber: async () => '+15550000000',
}));

import { motCle, estStop, estStart, typeEnvoi, motifSaut } from '../../server/lib/desabonnement';
import { appliquerMotCleSms } from '../../server/lib/desabonnement/sms';
import { oublierDrapeaux } from '../../server/lib/automations-drapeaux';
import { jouer, evenementPour, courant, monde, IDS, ORG } from './filet-regression/_banc';
import { clientEnregistreur, requetes } from './filet-regression/_enregistreur';

const DRAPEAU_ON = { org_features: { data: [{ feature: 'auto_desabonnement_canal', enabled: true }] } };
const STOP_TEXTO = { sms_opt_outs: { data: [{ id: 'opt-1', opted_out_at: '2026-09-01T12:00:00Z', reason: 'client_stop' }] } };
const STOP_COURRIEL = { email_unsubscribes: { data: [{ id: 'uns-1', category: 'all', unsubscribed_at: '2026-09-01T12:00:00Z', reason: 'lien-courriel', token: 'x' }] } };

const lier = () => Object.defineProperty(etat.client, 'current', { get: () => courant.client, configurable: true });
const TZ = process.env.TZ;
// Les liens publics (soumission, facture) exigent une base : sans elle, la
// résolution des variables lève et la tâche part en reprise.
process.env.PUBLIC_URL = process.env.PUBLIC_URL || 'https://app.lume.test';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'https://app.lume.test';

beforeEach(() => { oublierDrapeaux(); lier(); });
afterEach(() => { vi.useRealTimers(); if (TZ === undefined) delete process.env.TZ; else process.env.TZ = TZ; });

// ── 1. Mots-clés ────────────────────────────────────────────

describe('mots-clés texto', () => {
  it.each(['STOP', 'stop', 'Stop.', ' ARRET ', 'ARRÊT', 'arrêt!', 'Arret', 'DESABONNER', 'Désabonner', 'désabonner', 'UNSUBSCRIBE', 'unsubscribe'])(
    '« %s » désabonne', (m) => { expect(estStop(m)).toBe(true); expect(estStart(m)).toBe(false); },
  );
  it.each(['START', 'start', 'REPRENDRE', 'Reprendre', 'reprendre.'])(
    '« %s » réabonne', (m) => { expect(estStart(m)).toBe(true); expect(estStop(m)).toBe(false); },
  );
  it.each(['oui', 'yes', 'stop svp merci', 'Arrêtez de venir mardi', '', 'STOPPER'])(
    '« %s » ne fait rien', (m) => { expect(estStop(m)).toBe(false); expect(estStart(m)).toBe(false); },
  );
  it('normalise casse, accents et ponctuation', () => {
    expect(motCle('  ArRêT… ')).toBe('arret');
  });
});

// ── 2. Classement ───────────────────────────────────────────

describe('type d\'envoi', () => {
  it('le choix explicite l\'emporte', () => {
    expect(typeEnvoi({ actionType: 'send_sms', config: { type_envoi: 'marketing' }, declencheur: 'appointment.created' })).toBe('marketing');
    expect(typeEnvoi({ actionType: 'send_sms', config: { type_envoi: 'transactionnel' }, declencheur: 'quote.sent', delaiSecondes: 86400 })).toBe('transactionnel');
  });
  it('demande d\'avis = marketing ; envoyer facture/soumission = transactionnel', () => {
    expect(typeEnvoi({ actionType: 'request_review', declencheur: 'job.completed' })).toBe('marketing');
    expect(typeEnvoi({ actionType: 'envoyer_facture', declencheur: 'deal.stage_entered' })).toBe('transactionnel');
  });
  it('presets classés un par un', () => {
    expect(typeEnvoi({ actionType: 'send_sms', presetKey: 'job_reminder_1d', declencheur: 'appointment.created', delaiSecondes: -86400 })).toBe('transactionnel');
    expect(typeEnvoi({ actionType: 'send_email', presetKey: 'invoice_sent_reminder_7d', declencheur: 'invoice.sent', delaiSecondes: 604800 })).toBe('transactionnel');
    expect(typeEnvoi({ actionType: 'send_sms', presetKey: 'quote_followup_3d', declencheur: 'quote.sent', delaiSecondes: 259200 })).toBe('marketing');
    expect(typeEnvoi({ actionType: 'send_email', presetKey: 'seasonal_reminder_6m', declencheur: 'job.completed', delaiSecondes: 15552000 })).toBe('marketing');
  });
  it('règle générale : relance différée de soumission = marketing, accusé immédiat = transactionnel, doute = marketing', () => {
    expect(typeEnvoi({ actionType: 'send_sms', declencheur: 'quote.sent', delaiSecondes: 86400 })).toBe('marketing');
    expect(typeEnvoi({ actionType: 'send_sms', declencheur: 'quote.sent', delaiSecondes: 0 })).toBe('transactionnel');
    expect(typeEnvoi({ actionType: 'send_sms', declencheur: 'job.completed', delaiSecondes: 3600 })).toBe('transactionnel');
    expect(typeEnvoi({ actionType: 'send_sms', declencheur: 'job.completed', delaiSecondes: 30 * 86400 })).toBe('marketing');
    expect(typeEnvoi({ actionType: 'send_sms', declencheur: 'webhook.received' })).toBe('marketing');
  });
});

// ── 3. STOP / START entrants ────────────────────────────────

describe('STOP / START pour UNE entreprise', () => {
  const telephone = '+15145550142';
  const preparer = () => clientEnregistreur({
    clients: { data: [{ id: IDS.client, phone: '(514) 555-0142' }] },
    company_settings: { data: [{ company_name: 'Plomberie Tremblay inc.', default_language: 'fr' }] },
  });

  it('STOP : retrait pour cette entreprise seulement, journalisé, confirmé', async () => {
    const { client, journal } = preparer();
    const envoyes: string[] = [];
    const ok = await appliquerMotCleSms(client, { orgId: ORG, telephone, genre: 'stop', envoyer: async (o, t, texte) => { envoyes.push(`${o}|${t}|${texte}`); } });
    expect(ok).toBe(true);
    const retraits = requetes(journal, 'sms_opt_outs', 'insert');
    expect(retraits).toHaveLength(1);
    expect(retraits[0].valeur).toMatchObject({ org_id: ORG, phone: telephone });
    // Aucune écriture ailleurs qu'à cette entreprise.
    expect(journal.filter((r) => r.op !== 'select' && r.op !== 'rpc').every((r) => (r.valeur as any)?.org_id === ORG)).toBe(true);
    const preuve = requetes(journal, 'rpc:record_consent', 'rpc')[0].valeur as any;
    expect(preuve).toMatchObject({ p_subject_id: IDS.client, p_purpose: 'sms-marketing', p_granted: false, p_method: 'texto-stop', p_org_id: ORG });
    expect(envoyes).toHaveLength(1);
    expect(envoyes[0]).toContain('Plomberie Tremblay inc.');
    expect(envoyes[0]).toContain('REPRENDRE');
  });

  it('START : réabonnement pour cette entreprise, journalisé', async () => {
    const { client, journal } = preparer();
    await appliquerMotCleSms(client, { orgId: ORG, telephone, genre: 'start', envoyer: async () => {} });
    const suppr = requetes(journal, 'sms_opt_outs', 'delete');
    expect(suppr).toHaveLength(1);
    expect(suppr[0].filtres).toEqual(expect.arrayContaining([['eq', 'org_id', ORG], ['eq', 'phone', telephone]]));
    expect((requetes(journal, 'rpc:record_consent', 'rpc')[0].valeur as any)).toMatchObject({ p_granted: true, p_method: 'texto-start' });
  });

  it('une confirmation bloquée par Twilio (21610) ne défait pas le retrait', async () => {
    const { client, journal } = preparer();
    const ok = await appliquerMotCleSms(client, {
      orgId: ORG, telephone, genre: 'stop',
      envoyer: async () => { throw Object.assign(new Error('unsubscribed'), { code: 21610 }); },
    });
    expect(ok).toBe(true);
    expect(requetes(journal, 'sms_opt_outs', 'insert')).toHaveLength(1);
  });

  it('un retrait qui ne s\'écrit pas est signalé (false), jamais présenté comme fait', async () => {
    const { client } = clientEnregistreur({ sms_opt_outs: { data: null, error: { message: 'refusé' } } });
    const ok = await appliquerMotCleSms(client, { orgId: ORG, telephone, genre: 'stop', envoyer: async () => {} });
    expect(ok).toBe(false);
  });
});

// ── 4. Le moteur ────────────────────────────────────────────

/**
 * Les lignes de RÉSULTAT du journal d'exécution pour cette action.
 *
 * Une action immédiate réserve d'abord sa ligne (« en cours », F3 #698) puis
 * écrit son résultat : la réservation n'est pas un résultat, on l'écarte.
 */
function journalDe(sortie: any, action: string) {
  return sortie.ecritures
    .filter((w: any) => w.table === 'automation_execution_logs' && w.valeur?.action_type === action && w.valeur?.result_error !== 'en cours')
    .map((w: any) => w.valeur);
}

describe('moteur — drapeau ON', () => {
  it('relance MARKETING (soumission + 1 jour) vers un désabonné du texto : sautée, motif journalisé', async () => {
    const s: any = await jouer(
      { id: 'r-mkt', trigger_event: 'quote.sent', delay_seconds: 86400, actions: [{ type: 'send_sms', config: { body: 'Avez-vous regardé la soumission ?' } }] },
      evenementPour('quote.sent'), etat.e, { ...DRAPEAU_ON, ...STOP_TEXTO },
    );
    expect(s.envois.filter((e: any) => e.canal === 'sms')).toHaveLength(0);
    const [log] = journalDe(s, 'send_sms');
    expect(log.result_success).toBe(true);
    expect(log.result_data).toEqual({ saute: motifSaut('texto') });
    expect(log.result_data.saute).toBe('Client désabonné (texto)');
    // La tâche est terminée (pas en échec, pas de reprise).
    expect(s.ecritures.some((w: any) => w.table === 'automation_scheduled_tasks' && w.valeur?.status === 'completed')).toBe(true);
  });

  it('rappel TRANSACTIONNEL (rendez-vous − 1 jour) vers un désabonné du texto : envoyé', async () => {
    const s: any = await jouer(
      { id: 'r-trx', trigger_event: 'appointment.created', delay_seconds: -86400, actions: [{ type: 'send_sms', config: { body: 'Rappel : rendez-vous demain.' } }] },
      evenementPour('appointment.created'), etat.e, { ...DRAPEAU_ON, ...STOP_TEXTO },
    );
    expect(s.envois.filter((e: any) => e.canal === 'sms')).toHaveLength(1);
    expect(journalDe(s, 'send_sms')[0].result_success).toBe(true);
    expect(journalDe(s, 'send_sms')[0].result_data?.saute).toBeUndefined();
  });

  it('courriel MARKETING vers un désabonné du courriel : sauté ; le parcours continue avec l\'étape suivante', async () => {
    const s: any = await jouer(
      {
        id: 'r-seq', trigger_event: 'quote.sent', delay_seconds: 0, actions: [],
        steps: [
          { id: 'e1', type: 'attendre', delai_secondes: 86400, suivant: 'e2' },
          { id: 'e2', type: 'action', action: { type: 'send_email', config: { subject: 'Et alors ?', body: 'Votre soumission vous attend.' } }, suivant: 'e3' },
          { id: 'e3', type: 'action', action: { type: 'create_notification', config: { title: 'Relance faite', body: 'ok' } } },
        ],
      },
      evenementPour('quote.sent'), etat.e, { ...DRAPEAU_ON, ...STOP_COURRIEL },
    );
    expect(s.envois.filter((e: any) => e.canal === 'courriel')).toHaveLength(0);
    expect(journalDe(s, 'send_email')[0].result_data).toEqual({ saute: 'Client désabonné (courriel)' });
    // L'étape d'après a bien été planifiée puis exécutée.
    expect(s.planifie.map((p: any) => p.step_id)).toEqual(['e2', 'e3']);
    expect(journalDe(s, 'create_notification')[0].result_success).toBe(true);
  });

  it('courriel TRANSACTIONNEL (facture + 7 jours) vers un désabonné du courriel : envoyé, sans lien de désabonnement', async () => {
    const s: any = await jouer(
      { id: 'r-fac', trigger_event: 'invoice.sent', delay_seconds: 604800, actions: [{ type: 'send_email', config: { subject: 'Rappel de facture', body: 'Votre facture est due.' } }] },
      evenementPour('invoice.sent'), etat.e, { ...DRAPEAU_ON, ...STOP_COURRIEL },
    );
    const courriels = s.envois.filter((e: any) => e.canal === 'courriel');
    expect(courriels).toHaveLength(1);
    expect(courriels[0].texte).not.toMatch(/désabonner/i);
  });

  it('le choix « marketing » dans l\'action l\'emporte sur un déclencheur transactionnel', async () => {
    const s: any = await jouer(
      { id: 'r-force', trigger_event: 'appointment.created', delay_seconds: 0, actions: [{ type: 'send_sms', config: { body: 'Promo !', type_envoi: 'marketing' } }] },
      evenementPour('appointment.created'), etat.e, { ...DRAPEAU_ON, ...STOP_TEXTO },
    );
    expect(s.envois.filter((e: any) => e.canal === 'sms')).toHaveLength(0);
    expect(journalDe(s, 'send_sms')[0].result_data).toEqual({ saute: 'Client désabonné (texto)' });
  });

  it('demande d\'avis vers un client désabonné des deux canaux : sautée, pas un échec', async () => {
    const s: any = await jouer(
      { id: 'r-avis', trigger_event: 'job.completed', delay_seconds: 0, actions: [{ type: 'request_review', config: { body: 'Un avis ?' } }] },
      evenementPour('job.completed'), etat.e, { ...DRAPEAU_ON, ...STOP_TEXTO, ...STOP_COURRIEL },
    );
    expect(s.envois.filter((e: any) => e.canal === 'sms' || e.canal === 'courriel')).toHaveLength(0);
    const [log] = journalDe(s, 'request_review');
    expect(log.result_success).toBe(true);
    expect(log.result_data.saute).toContain('Client désabonné');
  });
});

describe('moteur — drapeau OFF : comportement d\'avant', () => {
  it('relance vers un désabonné du texto : échec comme avant (pas de saut)', async () => {
    const s: any = await jouer(
      { id: 'r-off', trigger_event: 'quote.sent', delay_seconds: 86400, actions: [{ type: 'send_sms', config: { body: 'Relance' } }] },
      evenementPour('quote.sent'), etat.e, { ...STOP_TEXTO },
    );
    const [log] = journalDe(s, 'send_sms');
    expect(log.result_success).toBe(false);
    expect(log.result_error).toMatch(/opted out of SMS/);
  });

  it('rappel de rendez-vous vers un désabonné du texto : bloqué comme avant', async () => {
    const s: any = await jouer(
      { id: 'r-off2', trigger_event: 'appointment.created', delay_seconds: -86400, actions: [{ type: 'send_sms', config: { body: 'Rappel' } }] },
      evenementPour('appointment.created'), etat.e, { ...STOP_TEXTO },
    );
    expect(s.envois.filter((e: any) => e.canal === 'sms')).toHaveLength(0);
  });
});

// ── 5. Page de préférences ──────────────────────────────────

describe('page de préférences par jeton', () => {
  const TOKEN = 'a'.repeat(64);
  let base = '';
  let serveur: import('node:http').Server;
  let journal: any[] = [];
  let lignes: Record<string, any> = {};

  const brancher = (drapeau: boolean, langue: 'fr' | 'en' = 'fr') => {
    const r = clientEnregistreur({
      email_unsubscribes: (req) => (req.op === 'select' && req.filtres.some(([, c]) => c === 'token')
        ? { data: [{ id: 'uns-1', org_id: ORG, email: 'marie.tremblay@example.test', category: 'pending' }] }
        : { data: lignes.email_unsubscribes ?? [] }),
      org_features: { data: drapeau ? [{ feature: 'auto_desabonnement_canal', enabled: true }] : [] },
      clients: { data: [{ id: IDS.client, phone: '+15145550142' }] },
      sms_opt_outs: { data: lignes.sms_opt_outs ?? [] },
      company_settings: { data: [{ company_name: 'Plomberie Tremblay inc.', default_language: langue }] },
    });
    journal = r.journal;
    Object.defineProperty(etat.client, 'current', { get: () => r.client, configurable: true });
  };

  beforeAll(async () => {
    const express = (await import('express')).default;
    const routeur = (await import('../../server/routes/unsubscribe')).default;
    const app = express();
    app.use(express.urlencoded({ extended: false }));
    app.use('/api', routeur);
    await new Promise<void>((ok) => { serveur = app.listen(0, '127.0.0.1', () => ok()); });
    base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  });
  afterAll(() => { serveur?.close(); });
  beforeEach(() => { lignes = {}; oublierDrapeaux(); });

  it('drapeau ON : le lien AFFICHE le choix sans rien désabonner', async () => {
    brancher(true);
    const r = await fetch(`${base}/api/unsubscribe/${TOKEN}`);
    const html = await r.text();
    expect(r.status).toBe(200);
    expect(html).toContain('Ne plus recevoir de courriels promotionnels');
    expect(html).toContain('Ne plus recevoir de textos promotionnels');
    expect(html).toContain('continueront de vous être envoyés');
    expect(journal.filter((q) => q.op === 'update' || q.op === 'insert')).toHaveLength(0);
  });

  it('drapeau ON : cocher « texto » seulement → retrait texto, courriel intact, journalisé', async () => {
    brancher(true);
    const r = await fetch(`${base}/api/unsubscribe/${TOKEN}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'choix=1&texto=on',
    });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('Vos choix sont enregistrés');
    expect(requetes(journal, 'sms_opt_outs', 'insert')[0].valeur).toMatchObject({ org_id: ORG, phone: '+15145550142' });
    expect(requetes(journal, 'email_unsubscribes', 'update')).toHaveLength(0);
    expect((requetes(journal, 'rpc:record_consent', 'rpc')[0].valeur as any)).toMatchObject({ p_purpose: 'sms-marketing', p_granted: false, p_org_id: ORG });
  });

  it('drapeau ON, entreprise anglophone : la page est en anglais', async () => {
    brancher(true, 'en');
    const html = await (await fetch(`${base}/api/unsubscribe/${TOKEN}`)).text();
    expect(html).toContain('Stop promotional emails');
    expect(html).toContain('Stop promotional texts');
    expect(html).toContain('will still be sent');
    expect(html).toContain('lang="en"');
  });

  it('drapeau ON : le bouton natif de la messagerie (POST sans formulaire) désabonne du courriel en un clic', async () => {
    brancher(true);
    const r = await fetch(`${base}/api/unsubscribe/${TOKEN}`, { method: 'POST' });
    expect(await r.json()).toEqual({ ok: true });
    expect(requetes(journal, 'email_unsubscribes', 'update')[0].valeur).toMatchObject({ category: 'all' });
    expect(requetes(journal, 'sms_opt_outs', 'insert')).toHaveLength(0);
  });

  it('drapeau OFF : le lien désabonne du courriel en un clic, comme avant', async () => {
    brancher(false);
    const r = await fetch(`${base}/api/unsubscribe/${TOKEN}`);
    expect(await r.text()).toContain('Désinscription confirmée');
    expect(requetes(journal, 'email_unsubscribes', 'update')[0].valeur).toMatchObject({ category: 'all' });
  });
});

// Le monde du banc est bien celui du filet (garde-fou contre une dérive silencieuse).
it('le banc partagé expose le même monde', () => {
  expect(monde({ id: 'x', trigger_event: 'quote.sent' }).clients.data[0].id).toBe(IDS.client);
});
