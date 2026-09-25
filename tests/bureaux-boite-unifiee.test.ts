/**
 * Bureaux — phase 3 : boîte de réception unifiée (2026-09-25). Preuve de bout
 * en bout contre staging : scripts/qa/bureaux-boite-unifiee.mts (14/14).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bureauxMemeEntreprise } from '../server/lib/boite-unifiee';

const lire = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');
const org = (id: string, groupe: string | null, jour: string, supprime = false) =>
  ({ id, name: id, created_at: `2026-01-${jour}`, deleted_at: supprime ? '2026-02-01' : null, company_group_id: groupe });

describe('bureauxMemeEntreprise', () => {
  it('garde le bureau actif et ceux de la même entreprise, du plus ancien au plus récent', () => {
    const r = bureauxMemeEntreprise('a', 'g1', [org('b', 'g1', '03'), org('x', 'g2', '01'), org('a', 'g1', '02')]);
    expect(r.map((o) => o.id)).toEqual(['a', 'b']);
  });
  it('ignore un bureau supprimé', () => {
    expect(bureauxMemeEntreprise('a', 'g1', [org('a', 'g1', '01'), org('b', 'g1', '02', true)]).map((o) => o.id)).toEqual(['a']);
  });
  it('sans entreprise connue : le bureau actif seulement', () => {
    expect(bureauxMemeEntreprise('a', null, [org('a', null, '01'), org('b', null, '02')]).map((o) => o.id)).toEqual(['a']);
  });
});

describe('droits', () => {
  it('chaque route de la boîte exige messages.read (dans le bureau de l’en-tête)', () => {
    const r = lire('server/lib/route-permissions.ts');
    expect(r).toContain("'GET /api/messages/inbox': 'messages.read'");
    expect(r).toContain("'GET /api/messages/conversations/:id/messages': 'messages.read'");
    expect(r).toContain("'POST /api/messages/conversations/:id/read': 'messages.read'");
  });
  it('un bureau n’entre dans la boîte qu’avec messages.read dans CE bureau', () => {
    const s = lire('server/lib/boite-unifiee.ts');
    expect(s).toContain("hasPermission(ctx, 'messages.read')");
    expect(s).toContain('buildSupabaseWithAuth(authorization, b.org_id)');
  });
});

describe('page Messages', () => {
  it('fil, « lu » et réponse passent par le bureau DE LA CONVERSATION', () => {
    const p = lire('src/pages/Messages.tsx');
    expect(p).toContain('fetchMessages(selectedConvo.id, selectedConvo.org_id)');
    expect(p).toContain('markConversationRead(selectedConvo.id, selectedConvo.org_id)');
    expect(p).toContain('}, selectedConvo.org_id);');
    expect(lire('src/lib/messagingApi.ts')).toContain("...(bureau ? { 'x-org-id': bureau } : {})");
  });
});
