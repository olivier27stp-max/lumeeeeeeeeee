/**
 * PUBLIER PASSE PAR LE SERVEUR, ET LE SERVEUR REFUSE UN PARCOURS CASSÉ.
 *
 * Audit du 2026-09-28 (M8) : seul l'éditeur appelait
 * `problemesAvantPublication`. La liste (un par un ou en lot) écrivait
 * `is_active` directement dans PostgREST : on publiait un parcours sans
 * étape, ou un courriel sans objet, et personne ne recevait rien.
 *
 * Ce fichier monte les VRAIES routes (publication unitaire, lot, PATCH,
 * création) devant un faux client Supabase qui compte les écritures.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { AUTOMATION_PRESETS } from '../server/lib/automationPresets.data';
import { bloquantsPublication } from '../src/lib/publicationAutomatisation';

const ORG = '11111111-2222-3333-4444-555555555555';
const CASSEE = 'aaaaaaaa-0000-4000-8000-000000000001';
const SAINE = 'aaaaaaaa-0000-4000-8000-000000000002';
const MODELE = 'aaaaaaaa-0000-4000-8000-000000000003';

type Ligne = Record<string, unknown>;
let lignes: Record<string, Ligne> = {};
const ecritures: Array<{ id: string; patch: Ligne }> = [];

/** Un faux client qui lit `lignes` et note chaque update. */
function fauxClient() {
  return {
    from: () => {
      let filtreId: string | null = null;
      let patch: Ligne | null = null;
      const colonnesNulles: string[] = [];
      const chaine: Record<string, unknown> = {
        select: () => chaine,
        eq: (col: string, v: string) => { if (col === 'id') filtreId = v; return chaine; },
        // `.is('purged_at', null)` : la route ne lit plus une règle retirée
        // définitivement. Le faux client applique le filtre pour vrai.
        is: (col: string, v: unknown) => { if (v === null) colonnesNulles.push(col); return chaine; },
        maybeSingle: async () => {
          const ligne = filtreId ? lignes[filtreId] ?? null : null;
          const ecartee = ligne && colonnesNulles.some((c) => ligne[c] !== undefined && ligne[c] !== null);
          return { data: ecartee ? null : ligne, error: null };
        },
        single: async () => {
          if (patch && filtreId && lignes[filtreId]) {
            ecritures.push({ id: filtreId, patch });
            lignes[filtreId] = { ...lignes[filtreId], ...patch };
          }
          return { data: filtreId ? lignes[filtreId] ?? null : null, error: null };
        },
        update: (p: Ligne) => { patch = p; return chaine; },
        then: (ok: (r: unknown) => unknown) => {
          // `update(...).eq(...).eq(...).select(...)` attendu directement.
          if (patch && filtreId && lignes[filtreId]) {
            ecritures.push({ id: filtreId, patch });
            lignes[filtreId] = { ...lignes[filtreId], ...patch };
            return Promise.resolve({ data: [lignes[filtreId]], error: null }).then(ok);
          }
          return Promise.resolve({ data: [], error: null }).then(ok);
        },
      };
      return chaine;
    },
  };
}

vi.mock('../server/lib/supabase', () => ({
  requireAuthedClient: async () => ({ client: fauxClient(), orgId: ORG, user: { id: 'u1' } }),
  getServiceClient: () => fauxClient(),
}));
vi.mock('../server/lib/automatisations-bureaux', () => ({
  bureauxCibles: vi.fn(), copierVersBureaux: vi.fn(), propagerAuxCopies: vi.fn(async () => []),
}));

const { default: routeurPublication } = await import('../server/routes/automation-publication');
const { default: routeurRegles } = await import('../server/routes/automation-rules');

