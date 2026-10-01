/**
 * Le filet de la suite lui-même : `envoisSimules()` (tests/automations-suite/
 * harnais/moteur.ts) lit TOUTE la fenêtre puis les tests filtrent en mémoire.
 * PostgREST plafonne une réponse à 1 000 lignes (PGRST_DB_MAX_ROWS, comme sur
 * Supabase) et l'ordre est croissant : au-delà de 1 000 envois simulés dans la
 * fenêtre, les plus RÉCENTS sont coupés — et « aucun envoi » devient vrai à
 * tort. Constaté le 2026-10-01 : après la mesure de charge (600 envois), un
 * courriel parti à 1 h du matin n'était plus vu par le test qui le cherchait.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { demarrerMoteur, envoisSimules, marque } from '../../automations-suite/harnais/moteur';

let b: Awaited<ReturnType<typeof demarrerMoteur>>;
const m = marque('B0-harnais');

beforeAll(async () => { b = await demarrerMoteur(); });
afterAll(async () => { await b.admin.from('envois_simules').delete().eq('org_id', b.orgB).like('destinataire', `%${m}%`); });

describe('harnais de la suite — la preuve « aucun envoi » au-delà de 1 000 envois simulés', () => {
  it('[B0-01] le 1 001e envoi de la fenêtre est vu par envoisSimules()', async () => {
    const depuis = new Date(Date.now() - 2_000).toISOString();
    const lignes = Array.from({ length: 1000 }, (_, i) => ({ org_id: b.orgB, canal: 'webhook', destinataire: `remplissage://${m}/${i}`, meta: {} }));
    const { error } = await b.admin.from('envois_simules').insert(lignes);
    expect(error).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    const { error: e2 } = await b.admin.from('envois_simules').insert({ org_id: b.orgB, canal: 'sms', destinataire: `dernier://${m}`, corps: 'le vrai envoi à détecter', meta: {} });
    expect(e2).toBeNull();
    const vus = await envoisSimules(b.admin, b.orgB, depuis);
    expect(vus.some((e) => e.destinataire === `dernier://${m}`), `${vus.length} lignes lues : le dernier envoi n’y est pas`).toBe(true);
  });
});
