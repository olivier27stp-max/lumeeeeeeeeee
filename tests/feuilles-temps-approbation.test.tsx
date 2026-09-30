// @vitest-environment jsdom
//
// FEUILLES DE TEMPS — approuver, pour de vrai.
//
// Défauts corrigés (trouvés en construisant le catalogue de tâches Lumi) :
//  1. Le tableau affiché n'avait AUCUN bouton « Approuver » ; le seul chemin
//     (raccourci clavier caché) préfixait les notes par « [APPROVED] » et ne
//     remplissait jamais approved_by / approved_at.
//  2. Un bloc « TEMPORARY DEMO DATA » montrait à chaque gestionnaire 4
//     techniciens IMAGINAIRES avec de fausses heures, comptées dans les totaux.
//
// On rend le VRAI composant contre un faux Supabase.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

const etat = vi.hoisted(() => ({
  role: 'owner' as string,
  lignes: [] as any[],
  majs: [] as Array<{ valeurs: any; filtres: Array<[string, string, unknown]> }>,
}));

vi.mock('../src/i18n', () => ({ useTranslation: () => ({ language: 'fr', t: {} }) }));
vi.mock('../src/contexts/CompanyContext', () => ({ useCompany: () => ({ currentRole: etat.role, userId: 'gestionnaire-1' }) }));
vi.mock('../src/lib/orgApi', () => ({ getCurrentOrgIdOrThrow: async () => 'org-1' }));
vi.mock('../src/lib/invitationsApi', () => ({ fetchTeamList: async () => ({ members: [{ user_id: 'kevin', role: 'technician', status: 'active', full_name: 'Kevin Bouchard' }] }) }));
vi.mock('../src/components/ui/UnifiedAvatar', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../src/lib/supabase', () => {
  const requete = (table: string) => {
    const filtres: Array<[string, string, unknown]> = [];
    let maj: any = null;
    const q: any = {
      select: () => q, order: () => q, limit: () => q, in: () => q,
      eq: (c: string, v: unknown) => { filtres.push(['eq', c, v]); return q; },
      is: (c: string, v: unknown) => { filtres.push(['is', c, v]); return q; },
      gte: (c: string, v: unknown) => { filtres.push(['gte', c, v]); return q; },
      lte: (c: string, v: unknown) => { filtres.push(['lte', c, v]); return q; },
      update: (v: any) => { maj = v; return q; },
      maybeSingle: async () => ({ data: null, error: null }),
      then: (ok: any) => {
        if (maj) { etat.majs.push({ valeurs: maj, filtres }); return Promise.resolve({ data: [{ id: 'x' }], error: null }).then(ok); }
        return Promise.resolve({ data: table === 'time_entries' ? etat.lignes : [], error: null }).then(ok);
      },
    };
    return q;
  };
  const canal: any = { on: () => canal, subscribe: () => canal };
  return { supabase: { from: requete, channel: () => canal, removeChannel: () => {} } };
});

import TechnicianTimesheetTable from '../src/components/timesheets/TechnicianTimesheetTable';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let racine: Root | null = null;
let hote: HTMLDivElement | null = null;
afterEach(() => { act(() => racine?.unmount()); hote?.remove(); racine = null; hote = null; });
beforeEach(() => { etat.role = 'owner'; etat.majs = []; });

const JOUR = '2026-09-28'; // un lundi
const pointage = (id: string, extra: Record<string, unknown> = {}) => ({
  id, employee_id: 'kevin', employee_name: 'Kevin Bouchard', date: JOUR,
  punch_in: '08:00:00', punch_out: '16:00:00', punch_in_at: `${JOUR}T12:00:00Z`, punch_out_at: `${JOUR}T20:00:00Z`,
  breaks: [], notes: null, job_id: null, status: 'completed', approved_at: null, ...extra,
});

async function rendre() {
  hote = document.createElement('div');
  document.body.appendChild(hote);
  racine = createRoot(hote);
  await act(async () => { racine!.render(<TechnicianTimesheetTable currentDate={new Date(`${JOUR}T12:00:00`)} view="week" timeFormat="decimal" />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return hote;
}

describe('feuilles de temps : approbation', () => {
  it('aucun technicien imaginaire : seuls les vrais pointages sont affichés et totalisés', async () => {
    etat.lignes = [pointage('p1')];
    const h = await rendre();
    for (const faux of ['Marc Tremblay', 'Sophie Gagnon', 'David Roy', 'Émilie Bouchard']) expect(h.textContent).not.toContain(faux);
    expect(h.textContent).toContain('Kevin Bouchard');
  });

  it('un gestionnaire voit « Approuver (n) » et le clic écrit approved_by / approved_at (pas les notes)', async () => {
    etat.lignes = [pointage('p1'), pointage('p2', { date: '2026-09-29' })];
    const h = await rendre();
    const bouton = [...h.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Approuver'));
    expect(bouton?.textContent).toBe('Approuver (2)');
    await act(async () => { bouton!.click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(etat.majs).toHaveLength(1);
    const { valeurs, filtres } = etat.majs[0];
    expect(valeurs.approved_by).toBe('gestionnaire-1');
    expect(typeof valeurs.approved_at).toBe('string');
    expect(valeurs).not.toHaveProperty('notes');
    expect(filtres).toContainEqual(['eq', 'employee_id', 'kevin']);
    expect(filtres).toContainEqual(['eq', 'status', 'completed']);
    expect(filtres).toContainEqual(['is', 'approved_at', null]);
  });

  it('tout approuvé → « ✓ Approuvé », plus de bouton', async () => {
    etat.lignes = [pointage('p1', { approved_at: '2026-09-29T13:00:00Z' })];
    const h = await rendre();
    expect(h.textContent).toContain('✓ Approuvé');
    expect([...h.querySelectorAll('button')].some((b) => b.textContent?.startsWith('Approuver'))).toBe(false);
  });

  it('un pointage approuvé à l’ancienne ([APPROVED] dans les notes) compte comme approuvé', async () => {
    etat.lignes = [pointage('p1', { notes: '[APPROVED] [APPROVED] Toiture' })];
    const h = await rendre();
    expect(h.textContent).toContain('✓ Approuvé');
  });

  it('un technicien ne peut pas approuver : il voit seulement « À approuver »', async () => {
    etat.role = 'technician';
    etat.lignes = [pointage('p1')];
    const h = await rendre();
    expect(h.textContent).toContain('À approuver');
    expect([...h.querySelectorAll('button')].some((b) => b.textContent?.startsWith('Approuver'))).toBe(false);
  });
});
