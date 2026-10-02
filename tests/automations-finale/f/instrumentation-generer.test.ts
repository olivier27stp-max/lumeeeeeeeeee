/**
 * Agent F — constats F-01, F-02, F-05 et F-06 : ce que « Construire avec Lumi »
 * (server/lib/lumi/generer-parcours.ts) laisse — ou ne laisse pas — derrière lui.
 *
 * Tests purs : le modèle est remplacé par une réponse fixe (on n'y juge AUCUNE
 * qualité, seulement ce que le code écrit autour de l'appel) et la base par un
 * faux client qui retient ce qu'on lui demande d'écrire. Aucun réseau.
 *
 * Mesures réelles correspondantes (vrai modèle, pile locale, 2026-10-01) :
 * D:/lume-final/notes/F-mesures.md.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const etat = vi.hoisted(() => ({
  appels: [] as Array<Record<string, any>>,
  reponse: null as Record<string, any> | null,
}));

vi.mock('../../../server/lib/lumi/llm', () => ({
  isLumiConfigured: () => true,
  clientAnthropic: () => ({
    messages: {
      create: async (params: Record<string, any>) => { etat.appels.push(params); return etat.reponse; },
    },
  }),
}));

import { genererParcours } from '../../../server/lib/lumi/generer-parcours';
import { SOURCES, verifierPlafond } from '../../../server/lib/lumi/plafond-journalier';

const PARCOURS = {
  nom: 'Relance de soumission', trigger_event: 'quote.sent', resume: 'J’ai créé une relance à 3 jours.', modifie: true,
  steps: [
    { id: 'e1', type: 'attendre', delai_secondes: 259_200, suivant: 'e2' },
    { id: 'e2', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name], votre soumission : [quote_link]. [company_name]' } } },
  ],
  autre: null,
};

interface Ecriture { table: string; ligne: Record<string, any> }
function fausseBase(statutReservation = 'ok') {
  const ecritures: Ecriture[] = [];
  const rpc: Array<{ nom: string; args: Record<string, any> }> = [];
  const admin = {
    rpc: async (nom: string, args: Record<string, any>) => {
      rpc.push({ nom, args });
      if (nom === 'reserve_ai_budget') return { data: { status: statutReservation, reservation_id: statutReservation === 'ok' ? 'reservation-test' : null }, error: null };
      return { data: null, error: null };
    },
    from: (table: string) => ({
      insert: async (ligne: Record<string, any>) => { ecritures.push({ table, ligne }); return { error: null }; },
      upsert: async (ligne: Record<string, any>) => { ecritures.push({ table, ligne }); return { error: null }; },
    }),
  };
  return { admin: admin as never, ecritures, rpc };
}

const demander = (base: ReturnType<typeof fausseBase>, plus: Record<string, unknown> = {}) => genererParcours({
  admin: base.admin, orgId: '00000000-0000-4000-8000-00000000000a', userId: '00000000-0000-4000-8000-00000000000b',
  // Une demande différente à chaque test : deux demandes identiques en vol sont fusionnées par le code.
  demande: `Quand un devis est envoyé, attends 3 jours puis envoie un texto. (${Math.random()})`, langue: 'fr',
  ...plus,
} as never);

beforeEach(() => {
  etat.appels.length = 0;
  etat.reponse = {
    id: `msg_test_${Math.random().toString(36).slice(2)}`, model: 'claude-sonnet-5', stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify(PARCOURS, null, 2) }],
    usage: { input_tokens: 120, output_tokens: 900, cache_read_input_tokens: 6058, cache_creation_input_tokens: 0 },
  };
});

describe('« Construire avec Lumi » — ce que l’appel laisse dans les journaux', () => {
  it('garde-fou : la génération est bien débitée au grand livre, au coût réel, source « automatisations »', async () => {
    const base = fausseBase();
    const r = await demander(base);
    expect(r.parcours?.steps.length).toBe(2);
    const usage = base.ecritures.filter((e) => e.table === 'ai_usage');
    expect(usage).toHaveLength(1);
    expect(usage[0].ligne.source).toBe('automatisations');
    // 120 × 2 $ + 900 × 10 $ + 6 058 × 0,20 $ par million = 1,0452 ¢
    expect(usage[0].ligne.cost_cents).toBeCloseTo(1.0452, 3);
    const reglement = base.rpc.find((x) => x.nom === 'settle_ai_budget');
    expect(reglement?.args.p_cost).toBeCloseTo(1.0452, 3);
  });

  it('F-01 — chaque génération laisse une ligne dans lumi_traces (durée, tokens, coût, résultat)', async () => {
    const base = fausseBase();
    await demander(base);
    const traces = base.ecritures.filter((e) => e.table === 'lumi_traces');
    expect(traces.length, 'aucune trace : ni la durée, ni le résultat, ni la demande ne sont mesurables pour ce chemin').toBe(1);
    expect(traces[0].ligne.model).toBe('claude-sonnet-5');
    expect(Number(traces[0].ligne.cost_cents)).toBeGreaterThan(0);
    expect(Number(traces[0].ligne.duree_ms)).toBeGreaterThanOrEqual(0);
  });

  it('F-02 — une génération lancée depuis une conversation de Lumi est rattachée à cette conversation', async () => {
    const base = fausseBase();
    const conversation = '00000000-0000-4000-8000-0000000000c1';
    // L'outil create_automation_from_text appelle genererParcours depuis une conversation : son coût doit y être rattaché,
    // sinon le plafond par conversation (40 ¢) et la trace du tour ne le voient pas.
    await demander(base, { conversationId: conversation });
    const usage = base.ecritures.filter((e) => e.table === 'ai_usage');
    expect(usage[0]?.ligne.conversation_id).toBe(conversation);
  });

  it('F-05 — l’appel fixe son niveau d’effort au lieu de laisser le défaut du modèle', async () => {
    const base = fausseBase();
    await demander(base);
    expect(etat.appels).toHaveLength(1);
    // Sans `output_config.effort`, Sonnet 5 raisonne au niveau « high » par défaut, réflexion comprise dans la sortie facturée.
    expect(etat.appels[0].output_config?.effort, 'ni `thinking` ni `effort` ne sont précisés').toBeDefined();
  });

  it('F-06 — la dépense entre dans le plafond journalier de la plateforme', async () => {
    const depense = () => [...SOURCES, 'automatisations' as never].reduce((s, src) => s + verifierPlafond(src).depense_cents, 0);
    const avant = depense();
    await demander(fausseBase());
    expect(depense() - avant, 'aucun compteur du plafond journalier n’a bougé : ce chemin n’est borné par aucun plafond de plateforme').toBeGreaterThan(1);
  });
});
