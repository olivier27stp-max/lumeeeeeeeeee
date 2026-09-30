/**
 * I — Les outils d'automatisation de Lumi, appelés par la VRAIE garde
 * (`executerOutilGarde` : permission de la page Rôles, validation des
 * arguments, idempotence) avec le JWT du propriétaire du bureau A, contre
 * staging. Aucun appel au modèle : le seul fournisseur remplacé est
 * Anthropic, par une réponse fixe — c'est ce qui rend déterministes les cas
 * « le modèle a inventé un déclencheur » ou « il a proposé une 2e
 * automatisation », impossibles à provoquer à coup sûr avec le vrai modèle.
 *
 * Le chemin complet avec le vrai modèle est éprouvé dans
 * 40-iklm-lumi-demandes.test.ts et 40-iklm-lumi-reglages.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/** Réponses que le « modèle » renverra, dans l'ordre ; et ce qu'il a reçu. */
const reponsesModele: string[] = [];
const appelsModele: Array<{ system: string; model: string }> = [];
vi.mock('../../../server/lib/lumi/llm', () => ({
  isLumiConfigured: () => true,
  reglagesClient: () => ({ maxRetries: 0, timeout: 10_000 }),
  clientAnthropic: () => ({
    messages: {
      create: async (p: { model: string; system: Array<{ text: string }> }) => {
        appelsModele.push({ system: p.system.map((s) => s.text).join('\n'), model: p.model });
        const texte = reponsesModele.shift() ?? '{}';
        return { content: [{ type: 'text', text: texte }], usage: { input_tokens: 10, output_tokens: 10 }, stop_reason: 'end_turn', model: p.model };
      },
    },
  }),
}));

import { demarrerMoteur, marque } from '../harnais/moteur';
import { sessionDe, COMPTES } from '../harnais/bureau-test';

let b: Awaited<ReturnType<typeof demarrerMoteur>>;
let client: import('@supabase/supabase-js').SupabaseClient;
const regles: string[] = [];

async function outil(name: string, args: Record<string, unknown>): Promise<Record<string, any>> {
  const { executerOutilGarde } = await import('../../../server/lib/agent/garde');
  const r = await executerOutilGarde({ name, args, userId: b.users.proprioA, orgId: b.orgA, client });
  if ('refus' in r) throw new Error(`refus : ${r.refus}`);
  return r.result as Record<string, any>;
}

async function reglesDepuis(depuis: string) {
  const { data } = await b.admin.from('automation_rules')
    .select('id, name, trigger_event, steps, settings, is_active')
    .eq('org_id', b.orgA).eq('is_preset', false).gte('created_at', depuis).order('created_at');
  for (const r of data ?? []) regles.push(r.id as string);
  return data ?? [];
}

const PARCOURS_SIMPLE = (trigger: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  nom: 'Relance', trigger_event: trigger, resume: 'J’ai fait une relance.', modifie: true,
  steps: [
    { id: 'e1', type: 'attendre', delai_secondes: 86400, suivant: 'e2' },
    { id: 'e2', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name], un petit suivi. [company_name]' } } },
  ],
  autre: null,
  ...extra,
});

beforeAll(async () => {
  b = await demarrerMoteur();
  const { jeton } = await sessionDe(b.admin, COMPTES.proprioA.email);
  const { buildSupabaseWithAuth } = await import('../../../server/lib/supabase');
  client = buildSupabaseWithAuth(`Bearer ${jeton}`, b.orgA);
  await b.admin.from('company_settings').update({ default_language: 'fr' }).eq('org_id', b.orgA);
});

afterAll(async () => {
  if (regles.length) await b.admin.from('automation_rules').delete().in('id', regles).eq('org_id', b.orgA);
  await b.admin.from('company_settings').update({ default_language: 'fr' }).eq('org_id', b.orgA);
});

