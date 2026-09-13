/**
 * Trace unifiée des agents (lumi_traces) — item 1 du plan AGENTFORCE_GAP.md.
 * Tout est pur ou simulé : aucune base, aucun appel réseau.
 *
 * Ce que ces tests figent :
 * - la trace ne bloque jamais un tour (jamais d'exception, table absente = un
 *   seul avertissement) ;
 * - org_id / user_id viennent du contexte serveur, jamais du corps ;
 * - les tokens Anthropic sont agrégés avec le détail 5 min / 1 h, ceux de
 *   Gemini lus dans usageMetadata, et aucun coût n'est inventé (NULL) ;
 * - le schéma de /lumi/chat accepte `origine` mais refuse toute autre valeur ;
 * - la migration existe dans le dépôt mais n'est PAS appliquée par ce code
 *   (R9) : rien ici ne touche la base.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

vi.mock('../server/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { logger } from '../server/lib/logger';
import { journaliserTrace, ajouterUsage, usageVide, usageGemini, normaliserEnonce, reinitialiserTraces, ETAGE, ORIGINES_TRACE } from '../server/lib/lumi/traces';
import { usageDeReponseGemini } from '../server/lib/agent/gemini';

function adminSimule(reponse: { error: { code?: string; message: string } | null } | Error) {
  const insert = vi.fn(async () => { if (reponse instanceof Error) throw reponse; return reponse; });
  return { client: { from: vi.fn(() => ({ insert })) } as any, insert };
}

beforeEach(() => { reinitialiserTraces(); vi.clearAllMocks(); });

describe('journaliserTrace : jamais bloquante, toujours le contexte serveur', () => {
  it('écrit une ligne complète, org et user tels que fournis par le serveur, coût NULL quand inconnu', async () => {
    const { client, insert } = adminSimule({ error: null });
    await journaliserTrace(client, {
      orgId: 'org-1', userId: 'user-1', conversationId: 'conv-1', canal: 'lumi', origine: 'suggestion',
      enonce: 'Quelles factures sont en retard ?', etage: ETAGE.raccourci, action: 'retards', outils: ['get_overdue_payments'],
      resultat: 'ok', usage: { input_tokens: 10, cache_5m: 20, cache_1h: 30, cache_lu: 40, output_tokens: 50 }, costCents: 0.42, dureeMs: 712,
    });
    expect(client.from).toHaveBeenCalledWith('lumi_traces');
    expect(insert).toHaveBeenCalledWith({
      org_id: 'org-1', user_id: 'user-1', conversation_id: 'conv-1', canal: 'lumi', origine: 'suggestion',
      enonce_normalise: 'quelles factures sont en retard', etage: 2, topic: null, action: 'retards', params: null,
      outils: ['get_overdue_payments'], resultat: 'ok', model: null, prompt_version: null,
      input_tokens: 10, cache_5m: 20, cache_1h: 30, cache_lu: 40, output_tokens: 50, cost_cents: 0.42, duree_ms: 712,
    });
    const { client: c2, insert: i2 } = adminSimule({ error: null });
    await journaliserTrace(c2, { orgId: null, userId: null, canal: 'public', origine: 'texte', resultat: 'ok', costCents: null });
    expect((i2.mock.calls as unknown as any[][])[0][0]).toMatchObject({ org_id: null, user_id: null, cost_cents: null, input_tokens: 0, outils: [], etage: null });
  });

  it('table absente (migration non appliquée) : un seul avertissement, aucune exception', async () => {
    const { client } = adminSimule({ error: { code: '42P01', message: 'relation "public.lumi_traces" does not exist' } });
    await expect(journaliserTrace(client, { orgId: 'o', userId: 'u', canal: 'lumi', origine: 'texte', resultat: 'ok' })).resolves.toBeUndefined();
    await journaliserTrace(client, { orgId: 'o', userId: 'u', canal: 'lumi', origine: 'texte', resultat: 'ok' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(logger.warn).mock.calls[0]?.[0])).toContain('20260913000000_lumi_traces.sql');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('autre erreur ou exception : journalisée en erreur, jamais relancée', async () => {
    const { client } = adminSimule({ error: { code: '23514', message: 'check constraint' } });
    await expect(journaliserTrace(client, { orgId: 'o', userId: 'u', canal: 'lumi', origine: 'texte', resultat: 'ok' })).resolves.toBeUndefined();
    const { client: c2 } = adminSimule(new Error('réseau'));
    await expect(journaliserTrace(c2, { orgId: 'o', userId: 'u', canal: 'lumi', origine: 'texte', resultat: 'ok' })).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(2);
  });
});

describe('agrégation des tokens', () => {
  it('Anthropic : détail 5 min / 1 h quand il est là, sinon tout en 1 h (le TTL des points de cache)', () => {
    let u = ajouterUsage(usageVide(), { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 500, cache_read_input_tokens: 6000, cache_creation: { ephemeral_5m_input_tokens: 120, ephemeral_1h_input_tokens: 380 } });
    u = ajouterUsage(u, { input_tokens: 50, output_tokens: 30, cache_creation_input_tokens: 200, cache_read_input_tokens: 6500 });
    expect(u).toEqual({ input_tokens: 150, cache_5m: 120, cache_1h: 580, cache_lu: 12500, output_tokens: 50 });
  });

  it('Gemini : cache lue séparée de l entrée, réflexion comptée en sortie, absent = null (rien d inventé)', () => {
    expect(usageGemini({ promptTokenCount: 2400, candidatesTokenCount: 90, cachedContentTokenCount: 2000, thoughtsTokenCount: 15 }))
      .toEqual({ input_tokens: 400, cache_5m: 0, cache_1h: 0, cache_lu: 2000, output_tokens: 105 });
    expect(usageGemini(null)).toBeNull();
    expect(usageDeReponseGemini({ candidates: [] })).toBeNull();
    expect(usageDeReponseGemini({ usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 'x', totalTokenCount: 15 } }))
      .toEqual({ promptTokenCount: 12, candidatesTokenCount: undefined, cachedContentTokenCount: undefined, thoughtsTokenCount: undefined, totalTokenCount: 15 });
  });

  it('énoncé normalisé : minuscules, sans accents ni ponctuation, borné à 200 caractères, null si vide', () => {
    expect(normaliserEnonce("Qu'est-ce que j’ai demain ?")).toBe('qu est ce que j ai demain');
    expect(normaliserEnonce('   ')).toBeNull();
    expect(normaliserEnonce(null)).toBeNull();
    expect(normaliserEnonce('a'.repeat(500))!.length).toBe(200);
  });
});

describe('contrat avec le reste du code', () => {
  it('les origines acceptées par la route sont celles de la migration', () => {
    const sql = readFileSync(path.join(__dirname, '../supabase/migrations/20260913000000_lumi_traces.sql'), 'utf8');
    for (const o of ORIGINES_TRACE) expect(sql).toContain(`'${o}'`);
    expect(sql).toContain("check (etage between 0 and 6)");
    // Non appliquée par le code : aucun appel db:apply, aucune exécution SQL dans le module de trace.
    const module = readFileSync(path.join(__dirname, '../server/lib/lumi/traces.ts'), 'utf8');
    expect(module).not.toMatch(/create table|db:apply|\.rpc\(/i);
  });

  it('la route /lumi/chat borne `origine` à la liste connue (Zod) et le client n envoie que des valeurs de cette liste', () => {
    const route = readFileSync(path.join(__dirname, '../server/routes/lumi.ts'), 'utf8');
    expect(route).toContain('origine: z.enum(ORIGINES_TRACE');
    const page = readFileSync(path.join(__dirname, '../src/pages/Lumi.tsx'), 'utf8');
    for (const o of page.matchAll(/origine: '([a-z]+)'/g)) expect(ORIGINES_TRACE).toContain(o[1]);
    // Les suggestions et le bouton Réessayer sont marqués : c'est ce qui rend l'étage 0 mesurable.
    expect(page).toContain("origine: 'suggestion'"); // suggestions = actions d'étage 0 depuis l'item 5
    expect(page).toContain("{ origine: 'repli' }");
  });

  it('chaque chemin de tour écrit une trace : raccourci (étage 2), agent (étage 6), carte, transcription, agent public', () => {
    const route = readFileSync(path.join(__dirname, '../server/routes/lumi.ts'), 'utf8');
    expect(route).toContain('etage: ETAGE.raccourci');
    expect(route).toContain('etage: ETAGE.agent');
    expect(route).toContain("origine: 'carte'");
    expect(readFileSync(path.join(__dirname, '../server/routes/agent.ts'), 'utf8')).toContain("canal: 'transcription'");
    expect(readFileSync(path.join(__dirname, '../server/routes/sales-chat.ts'), 'utf8')).toContain("canal: 'public'");
    // Jamais org_id / user_id depuis le corps de la requête.
    expect(route).not.toMatch(/orgId:\s*req\.body/);
    expect(readFileSync(path.join(__dirname, '../server/routes/sales-chat.ts'), 'utf8')).toContain('orgId: null, userId: null');
  });
});
