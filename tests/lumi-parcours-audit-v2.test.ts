/**
 * « Construire avec Lumi » — défauts mesurés par l'audit V2 (2026-09-29,
 * 30 demandes réelles, note 2,83/5) : L-1 à L-10. Le modèle est simulé : on
 * éprouve ce que le CODE fait de sa réponse, et ce que le prompt lui apprend.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appels: Array<{ messages: unknown[] }> = [];
const etat: { reponse: string; reservation: { id: string | null; statut: string }; delai: number } = {
  reponse: '{}', reservation: { id: 'resa-1', statut: 'ok' }, delai: 0,
};
const reservations: number[] = [];

vi.mock('../server/lib/lumi/llm', () => ({
  isLumiConfigured: () => true,
  clientAnthropic: () => ({
    messages: {
      create: async (p: { messages: unknown[] }) => {
        appels.push(p);
        if (etat.delai) await new Promise((r) => setTimeout(r, etat.delai));
        return { model: 'claude-haiku-4-5', usage: { input_tokens: 1000, output_tokens: 200 }, content: [{ type: 'text', text: etat.reponse }] };
      },
    },
  }),
}));
vi.mock('../server/lib/lumi/budget', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/lib/lumi/budget')>()),
  reserverBudget: async (_a: unknown, _o: string, cents: number) => { reservations.push(cents); return etat.reservation; },
  reglerBudget: async () => {},
  journaliserUsage: async () => {},
}));

// Session simulée pour l'API du navigateur (L-7).
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'jeton' } } }) } } }));
vi.mock('../src/lib/orgApi', () => ({ getCurrentOrgId: async () => 'org-1' }));

import { genererParcours, consignes, normaliserEtapes } from '../server/lib/lumi/generer-parcours';
import { sequenceEtapes } from '../server/lib/validation';
import { VARIABLES_CONNUES } from '../src/lib/emailBodyText';

const base = { admin: {} as never, orgId: 'org-1', userId: 'u-1', langue: 'fr' as const };
const parcours = (steps: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ nom: 'N', trigger_event: 'lead.created', resume: 'Fait.', steps, autre: null, ...extra });

beforeEach(() => {
  appels.length = 0; reservations.length = 0;
  etat.reservation = { id: 'resa-1', statut: 'ok' }; etat.delai = 0;
});

describe('L-1 — budget du mois atteint', () => {
  it('le dit, au lieu de « budget illisible, réessaie »', async () => {
    etat.reservation = { id: null, statut: 'capped' };
    const r = await genererParcours({ ...base, demande: 'relance mes soumissions après 3 jours' });
    // Les mêmes mots que le reste de Lumi (F-08) : des CRÉDITS, jamais « budget du mois ».
    expect(r.erreur).toMatch(/crédits Lumi sont épuisés/);
    expect(r.erreur).not.toMatch(/budget/i);
    expect(appels).toHaveLength(0);
  });
});

describe('L-2 — « Créer une tâche » accepté', () => {
  it('le prompt donne les valeurs permises et le type des champs', () => {
    const p = consignes(true);
    expect(p).toMatch(/priorite\?=low\|medium\|high/);
    expect(p).toMatch(/echeance_jours\? \(nombre écrit en texte/);
  });

  it('la sortie réelle du modèle (Q05) passe la validation après normalisation', async () => {
    // Sortie brute du vrai modèle, refusée en 422 avant le correctif.
    etat.reponse = parcours([
      { id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name], merci !' } }, suivant: 'e2' },
      { id: 'e2', type: 'action', action: { type: 'create_task', config: { title: 'Rappeler [client_first_name]', priorite: 'normal', echeance_jours: 1 } }, suivant: null },
    ]);
    const r = await genererParcours({ ...base, demande: 'nouveau lead : texto de bienvenue + tâche de rappel' });
    expect(r.parcours).not.toBeNull();
    expect(sequenceEtapes.safeParse(r.parcours!.steps).success).toBe(true);
    const tache = (r.parcours!.steps[1] as { action: { config: Record<string, unknown> } }).action.config;
    expect(tache).toEqual({ title: 'Rappeler [client_first_name]', echeance_jours: '1' });
  });

  it('un choix valide est gardé', () => {
    const [e] = normaliserEtapes([{ id: 'e1', type: 'action', action: { type: 'create_task', config: { title: 't', priorite: 'high' } } }]);
    expect((e.action as { config: Record<string, unknown> }).config.priorite).toBe('high');
  });
});

describe('L-3 — « la veille du rendez-vous »', () => {
  it('le prompt enseigne l’attente « avant la date », pas un envoi immédiat', () => {
    const p = consignes(true);
    expect(p).toMatch(/"mode": "avant_date", "secondes_avant": 86400/);
    expect(p).not.toMatch(/délai négatif/);
  });

  it('cette forme passe la validation', () => {
    expect(sequenceEtapes.safeParse([
      { id: 'e1', type: 'attendre', mode: 'avant_date', secondes_avant: 86400, delai_secondes: 0, suivant: 'e2' },
      { id: 'e2', type: 'action', action: { type: 'send_sms', config: { body: 'Rappel : demain' } } },
    ]).success).toBe(true);
  });
});

describe('L-4 — variables inventées', () => {
  it('[payment_link] (Q07) n’est pas proposé au client : erreur qui la nomme', async () => {
    etat.reponse = parcours([{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Payez en ligne : [payment_link]' } } }]);
    const r = await genererParcours({ ...base, demande: 'paiement échoué : texto avec le lien' });
    expect(r.parcours).toBeNull();
    expect(r.erreur).toMatch(/\[payment_link\]/);
    expect(r.erreur).toMatch(/\[invoice_link\]/);
  });

  it('les vraies variables passent, y compris [invoice_link]', async () => {
    etat.reponse = parcours([{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name], payez ici : [invoice_link]' } } }]);
    const r = await genererParcours({ ...base, demande: 'facture envoyée : texto avec le lien' });
    expect(r.parcours).not.toBeNull();
  });

  it('VARIABLES_CONNUES couvre chaque variable que le serveur remplit', () => {
    const source = readFileSync(join(__dirname, '..', 'server', 'lib', 'actions', 'index.ts'), 'utf8');
    const remplies = new Set([...source.matchAll(/vars(?:\.(\w+)|\['([a-z_]+)'\]) =/g)].map((m) => m[1] ?? m[2]));
    const manquantes = [...remplies].filter((v) => !VARIABLES_CONNUES.includes(v));
    expect(manquantes, 'l’éditeur et Lumi les traiteraient d’« inconnues »').toEqual([]);
  });

  it('le prompt dit que les montants portent déjà le « $ »', () => {
    expect(consignes(true)).toMatch(/contiennent déjà le « \$ »/);
  });
});

describe('L-5 — un refus de Lumi est expliqué', () => {
  it('son explication est montrée au lieu de « Reformule en une phrase »', async () => {
    etat.reponse = JSON.stringify({ nom: '', trigger_event: 'invoice.overdue', resume: 'Je ne peux pas écrire un message qui menace de publier la dette du client. Je te propose un rappel poli à 7 jours.', steps: [] });
    const r = await genererParcours({ ...base, demande: 'menace-le de publier sa dette sur Facebook' });
    expect(r.parcours).toBeNull();
    expect(r.erreur).toMatch(/Je ne peux pas écrire un message qui menace/);
    expect(r.erreur).not.toMatch(/Reformule/);
  });
});

describe('L-6 — garde-fous de contenu', () => {
  it('le prompt refuse menaces, envois de nuit ou en rafale, contournement de désabonnement, suppression, fuite de données', () => {
    const p = consignes(true);
    for (const motif of [/menace/, /intimidation/, /la\s+nuit/, /en\s+rafale/, /désabonnement/, /supprimer\s+ou\s+vider\s+une\s+fiche/, /données\s+d'un\s+client/]) {
      expect(p).toMatch(motif);
    }
  });
});

describe('L-8 — la réservation compte tout ce qui part au modèle', () => {
  it('un parcours affiché volumineux réserve davantage', async () => {
    etat.reponse = parcours([{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'x' } } }]);
    await genererParcours({ ...base, demande: 'change le délai à 7 jours' });
    const gros = { trigger_event: 'lead.created', steps: Array.from({ length: 25 }, (_, i) => ({ id: `e${i}`, type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour '.repeat(20) } } })) };
    await genererParcours({ ...base, demande: 'change le délai à 7 jours', parcoursActuel: gros });
    expect(reservations[1]).toBeGreaterThan(reservations[0]);
  });
});

describe('L-10 — deux clics dans le même instant', () => {
  it('une seule génération facturée', async () => {
    etat.delai = 30;
    etat.reponse = parcours([{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'x' } } }]);
    const [a, b] = await Promise.all([
      genererParcours({ ...base, demande: 'bienvenue aux nouveaux prospects' }),
      genererParcours({ ...base, demande: 'bienvenue aux nouveaux prospects' }),
    ]);
    expect(appels).toHaveLength(1);
    expect(a).toBe(b);
  });

  it('une demande différente reste une vraie génération', async () => {
    etat.reponse = parcours([{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'x' } } }]);
    await Promise.all([
      genererParcours({ ...base, demande: 'bienvenue aux nouveaux prospects' }),
      genererParcours({ ...base, demande: 'relance des soumissions à 3 jours' }),
    ]);
    expect(appels).toHaveLength(2);
  });
});

describe('L-7 — pas de brouillon vide après une génération ratée', () => {
  it('chaque refus de la route passe par le retrait du brouillon vide', () => {
    const route = readFileSync(join(__dirname, '..', 'server', 'routes', 'automation-rules.ts'), 'utf8');
    const debut = route.indexOf("router.post('/automations/rules/generer'");
    const bloc = route.slice(debut, route.indexOf('\n});\n', debut));
    expect(bloc).not.toMatch(/res\.status\(422\)\.json\(\{\s*error/);
    expect(bloc).toMatch(/retirerBrouillonVide\(/);
    // Seul un brouillon inactif, vide, sans conversation et tout juste né est retiré.
    const aide = route.slice(route.indexOf('async function retirerBrouillonVide'));
    expect(aide).toMatch(/!data\.is_active/);
    expect(aide).toMatch(/lumi_conversation/);
    expect(aide).toMatch(/10 \* 60_000/);
  });

  it('l’API du navigateur transmet « brouillon retiré » à l’éditeur', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'Lumi n’a pas compris.', brouillon_retire: true }), { status: 422, headers: { 'Content-Type': 'application/json' } }));
    const { genererParcoursAvecLumi } = await import('../src/lib/automationBuilderApi');
    const e = await genererParcoursAvecLumi('x'.repeat(12), 'fr', { ruleId: '00000000-0000-4000-8000-000000000001' }).catch((err: unknown) => err);
    expect((e as { brouillonRetire?: boolean }).brouillonRetire).toBe(true);
    vi.unstubAllGlobals();
  });
});
