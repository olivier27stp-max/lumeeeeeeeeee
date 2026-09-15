/** La conversation complète postée dans Slack : rien de coupé, découpée en morceaux ≤ 3 500 caractères. */
import { describe, it, expect, vi } from 'vitest';
vi.mock('../../server/lib/mailer', () => ({ isMailerConfigured: () => false, sendEmail: vi.fn() }));
vi.mock('../../server/lib/helpers', () => ({ resolvePublicBaseUrl: () => 'https://lumecrm.net', normalizeE164: (s: string) => s, findOrCreateConversation: async () => ({ id: 'c' }) }));
import { transcriptSlackComplet, transcriptTexte, type MessageTicket, type Ticket } from '../../server/lib/support/tickets';

const m = (author: MessageTicket['author'], body: string, i: number): MessageTicket => ({ id: `m${i}`, ticket_id: 't', author, author_name: author === 'user' ? 'Marie' : author === 'agent' ? 'Rafba' : null, body, created_at: `2026-09-15T10:${String(i).padStart(2, '0')}:00Z` });

describe('transcriptSlackComplet', () => {
  it('garde tous les messages et tout leur texte, ignore les lignes système', () => {
    const messages = [m('user', 'Q1', 1), m('ai', 'R1', 2), m('system', 'escalated:slack', 3), ...Array.from({ length: 30 }, (_, i) => m('user', `message ${i}`, 10 + i))];
    const morceaux = transcriptSlackComplet(messages);
    const tout = morceaux.join('\n\n');
    expect(tout).toContain('Q1');
    expect(tout).toContain('message 29');
    expect(tout).not.toContain('escalated');
    expect(tout).toMatch(/👤 Marie/);
    expect(tout).toMatch(/🤖 Assistant/);
  });
  it('découpe sans jamais dépasser la taille max, un long message est tranché', () => {
    const messages = [m('user', 'a'.repeat(3000), 1), m('ai', 'b'.repeat(3000), 2), m('user', 'c'.repeat(8000), 3)];
    const morceaux = transcriptSlackComplet(messages, 3500);
    expect(morceaux.length).toBeGreaterThanOrEqual(4);
    for (const p of morceaux) expect(p.length).toBeLessThanOrEqual(3500);
    expect(morceaux.join('').replace(/[^c]/g, '').length).toBe(8000);
  });
  it('transcriptTexte : en-tête + messages horodatés', () => {
    const t = { company_name: 'Plomberie T', subject: 'Facture', user_name: 'Marie', user_email: 'm@x.test', created_at: '2026-09-15T10:00:00Z' } as Ticket;
    const txt = transcriptTexte(t, [m('user', 'Bonjour', 1), m('agent', 'Salut', 2)]);
    expect(txt).toContain('Conversation de support — Plomberie T');
    expect(txt).toContain('[2026-09-15 10:01] 👤 Marie\nBonjour');
    expect(txt).toContain('🧑‍💼 Rafba\nSalut');
  });
});
