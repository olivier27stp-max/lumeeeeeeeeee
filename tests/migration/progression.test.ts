// Progression d'un lot : publieur throttlé, jamais bloquant, étape forcée.

import { describe, it, expect, vi } from 'vitest';
import { creerPublieurProgression } from '../../server/lib/migration/execution';

function fauxAdmin() {
  const updates: Array<{ payload: any; filtres: Array<[string, string]> }> = [];
  const admin = {
    from: (_table: string) => ({
      update: (payload: any) => {
        const entry = { payload, filtres: [] as Array<[string, string]> };
        updates.push(entry);
        const builder: any = {
          eq: (k: string, v: string) => { entry.filtres.push([k, v]); return builder; },
          then: (resolve: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(resolve),
        };
        return builder;
      },
    }),
  };
  return { admin: admin as any, updates };
}

describe('creerPublieurProgression', () => {
  it('publie la première fois, puis au plus une fois par intervalle, sauf changement d\'étape', () => {
    vi.useFakeTimers();
    const { admin, updates } = fauxAdmin();
    const publier = creerPublieurProgression(admin, 'lot-1', 1500);
    const base = { entity: 'client' as const, total: 1000, entites_faites: 0, entites_total: 3 };
    publier({ ...base, etape: 'Import test — Clients', processed: 0 });
    publier({ ...base, etape: 'Import test — Clients', processed: 250 }); // trop tôt : ignoré
    expect(updates).toHaveLength(1);
    vi.advanceTimersByTime(1600);
    publier({ ...base, etape: 'Import test — Clients', processed: 500 });
    expect(updates).toHaveLength(2);
    publier({ ...base, etape: 'Import test — Jobs', processed: 0, entites_faites: 1 }); // nouvelle étape : forcée
    expect(updates).toHaveLength(3);
    vi.useRealTimers();
  });

  it('écrit totals.progress sur le lot seulement tant qu\'il court', () => {
    const { admin, updates } = fauxAdmin();
    const publier = creerPublieurProgression(admin, 'lot-9', 0);
    publier({ etape: 'Préparation', entity: null, processed: 0, total: 0, entites_faites: 0, entites_total: 0 });
    expect(updates[0].payload.totals.progress.etape).toBe('Préparation');
    expect(typeof updates[0].payload.totals.progress.updated_at).toBe('string');
    expect(updates[0].filtres).toEqual([['id', 'lot-9'], ['status', 'running']]);
  });
});
