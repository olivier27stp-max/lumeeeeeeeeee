/**
 * File de reprise des courriels de fond (server/lib/courriels/reprises.ts).
 * Règles pures (backoff, statuts) + gardes statiques : la reprise est opt-in,
 * réservée aux envois de fond, jamais sur un envoi déclenché par un clic.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  delaiAvantTentative, planifierPremiereReprise, apresEchec, apresSucces, estAReprendre, courrielAbandon,
  DELAIS_REPRISE_MS, MAX_TENTATIVES, CADENCE_REPRISES_MS, TABLE_REPRISES,
} from '../../server/lib/courriels/reprises';

const root = resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const T0 = new Date('2026-09-17T12:00:00.000Z');
const plus = (ms: number) => new Date(T0.getTime() + ms).toISOString();

describe('backoff : 5 min, 30 min, 3 h', () => {
  it('les délais sont ceux annoncés', () => {
    expect(DELAIS_REPRISE_MS).toEqual([5 * 60_000, 30 * 60_000, 3 * 3_600_000]);
    expect(MAX_TENTATIVES).toBe(3);
    expect(CADENCE_REPRISES_MS).toBe(5 * 60_000);
  });
  it('délai selon les tentatives déjà faites, borné au dernier', () => {
    expect(delaiAvantTentative(0)).toBe(5 * 60_000);
    expect(delaiAvantTentative(1)).toBe(30 * 60_000);
    expect(delaiAvantTentative(2)).toBe(3 * 3_600_000);
    expect(delaiAvantTentative(9)).toBe(3 * 3_600_000);
    expect(delaiAvantTentative(-1)).toBe(5 * 60_000);
  });
  it('la première ligne (échec initial du mailer) attend 5 min, attempts 0, pending', () => {
    expect(planifierPremiereReprise(T0)).toEqual({ attempts: 0, next_attempt_at: plus(5 * 60_000), status: 'pending' });
  });
});

describe('statuts après une tentative du cron', () => {
  it('1er échec → attempts 1, reprise dans 30 min', () => {
    expect(apresEchec(0, T0, 'Resend 500')).toEqual({ attempts: 1, next_attempt_at: plus(30 * 60_000), status: 'pending', last_error: 'Resend 500' });
  });
  it('2e échec → attempts 2, reprise dans 3 h', () => {
    expect(apresEchec(1, T0, 'ECONNRESET')).toEqual({ attempts: 2, next_attempt_at: plus(3 * 3_600_000), status: 'pending', last_error: 'ECONNRESET' });
  });
  it('3e échec → dead, plus de créneau', () => {
    expect(apresEchec(2, T0, 'x')).toEqual({ attempts: 3, next_attempt_at: null, status: 'dead', last_error: 'x' });
  });
  it('l’erreur est tronquée à 1000 caractères', () => {
    expect(apresEchec(0, T0, 'e'.repeat(5000)).last_error).toHaveLength(1000);
  });
  it('succès → sent, compteur incrémenté, erreur effacée', () => {
    expect(apresSucces(1)).toEqual({ attempts: 2, status: 'sent', last_error: null });
  });
  it('estAReprendre : pending et échéance passée seulement', () => {
    expect(estAReprendre({ status: 'pending', next_attempt_at: plus(-1) }, T0)).toBe(true);
    expect(estAReprendre({ status: 'pending', next_attempt_at: plus(0) }, T0)).toBe(true);
    expect(estAReprendre({ status: 'pending', next_attempt_at: plus(1) }, T0)).toBe(false);
    expect(estAReprendre({ status: 'sent', next_attempt_at: plus(-1) }, T0)).toBe(false);
    expect(estAReprendre({ status: 'dead', next_attempt_at: plus(-1) }, T0)).toBe(false);
  });
});

describe('alerte à l’exploitant quand une ligne meurt', () => {
  const c = courrielAbandon({ to_emails: ['client@exemple.com'], subject: 'Rappel de paiement — facture 40', last_error: 'Resend 503: unavailable', attempts: 3, org_id: 'org-1' });
  it('voix Lume interne : destinataire, sujet, erreur, sans signature d’équipe', () => {
    expect(c.sujet).toContain('Courriel abandonné après 3 reprises');
    expect(c.html).toContain('client@exemple.com');
    expect(c.html).toContain('Rappel de paiement — facture 40');
    expect(c.html).toContain('Resend 503: unavailable');
    expect(c.html).toContain('org-1');
    expect(c.html).not.toContain('L’équipe Lume');
  });
});

describe('gardes statiques — opt-in, envois de fond seulement', () => {
  const mailer = read('server/lib/mailer.ts');

  it('sendEmail ne met en file que sur reessayer, et le dit dans le résultat', () => {
    const params = mailer.slice(mailer.indexOf('export interface SendEmailParams'), mailer.indexOf('export interface SendEmailResult'));
    expect(params).toMatch(/reessayer\?: boolean/);
    expect(mailer).toContain('if (params.reessayer && await mettreEnFile(');
    expect(mailer).toContain('return { sent: false, error: err.message, enFile: true }');
    // Le contrat d'origine survit : sans reessayer, {sent:false, error}.
    expect(mailer).toContain('return { sent: false, error: err.message };');
    expect(mailer).toContain(`from(TABLE_REPRISES)`);
    expect(TABLE_REPRISES).toBe('email_retry_queue');
  });

  it('les envois déclenchés par un clic ne passent JAMAIS par la file (doublons)', () => {
    for (const f of ['server/routes/emails.ts', 'server/routes/agreements.ts']) {
      expect(read(f), `${f} ne doit pas porter reessayer: true`).not.toMatch(/reessayer:\s*true/);
    }
  });

  it('les envois de fond, eux, la demandent', () => {
    for (const f of [
      'server/routes/reminders-cron.ts',
      'server/lib/subscription-email.ts',
      'server/lib/paiement-recu.ts',
      'server/lib/scheduled-reports.ts',
    ]) {
      expect(read(f), `${f} devrait porter reessayer: true`).toMatch(/reessayer:\s*true/);
    }
    const tickets = read('server/lib/support/tickets.ts');
    const fn = tickets.slice(tickets.indexOf('export async function notifierClientReponse'));
    expect(fn).toMatch(/reessayer:\s*true/);
  });

  it('le cron est branché dans server/index.ts, sous verrou, et la reprise n’enfile pas à nouveau', () => {
    expect(read('server/index.ts')).toContain("import('./lib/courriels/reprises')");
    expect(read('server/index.ts')).toContain('demarrerReprisesCourriels(serviceClient)');
    const reprises = read('server/lib/courriels/reprises.ts');
    expect(reprises).toContain("withAdvisoryLock('email-retry'");
    expect(reprises).toContain('reessayer: false');
    expect(reprises).toContain("logger.error('[courriels/reprises] courriel abandonné");
    expect(reprises).not.toMatch(/console\.log/);
  });

  it('la migration crée la table, serveur seul', () => {
    const sql = read('supabase/migrations/20260917150000_email_retry_queue.sql');
    expect(sql).toContain('create table if not exists public.email_retry_queue');
    expect(sql).toContain("check (status in ('pending', 'sent', 'dead'))");
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('force row level security');
    expect(sql).toContain('revoke all on public.email_retry_queue from anon');
    expect(sql).toContain('revoke all on public.email_retry_queue from authenticated');
    expect(sql).not.toMatch(/grant\s+\w+\s+on\s+public\.email_retry_queue\s+to\s+(anon|authenticated)/);
  });
});
