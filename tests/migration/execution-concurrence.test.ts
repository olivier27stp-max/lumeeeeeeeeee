// Import test : transitions de statut ATOMIQUES. Le bot (cron de 10 min) et un
// clic « Import test » dans la console peuvent arriver à la même seconde ; avant,
// les deux passaient et deux dry-runs tournaient sur la même migration.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { lancerImportTest } from '../../server/lib/migration/execution';

const lu = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

/** Faux client : chaque update sur data_migrations renvoie les lignes configurées ; tout
 *  autre accès à une table lève (le test doit s'arrêter AVANT). */
function fauxAdmin(lignesParUpdate: Array<Array<{ id: string }>>) {
  const journal: string[] = [];
  let i = 0;
  const chaineUpdate: any = {
    eq: () => chaineUpdate,
    select: () => Promise.resolve({ data: lignesParUpdate[i++] ?? [], error: null }),
  };
  const admin: any = {
    from: (table: string) => {
      journal.push(table);
      if (table !== 'data_migrations') throw new Error(`accès inattendu à ${table}`);
      return { update: () => chaineUpdate };
    },
  };
  return { admin, journal };
}

const acteur = { id: 'admin-1', role: 'platform_admin' as const };

describe('lancerImportTest — course bot / console', () => {
  it("statut déjà pris par un autre appel (0 ligne modifiée) → null, aucun lot créé", async () => {
    const { admin, journal } = fauxAdmin([[]]); // update ready_for_test → testing : personne
    const m: any = { id: 'm1', status: 'ready_for_test', created_by: 'u' };
    expect(await lancerImportTest(admin, m, acteur)).toBeNull();
    expect(journal).toEqual(['data_migrations']);
    expect(m.status).toBe('ready_for_test'); // l'objet local n'est pas menti
  });

  it('pré-transition vers ready_for_test perdue (quelqu\'un a bougé le statut) → null', async () => {
    const { admin, journal } = fauxAdmin([[]]); // update test_review → ready_for_test : 0 ligne
    const m: any = { id: 'm1', status: 'test_review', created_by: 'u' };
    expect(await lancerImportTest(admin, m, acteur)).toBeNull();
    expect(journal).toEqual(['data_migrations']);
  });

  it('statut sans transition possible vers ready_for_test → null sans toucher la base', async () => {
    const { admin, journal } = fauxAdmin([]);
    const m: any = { id: 'm1', status: 'importing', created_by: 'u' };
    expect(await lancerImportTest(admin, m, acteur)).toBeNull();
    expect(journal).toEqual([]);
  });

  it('la prise de main réussie continue vers la création du lot (preuve : accès à migration_import_batches)', async () => {
    const { admin } = fauxAdmin([[{ id: 'm1' }]]);
    const m: any = { id: 'm1', status: 'ready_for_test', created_by: 'u' };
    await expect(lancerImportTest(admin, m, acteur)).rejects.toThrow(/migration_import_batches/);
    expect(m.status).toBe('testing');
  });
});

describe('gardes de source (routes)', () => {
  it("la route test-import refuse un second import test pendant qu'un lot test tourne", () => {
    const r = lu('server/routes/migration-admin.ts');
    const i = r.indexOf("router.post('/migration-admin/migrations/:id/test-import'");
    const bloc = r.slice(i, r.indexOf('void lancerImportTest', i));
    expect(bloc).toContain(".eq('kind', 'test')");
    expect(bloc).toContain(".eq('status', 'running')");
    expect(bloc).toContain('Un import test est déjà en cours');
  });
  it("la route final-import vérifie que la transition a bien pris (deux clics = un seul lot final)", () => {
    const r = lu('server/routes/migration-admin.ts');
    const i = r.indexOf("router.post('/migration-admin/migrations/:id/final-import'");
    const bloc = r.slice(i, r.indexOf("kind: 'final'", i));
    expect(bloc).toContain(".eq('status', 'ready_for_final_import')\n      .select('id')");
    expect(bloc).toContain('Un import final est déjà en cours');
  });
  it("la recherche de doublons de l'import test lit par pages (plus de plafond silencieux à 20 000)", () => {
    const e = lu('server/lib/migration/execution.ts');
    // (les .limit(20000) restants portent sur migration_duplicate_candidates, pas sur le staging)
    expect(e).not.toContain(".select('id, normalized, relations')");
    expect(e).toContain("loadStaging(admin, migration.id, entity, ['ready', 'duplicate'])");
  });
});
