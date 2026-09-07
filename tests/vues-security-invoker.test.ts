/**
 * TOUTE VUE RECRÉÉE DOIT GARDER security_invoker.
 *
 * LE 2026-09-06 À 20 H 31, EN PRODUCTION
 * Une migration a fait `create or replace view public.tasks_active as …`
 * pour ajouter deux colonnes. Sans `with (security_invoker = true)`.
 * CREATE OR REPLACE VIEW réinitialise les options : la vue est repassée
 * en mode propriétaire (postgres), qui ignore la RLS de la table. La CI
 * « RLS cross-tenant isolation » a rougi : un anonyme lisait la vue, un
 * membre y voyait les tâches de six autres organisations. Refermée par
 * 20260906160000 vingt minutes plus tard.
 *
 * Le matin même, les 14 vues du projet étaient toutes en security_invoker.
 * Il a suffi d'une ligne oubliée. Ce test la rend impossible à oublier.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DOSSIER = resolve(__dirname, '..', 'supabase/migrations');
/** À partir de quand la règle s'applique : les migrations antérieures ont été alignées par l'audit du 31 juillet. */
const DEPUIS = '20260801000000';

function sansCommentaires(sql: string): string {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('chaque vue créée ou recréée depuis août porte security_invoker', () => {
  const fichiers = readdirSync(DOSSIER).filter((f) => f.endsWith('.sql') && f >= DEPUIS).sort();

  it('la liste des migrations récentes n est pas vide', () => {
    expect(fichiers.length).toBeGreaterThan(0);
  });

  const manques: string[] = [];
  for (const f of fichiers) {
    const sql = sansCommentaires(readFileSync(resolve(DOSSIER, f), 'utf8'));
    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?view\s+(\S+)([\s\S]{0,400}?)\bas\b/gi)) {
      if (!/security_invoker\s*=\s*(true|on)/i.test(m[2])) manques.push(`${f} → ${m[1]}`);
    }
  }

  it('aucune vue sans with (security_invoker = true)', () => {
    // Si ce test rougit : ajouter `with (security_invoker = true)` entre le
    // nom de la vue et `as`. Sans quoi la vue lit la table avec les droits
    // de postgres, pour n'importe quel appelant.
    expect(manques).toEqual([]);
  });
});

describe('la migration d urgence du 2026-09-06', () => {
  it('remet l option sur tasks_active', () => {
    const sql = readFileSync(resolve(DOSSIER, '20260906160000_tasks_active_security_invoker.sql'), 'utf8');
    expect(sql).toContain('alter view public.tasks_active set (security_invoker = true)');
  });
});
