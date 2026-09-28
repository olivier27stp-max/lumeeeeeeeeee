/**
 * Modèles de messages : une valeur insérée n'est jamais relue.
 *
 * En trois passes successives ({{…}}, puis {…}, puis […]), un client
 * « [QA] Équipe » ou une note « voir [annexe] » perdait son texte entre
 * crochets, pris pour une ancienne variable (constaté le 2026-09-28 en
 * remplissant {{job.title}}). On teste les VRAIES fonctions, pas une copie.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

type Resoudre = (t: string, v: Record<string, string | null | undefined>) => string;
let resolveTemplate: Resoudre;
let applyTemplate: Resoudre;

beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test');
  vi.stubEnv('SUPABASE_URL', 'http://localhost:54321');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test');
  ({ resolveTemplate } = await import('../server/lib/actions/index'));
  ({ applyTemplate } = await import('../server/lib/notificationHelpers'));
});

describe('une seule passe', () => {
  const vars = { job_cf_title: '[QA] Toiture {urgent}', client_name: 'Jean', 'client.nom': 'Jean Dupont', urgent: 'NON' };

  it('resolveTemplate garde le texte entre crochets et accolades d’une valeur', () => {
    expect(resolveTemplate('Job « {{job.title}} » pour {client_name}', vars)).toBe('Job « [QA] Toiture {urgent} » pour Jean');
  });
  it('resolveTemplate : les trois syntaxes restent résolues', () => {
    expect(resolveTemplate('{{client.nom}} / {client_name} / [client_name] / {inconnue}', vars)).toBe('Jean Dupont / Jean / Jean / ');
  });
  it('applyTemplate garde le texte d’une valeur et laisse une variable inconnue telle quelle', () => {
    expect(applyTemplate('« {{job.title}} » {client_name} [autre]', vars)).toBe('« [QA] Toiture {urgent} » Jean [autre]');
  });
});