describe('I — create_automation_from_text : les gardes de la route « Construire avec Lumi »', () => {
  it('[I-030] un déclencheur inventé par le modèle est REFUSÉ, rien n’est enregistré', async () => {
    const depuis = new Date().toISOString();
    reponsesModele.push(PARCOURS_SIMPLE('quote.relance_magique'));
    const r = await outil('create_automation_from_text', { description: `Relance mes soumissions ${marque('I-030')}` });
    expect(r.created, JSON.stringify(r)).not.toBe(true);
    expect(String(r.error ?? '')).toMatch(/déclencheur/i);
    expect(await reglesDepuis(depuis)).toEqual([]);
  });

  it('[I-031] une étape qui démarre une automatisation qui n’existe pas est REFUSÉE', async () => {
    const depuis = new Date().toISOString();
    reponsesModele.push(JSON.stringify({
      nom: 'Chaîne', trigger_event: 'quote.sent', resume: 'Relié.', modifie: true,
      steps: [{ id: 'e1', type: 'action', action: { type: 'demarrer_automatisation', config: { rule_id: '00000000-0000-4000-8000-000000000000' } } }],
      autre: null,
    }));
    const r = await outil('create_automation_from_text', { description: `Quand j’envoie une soumission, démarre l’autre ${marque('I-031')}` });
    expect(r.created, JSON.stringify(r)).not.toBe(true);
    expect(await reglesDepuis(depuis)).toEqual([]);
  });

  it('[I-032] la 2e automatisation proposée (autre déclencheur) est créée elle aussi, en pause, avec sa limite par client', async () => {
    const depuis = new Date().toISOString();
    reponsesModele.push(PARCOURS_SIMPLE('quote.sent', {
      autre: {
        nom: 'Réponse du client', trigger_event: 'client.replied', resume: 'Répond une fois par semaine.', une_fois_par_client_jours: 7, manque: null,
        steps: [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name], merci, on vous revient. https://exemple.lume-qa.test/rdv [company_name]' } } }],
      },
    }));
    const r = await outil('create_automation_from_text', { description: `Relance à 1 jour, et quand il répond envoie mon lien ${marque('I-032')}` });
    expect(r.created, JSON.stringify(r)).toBe(true);
    const crees = await reglesDepuis(depuis);
    expect(crees.map((x) => x.trigger_event).sort()).toEqual(['client.replied', 'quote.sent']);
    expect(crees.every((x) => x.is_active === false)).toBe(true);
    const reponse = crees.find((x) => x.trigger_event === 'client.replied')!;
    expect((reponse.settings as Record<string, unknown> | null)?.delai_entre_passages_jours).toBe(7);
  });

  it('[I-033] les messages sont écrits dans la langue des automatisations de l’entreprise (anglais → consignes anglaises)', async () => {
    await b.admin.from('company_settings').update({ default_language: 'en' }).eq('org_id', b.orgA);
    const avant = appelsModele.length;
    reponsesModele.push(PARCOURS_SIMPLE('quote.sent'));
    const r = await outil('create_automation_from_text', { description: `Follow up on my quotes after one day ${marque('I-033')}` });
    await b.admin.from('company_settings').update({ default_language: 'fr' }).eq('org_id', b.orgA);
    expect(r.created, JSON.stringify(r)).toBe(true);
    const systeme = appelsModele[avant]?.system ?? '';
    expect(systeme).toMatch(/l'entreprise travaille en ANGLAIS/);
    expect(systeme).toMatch(/Hi \[client_first_name\]/);
  });
});

describe('I — list_automations', () => {
  it('[I-034] une automatisation à la corbeille (ou supprimée définitivement) n’est PAS listée comme existante', async () => {
    const m = marque('I-034');
    const { data: rows } = await b.admin.from('automation_rules').insert([
      { org_id: b.orgA, name: `${m} corbeille`, trigger_event: 'quote.sent', conditions: {}, delay_seconds: 0, actions: [], is_active: false, deleted_at: new Date().toISOString() },
      { org_id: b.orgA, name: `${m} purgée`, trigger_event: 'quote.sent', conditions: {}, delay_seconds: 0, actions: [], is_active: false, deleted_at: new Date().toISOString(), purged_at: new Date().toISOString() },
      { org_id: b.orgA, name: `${m} vivante`, trigger_event: 'quote.sent', conditions: {}, delay_seconds: 0, actions: [], is_active: false },
    ]).select('id');
    for (const x of rows ?? []) regles.push(x.id as string);
    const r = await outil('list_automations', {});
    const noms = (r.automations as Array<{ name: string }>).map((a) => a.name).filter((n) => n.startsWith(m));
    expect(noms).toEqual([`${m} vivante`]);
  });
});
