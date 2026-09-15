/**
 * Assistant de support (premier niveau) — le contrat, sans appeler Claude.
 *
 *   - une question « comment faire » → cherche dans l'aide (search_help) puis répond, sans transfert
 *   - « je veux parler à quelqu'un » → l'outil transfer_to_human est honoré : transferer = true, motif conservé
 *   - refus du modèle → transfert
 *   - réponse vide → transfert avec une phrase de repli dans la langue du client
 *   - le prompt système porte la FAQ, l'entreprise, le forfait et le délai promis
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const appels: any[] = [];
let scenario: Array<{ content: any[]; stop_reason: string }> = [];
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async (params: any) => {
        appels.push(params);
        const r = scenario.shift() || { content: [{ type: 'text', text: 'Réponse.' }], stop_reason: 'end_turn' };
        return { ...r, usage: { input_tokens: 100, output_tokens: 20 } };
      },
    };
  },
}));

import { repondreSupportIA } from '../../server/lib/support/ia';

const contexte = { langue: 'fr' as const, companyName: 'Plomberie Tremblay', planLabel: 'Scale', userName: 'Marie', slaTexte: '1 jour ouvrable' };
beforeEach(() => { appels.length = 0; scenario = []; process.env.ANTHROPIC_API_KEY = 'test'; });

describe('assistant de support', () => {
  it('question « comment faire » : outil search_help puis réponse, pas de transfert', async () => {
    scenario = [
      { content: [{ type: 'tool_use', id: 'tu1', name: 'search_help', input: { query: 'importer mes clients' } }], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'Depuis la page Clients, utilisez l’import CSV.' }], stop_reason: 'end_turn' },
    ];
    const r = await repondreSupportIA(contexte, [], 'Comment j’importe mes clients ?');
    expect(r.transferer).toBe(false);
    expect(r.texte).toContain('import CSV');
    // Le résultat de l'outil (passages de la doc) a bien été renvoyé au modèle.
    const second = appels[1];
    const resultat = second.messages.at(-1).content[0];
    expect(resultat.type).toBe('tool_result');
    expect(JSON.parse(resultat.content)).toHaveProperty('passages');
    expect(r.coutCents).toBeGreaterThan(0);
  });

  it('« je veux parler à quelqu’un » : transfer_to_human honoré, motif conservé', async () => {
    scenario = [
      { content: [{ type: 'text', text: 'Je vous passe à l’équipe.' }, { type: 'tool_use', id: 'tu1', name: 'transfer_to_human', input: { reason: 'Client demande un humain (facture en double)' } }], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'C’est fait, ils vous répondent ici.' }], stop_reason: 'end_turn' },
    ];
    const r = await repondreSupportIA(contexte, [{ role: 'user', content: 'Ma facture est en double' }, { role: 'assistant', content: 'Pouvez-vous préciser ?' }], 'Je veux parler à quelqu’un');
    expect(r.transferer).toBe(true);
    expect(r.motif).toBe('Client demande un humain (facture en double)');
    expect(r.texte).toContain('Je vous passe à l’équipe');
    // L'historique précède le message courant.
    expect(appels[0].messages.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('refus du modèle → transfert', async () => {
    scenario = [{ content: [{ type: 'text', text: '' }], stop_reason: 'refusal' }];
    const r = await repondreSupportIA(contexte, [], 'x');
    expect(r.transferer).toBe(true);
    expect(r.texte).toMatch(/équipe/);
  });

  it('réponse vide → transfert, phrase de repli en anglais pour un client anglophone', async () => {
    scenario = [{ content: [], stop_reason: 'end_turn' }];
    const r = await repondreSupportIA({ ...contexte, langue: 'en' }, [], 'x');
    expect(r.transferer).toBe(true);
    expect(r.texte).toMatch(/passing your request to our team/);
  });

  it('le prompt système ancre la réponse : FAQ, entreprise, forfait, délai, règles de transfert', async () => {
    await repondreSupportIA(contexte, [], 'Bonjour');
    const systeme: string = appels[0].system;
    expect(systeme).toContain('Plomberie Tremblay');
    expect(systeme).toContain('Scale');
    expect(systeme).toContain('1 jour ouvrable');
    expect(systeme).toContain('Comment transformer un devis en facture ?');
    expect(systeme).toMatch(/transfer_to_human/);
    expect(appels[0].model).toBe('claude-sonnet-5');
    expect(appels[0].tools.map((t: any) => t.name)).toEqual(['search_help', 'transfer_to_human']);
  });
});
