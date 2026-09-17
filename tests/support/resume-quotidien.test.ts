/**
 * Résumé quotidien du support : un message par jour dans le canal central,
 * une ligne par conversation de la veille. Pur, sans Slack ni base.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bornesVeille, composerResume, doitEnvoyerMaintenant, dejaEnvoye, enTeteResume, sortDuTicket, type TicketResume } from '../../server/lib/support/resume-quotidien';

const T = new Date('2026-09-17T11:05:00Z'); // 7 h 05 à Montréal
const base: TicketResume = { id: 't1', company_name: 'Coquin lavage', user_name: 'William Hébert', subject: 'Supprimer des tâches', status: 'ai', created_at: '2026-09-16T14:00:00Z', last_message_at: '2026-09-16T14:05:00Z', escalated_at: null, closed_at: null, slack_channel_id: null, slack_thread_ts: null };

describe('résumé quotidien', () => {
  it('la veille est calée sur Montréal', () => {
    const b = bornesVeille(T);
    expect(b.jour).toBe('2026-09-16');
    expect(b.debut).toBe('2026-09-16T04:00:00.000Z');
    expect(b.fin).toBe('2026-09-17T04:00:00.000Z');
  });
  it('n envoie qu à 7 h locales, dans la première tranche de dix minutes', () => {
    expect(doitEnvoyerMaintenant(T)).toBe(true);
    expect(doitEnvoyerMaintenant(new Date('2026-09-17T11:15:00Z'))).toBe(false);
    expect(doitEnvoyerMaintenant(new Date('2026-09-17T15:05:00Z'))).toBe(false);
  });
  it('compose une ligne par conversation, avec le sort et les extraits pour celles réglées par Lumi', () => {
    const escalade = { ...base, id: 't2', user_name: 'Marie', subject: 'Facture en double', escalated_at: '2026-09-16T15:00:00Z', slack_channel_id: 'C1', slack_thread_ts: '1758030000.000100', last_message_at: '2026-09-16T15:30:00Z' };
    const fermee = { ...base, id: 't3', subject: 'Question réglée', closed_at: '2026-09-16T16:00:00Z', last_message_at: '2026-09-16T16:00:00Z' };
    const messages = [
      { ticket_id: 't1', author: 'client', body: 'Comment je supprime une tâche ?', created_at: '2026-09-16T14:00:00Z' },
      { ticket_id: 't1', author: 'lumi', body: 'Ouvre la tâche, menu ⋯ en haut à droite, puis « Supprimer ». Pour un job, Jobs → le job → Archiver.', created_at: '2026-09-16T14:05:00Z' },
      { ticket_id: 't2', author: 'client', body: 'J’ai deux factures identiques', created_at: '2026-09-16T15:00:00Z' },
    ];
    const texte = composerResume('2026-09-16', '2026-09-17T04:00:00.000Z', [base, escalade, fermee], messages)!;
    expect(texte.startsWith('*Support — Mercredi 16 septembre* : 3 conversations · 1 réglée par Lumi · 1 escaladée · 1 fermée')).toBe(true);
    expect(texte).toContain('• *Coquin lavage* · William Hébert · « Supprimer des tâches » · 2 messages · réglée par Lumi');
    expect(texte).toContain('↳ client : « Comment je supprime une tâche ? »');
    expect(texte).toContain('↳ Lumi : « Ouvre la tâche, menu ⋯');
    expect(texte).toContain('· escaladée · <https://slack.com/archives/C1/p1758030000000100|fil>');
    expect(texte).toContain('· fermée');
    expect(sortDuTicket(escalade, '2026-09-17T04:00:00.000Z')).toBe('escalade');
  });
  it('rien la veille → rien à envoyer ; déjà envoyé → on saute', () => {
    expect(composerResume('2026-09-16', '2026-09-17T04:00:00.000Z', [], [])).toBeNull();
    expect(dejaEnvoye([{ text: `*${enTeteResume('2026-09-16')}* : 3 conversations` }], '2026-09-16')).toBe(true);
    expect(dejaEnvoye([{ text: 'autre chose' }], '2026-09-16')).toBe(false);
  });
  it('est armé au démarrage du serveur, vers le canal central seulement', () => {
    const idx = readFileSync(resolve(__dirname, '..', '..', 'server', 'index.ts'), 'utf8');
    expect(idx).toContain('demarrerResumeQuotidien');
    const src = readFileSync(resolve(__dirname, '..', '..', 'server', 'lib', 'support', 'resume-quotidien.ts'), 'utf8');
    expect(src).toContain('process.env.SLACK_SUPPORT_CHANNEL_ID!');
    expect(src).not.toContain('support_slack_channels');
  });
});