async function appeler(methode: string, chemin: string, corps: unknown) {
  const app = express();
  app.use(express.json());
  app.use('/api', routeurRegles);
  app.use('/api', routeurPublication);
  const serveur = app.listen(0);
  try {
    const { port } = serveur.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api${chemin}`, {
      method: methode,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
      body: JSON.stringify(corps),
    });
    return { status: res.status, json: await res.json().catch(() => null) as any };
  } finally {
    serveur.close();
  }
}

beforeEach(() => {
  ecritures.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  lignes = {
    // Un parcours dont le courriel n'a ni objet ni corps : il ne partirait jamais.
    [CASSEE]: {
      id: CASSEE, name: 'Relance cassée', trigger_event: 'quote.sent', conditions: {}, is_preset: false,
      is_active: false, deleted_at: null, actions: [], delay_seconds: 0, modele_id: null,
      steps: [{ id: 'e1', type: 'action', action: { type: 'send_email', config: { subject: '', body: '' } }, suivant: null }],
    },
    [SAINE]: {
      id: SAINE, name: 'Relance saine', trigger_event: 'quote.sent', conditions: {}, is_preset: false,
      is_active: false, deleted_at: null, actions: [], delay_seconds: 0, modele_id: null,
      steps: [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name]' } }, suivant: null }],
    },
    // Un modèle fourni, au format d'origine, avec `log_activity`.
    [MODELE]: {
      id: MODELE, name: 'Quote Follow-up', trigger_event: 'quote.sent', conditions: {}, is_preset: true,
      is_active: false, deleted_at: null, steps: null, delay_seconds: 86400, modele_id: null,
      actions: [
        { type: 'send_email', config: { subject: 'Suivi', body: 'Bonjour' } },
        { type: 'log_activity', config: { event_type: 'quote_followup' } },
      ],
    },
  };
});

describe('publier une automatisation, une à la fois', () => {
  it('un parcours cassé est REFUSÉ (422), le message nomme le problème, rien n’est écrit', async () => {
    const r = await appeler('POST', `/automations/rules/${CASSEE}/publication`, { actif: true });
    expect(r.status).toBe(422);
    expect(r.json.code).toBe('publication_refusee');
    expect(r.json.error).toMatch(/Publication refusée/);
    expect(r.json.error).toMatch(/Objet|Message|vide/);
    expect(r.json.problemes.length).toBeGreaterThan(0);
    expect(ecritures).toHaveLength(0);
    expect(lignes[CASSEE].is_active).toBe(false);
  });

  it('un parcours sain est publié', async () => {
    const r = await appeler('POST', `/automations/rules/${SAINE}/publication`, { actif: true });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ id: SAINE, is_active: true });
    expect(ecritures[0].patch.is_active).toBe(true);
  });

  it('repasser en brouillon n’est JAMAIS refusé, même cassé', async () => {
    lignes[CASSEE].is_active = true;
    const r = await appeler('POST', `/automations/rules/${CASSEE}/publication`, { actif: false });
    expect(r.status).toBe(200);
    expect(lignes[CASSEE].is_active).toBe(false);
  });

  it('un modèle fourni au format d’origine reste publiable (log_activity n’est pas une faute)', async () => {
    const r = await appeler('POST', `/automations/rules/${MODELE}/publication`, { actif: true });
    expect(r.status).toBe(200);
  });

  it('une automatisation neuve (action provisoire « À compléter ») n’est pas publiable', async () => {
    lignes[SAINE] = { ...lignes[SAINE], steps: [], actions: [{ type: 'send_sms', config: { body: 'À compléter' } }] };
    const r = await appeler('POST', `/automations/rules/${SAINE}/publication`, { actif: true });
    expect(r.status).toBe(422);
    expect(r.json.error).toMatch(/au moins une étape/);
  });
});

describe('publier en lot', () => {
  it('publie les saines, refuse les cassées en les nommant', async () => {
    const r = await appeler('POST', '/automations/rules/publication', { actif: true, ids: [CASSEE, SAINE] });
    expect(r.status).toBe(200);
    const parId = Object.fromEntries(r.json.resultats.map((x: any) => [x.id, x]));
    expect(parId[SAINE].ok).toBe(true);
    expect(parId[CASSEE].ok).toBe(false);
    expect(parId[CASSEE].erreur).toMatch(/Publication refusée/);
    expect(lignes[CASSEE].is_active).toBe(false);
    expect(lignes[SAINE].is_active).toBe(true);
  });
});

describe('aucun autre chemin ne publie sans vérifier', () => {
  it('PATCH { is_active: true } sur un parcours cassé → 422, rien n’est écrit', async () => {
    const r = await appeler('PATCH', `/automations/rules/${CASSEE}`, { is_active: true });
    expect(r.status).toBe(422);
    expect(r.json.code).toBe('publication_refusee');
    expect(lignes[CASSEE].is_active).toBe(false);
  });

  it('créer une automatisation DÉJÀ publiée mais vide → 422', async () => {
    const r = await appeler('POST', '/automations/rules', {
      name: 'X', trigger_event: 'quote.sent', delay_seconds: 0, is_active: true,
      actions: [{ type: 'send_sms', config: { body: 'À compléter' } }], steps: [],
    });
    expect(r.status).toBe(422);
  });

  it('le navigateur n’écrit plus le statut lui-même', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/lib/automationRulesApi.ts', 'utf8');
    const corps = src.slice(src.indexOf('export async function toggleAutomationRule'));
    expect(corps.slice(0, corps.indexOf('\n}'))).not.toMatch(/\.update\(/);
  });
});

describe('les modèles semés ne sont pas bloqués par la nouvelle garde', () => {
  it('aucun des préréglages au format d’origine n’est refusé', () => {
    const refuses = AUTOMATION_PRESETS.filter((p) => bloquantsPublication({
      trigger_event: p.trigger_event, steps: null, actions: p.actions, conditions: p.conditions, is_preset: true,
    }).length > 0);
    expect(refuses.map((p) => p.preset_key)).toEqual([]);
  });
});
