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
    const brut = appels[0].system;
    const systeme: string = Array.isArray(brut) ? brut.map((b: any) => b.text).join('\n') : brut;
    // Partie stable (identité, règles, FAQ) en cache 1 h ; le dossier du client vient après, hors cache.
    expect(Array.isArray(brut) && brut[0].cache_control?.type).toBe('ephemeral');
    expect(systeme).toContain('Plomberie Tremblay');
    expect(systeme).toContain('Scale');
    expect(systeme).toContain('1 jour ouvrable');
    expect(systeme).toContain('Comment transformer un devis en facture ?');
    expect(systeme).toMatch(/transfer_to_human/);
    expect(appels[0].model).toBe('claude-sonnet-5');
    expect(appels[0].tools.map((t: any) => t.name)).toEqual(['search_help', 'transfer_to_human']);
  });
  it('le même Lumi partout : le dossier du client entre dans le prompt, les outils migration n’apparaissent que si la surface les fournit', async () => {
    await repondreSupportIA({ ...contexte, surface: 'app', dossier: 'Abonnement : forfait Scale, statut active.\nMigration de données (depuis jobber) : import test concluant, en attente de l\'approbation.' }, [], 'Où en est ma migration ?', { statutMigration: async () => 'Migration depuis jobber : en attente de l\'approbation.', demarrerMigration: async () => ({ ok: true, lien: 'https://x/migration/invite/t', expire: '2026-09-18' }) });
    const systeme: string = appels[0].system.map((b: any) => b.text).join('\n');
    expect(systeme).toContain('THE SAME assistant everywhere');
    expect(systeme).toContain('DOSSIER');
    expect(systeme).toContain('import test concluant');
    expect(appels[0].tools.map((t: any) => t.name)).toEqual(['search_help', 'transfer_to_human', 'get_migration_status', 'start_migration']);
  });
  it('surface publique : visiteur sans compte, pas de dossier ni de transfert, connaissance du site (prix, démo), tutoiement', async () => {
    await repondreSupportIA({ langue: 'fr', companyName: '', planLabel: '', userName: 'visiteur', slaTexte: '', surface: 'public', dossier: null }, [], 'C’est combien ?');
    const systeme: string = appels[0].system.map((b: any) => b.text).join('\n');
    expect(systeme).toContain('150 $/mois');
    expect(systeme).toContain('VISITEUR');
    expect(systeme).not.toContain('DOSSIER');
    expect(appels[0].tools.map((t: any) => t.name)).toEqual(['search_help']);
  });
  it('start_migration : le lien du portail revient au modèle, une migration existante refuse d’en créer une autre', async () => {
    scenario = [
      { content: [{ type: 'tool_use', id: 'tu1', name: 'start_migration', input: { source_crm: 'jobber' } }], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'Voici votre lien.' }], stop_reason: 'end_turn' },
    ];
    const r = await repondreSupportIA({ ...contexte, surface: 'app', dossier: '' }, [], 'Je veux importer mes clients de Jobber', { demarrerMigration: async ({ sourceCrm }) => ({ ok: true, lien: `https://x/migration/invite/${sourceCrm}`, expire: '2026-09-18' }) });
    expect(r.transferer).toBe(false);
    expect(r.outils).toEqual(['start_migration']);
    const resultat = appels[1].messages.at(-1).content[0];
    expect(resultat.is_error).toBe(false);
    expect(resultat.content).toContain('https://x/migration/invite/jobber');
  });
});
