/**
 * Aucune fonction de la base ne se déclare STABLE ou IMMUTABLE en écrivant.
 *
 * PostgreSQL refuse un INSERT, UPDATE ou DELETE dans une fonction non VOLATILE : l'appel
 * échoue à tout coup. C'est ce qui cassait « Restaurer » dans les Archives (restore_client,
 * restore_job) depuis la passe « advisors » de juin 2026, sans que rien ne le signale — la
 * fonction existe, se compile, et ne plante qu'à l'exécution. Corrigé par
 * supabase/migrations/20261007200000_fonctions_stables_qui_ecrivent.sql, qui porte le même
 * garde-fou côté base. Ici, il est posé sur la baseline : une régression se voit avant le déploiement.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const baseline = readFileSync(resolve(__dirname, '../supabase/baseline/01_schema.sql'), 'utf8').replace(/\r\n/g, '\n');

/** Chaque fonction de la baseline : son nom, sa ligne d'attributs, son corps. */
function fonctions(): Array<{ nom: string; attributs: string; corps: string }> {
  const sortie: Array<{ nom: string; attributs: string; corps: string }> = [];
  const re = /CREATE FUNCTION public\.([a-z0-9_]+)\(([^]*?)\n {4}AS (\$[a-zA-Z_]*\$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(baseline))) {
    const fin = baseline.indexOf(m[3], re.lastIndex);
    if (fin < 0) continue;
    sortie.push({ nom: m[1], attributs: m[2], corps: baseline.slice(re.lastIndex, fin) });
    re.lastIndex = fin + m[3].length;
  }
  return sortie;
}

const ECRIT = /(^|[^a-z_])(update\s+(public\.)?[a-z_]+\s+set\s|insert\s+into\s|delete\s+from\s)/i;
const sansCommentaires = (sql: string) => sql.replace(/--[^\n]*/g, '').replace(/\/\*[^]*?\*\//g, '');

describe('fonctions de la base : la volatilité dit vrai', () => {
  const toutes = fonctions();

  it('le relevé voit bien les fonctions de la baseline', () => {
    expect(toutes.length).toBeGreaterThan(250);
    expect(toutes.some((f) => f.nom === 'restore_job')).toBe(true);
  });

  it('aucune fonction STABLE ou IMMUTABLE ne fait un INSERT, un UPDATE ou un DELETE', () => {
    const fautives = toutes
      .filter((f) => /\b(STABLE|IMMUTABLE)\b/.test(f.attributs) && /LANGUAGE (plpgsql|sql)\b/.test(f.attributs))
      .filter((f) => ECRIT.test(sansCommentaires(f.corps)))
      .map((f) => f.nom);
    expect(fautives).toEqual([]);
  });

  it('les trois fonctions réparées sont modifiables, et la migration existe', () => {
    for (const nom of ['restore_client', 'restore_job', 'finish_job']) {
      const f = toutes.find((x) => x.nom === nom);
      expect(f, nom).toBeDefined();
      expect(f!.attributs, nom).not.toMatch(/\bSTABLE\b|\bIMMUTABLE\b/);
    }
    const migration = readFileSync(resolve(__dirname, '../supabase/migrations/20261007200000_fonctions_stables_qui_ecrivent.sql'), 'utf8');
    expect(migration).toMatch(/alter function public\.restore_client\(uuid, uuid\) volatile;/);
    expect(migration).toMatch(/alter function public\.restore_job\(uuid, uuid\) volatile;/);
  });
});
