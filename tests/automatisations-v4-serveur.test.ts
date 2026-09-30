/**
 * VAGUE 4 — les gardes SERVEUR de l'interface des automatisations
 * (audit V2, 11-interface.md §9). Les VRAIES routes devant un faux client
 * Supabase qui compte les écritures (même harnais que
 * automatisations-publication-serveur.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

const ORG = '11111111-2222-3333-4444-555555555555';
const FACTURE = 'aaaaaaaa-0000-4000-8000-000000000011';
const CASSEE_PUBLIEE = 'aaaaaaaa-0000-4000-8000-000000000012';

type Ligne = Record<string, unknown>;
let lignes: Record<string, Ligne> = {};
const ecritures: Array<{ id: string; patch: Ligne }> = [];

/** Un faux client qui lit `lignes` et note chaque update. */
function fauxClient() {
  return {
    from: () => {
      let filtreId: string | null = null;
      let patch: Ligne | null = null;
      const chaine: Record<string, unknown> = {
        select: () => chaine,
        eq: (col: string, v: string) => { if (col === 'id') filtreId = v; return chaine; },
        maybeSingle: async () => ({ data: filtreId ? lignes[filtreId] ?? null : null, error: null }),
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

async function appeler(methode: string, chemin: string, corps: unknown, entetes: Record<string, string> = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api', routeurRegles);
  app.use('/api', routeurPublication);
  const serveur = app.listen(0);
  try {
    const { port } = serveur.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api${chemin}`, {
      method: methode,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x', ...entetes },
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
    // PUBLIÉE, saine : « Envoyer la facture » sur « Facture envoyée ».
    [FACTURE]: {
      id: FACTURE, name: 'Envoi facture', trigger_event: 'invoice.sent', conditions: {}, is_preset: false,
      is_active: true, deleted_at: null, actions: [], delay_seconds: 0, modele_id: null,
      steps: [{ id: 'e1', type: 'action', action: { type: 'envoyer_facture', config: {} }, suivant: null }],
    },
    // PUBLIÉE mais DÉJÀ cassée (règle d'avant la garde) : un courriel sans objet.
    [CASSEE_PUBLIEE]: {
      id: CASSEE_PUBLIEE, name: 'Ancienne cassée', trigger_event: 'quote.sent', conditions: {}, is_preset: false,
      is_active: true, deleted_at: null, actions: [], delay_seconds: 0, modele_id: null,
      steps: [{ id: 'e1', type: 'action', action: { type: 'send_email', config: { subject: '', body: '' } }, suivant: null }],
    },
  };
});

// ─── A-03 ───────────────────────────────────────────────────────

describe('A-03 — une automatisation PUBLIÉE ne peut pas être rendue cassée', () => {
  it('changer son déclencheur pour un déclencheur incompatible est refusé (422), rien n’est écrit', async () => {
    const r = await appeler('PATCH', `/automations/rules/${FACTURE}`, { trigger_event: 'lead.created' });
    expect(r.status).toBe(422);
    expect(r.json.code).toBe('publiee_cassee');
    expect(r.json.error).toMatch(/publiée/);
    expect(r.json.error).toMatch(/brouillon/);
    expect(ecritures).toHaveLength(0);
    expect(lignes[FACTURE].trigger_event).toBe('invoice.sent');
  });

  it('remplacer ses étapes par une action qui ne va pas avec le déclencheur est refusé', async () => {
    // « Envoyer le devis » sur « Facture envoyée » : il n'y a pas de devis.
    const r = await appeler('PATCH', `/automations/rules/${FACTURE}`, {
      steps: [{ id: 'e1', type: 'action', action: { type: 'envoyer_soumission', config: {} }, suivant: null }],
    });
    expect(r.status).toBe(422);
    expect(ecritures).toHaveLength(0);
  });

  it('la même modification sur un BROUILLON passe : on construit librement', async () => {
    lignes[FACTURE].is_active = false;
    const r = await appeler('PATCH', `/automations/rules/${FACTURE}`, { trigger_event: 'lead.created' });
    expect(r.status).toBe(200);
    expect(lignes[FACTURE].trigger_event).toBe('lead.created');
  });

  it('la dépublier dans le même envoi passe (repasser en brouillon n’est jamais refusé)', async () => {
    const r = await appeler('PATCH', `/automations/rules/${FACTURE}`, { trigger_event: 'lead.created', is_active: false });
    expect(r.status).toBe(200);
    expect(lignes[FACTURE].is_active).toBe(false);
  });

  it('renommer ou ranger une publiée ne rejoue rien', async () => {
    const r = await appeler('PATCH', `/automations/rules/${FACTURE}`, { name: 'Envoi facture v2' });
    expect(r.status).toBe(200);
  });

  it('une publiée DÉJÀ cassée reste modifiable tant que la modification n’ajoute pas de problème', async () => {
    // On corrige l'objet sans encore écrire le corps : un problème en moins, aucun de plus.
    const r = await appeler('PATCH', `/automations/rules/${CASSEE_PUBLIEE}`, {
      steps: [{ id: 'e1', type: 'action', action: { type: 'send_email', config: { subject: 'Suivi', body: 'Bonjour' } }, suivant: null }],
    });
    expect(r.status).toBe(200);
  });
});
