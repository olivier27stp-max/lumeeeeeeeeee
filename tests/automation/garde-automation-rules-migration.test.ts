/**
 * La garde en base d'`automation_rules` (migration 20261007300000) — ce qui ne doit pas changer.
 *
 * La preuve du comportement se fait contre une vraie base
 * (`scripts/qa/verifier-garde-automatisations.mjs` : 9 écritures interdites refusées à une session
 * d'utilisateur, 7 écritures légitimes acceptées). Ce test-ci fige les trois propriétés dont dépend la
 * garde et qu'une retouche pourrait casser sans bruit.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261007300000_automation_rules_garde.sql'), 'utf8');
/** Le code, sans les commentaires `-- …`. */
const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').toLowerCase();

describe('migration automation_rules_garde', () => {
  it('lit `current_user`, pas `auth.role()` : le semis des automatisations fournies (SECURITY DEFINER) doit passer', () => {
    expect(code).toContain("current_user not in ('authenticated', 'anon')");
    expect(code).not.toContain('auth.role()');
  });

  it('la fonction n’est PAS SECURITY DEFINER (sinon current_user vaudrait toujours le propriétaire)', () => {
    const definition = code.slice(code.indexOf('create or replace function'), code.indexOf('$$;'));
    expect(definition).not.toContain('security definer');
    // …et la migration le revérifie elle-même après coup.
    expect(code).toContain('prosecdef');
  });

  it('le déclencheur couvre INSERT, UPDATE et DELETE, ligne par ligne, AVANT l’écriture', () => {
    expect(code).toMatch(/create trigger trg_automation_rules_garde\s+before insert or update or delete on public\.automation_rules\s+for each row execute function public\.automation_rules_garde\(\)/);
  });

  it('chaque refus est une erreur de droit (42501), que les routes savent déjà traduire', () => {
    const refus = code.match(/raise exception/g)?.length ?? 0;
    const en42501 = code.match(/errcode = '42501'/g)?.length ?? 0;
    // Les deux derniers `raise exception` sont les garde-fous de la migration elle-même.
    expect(refus).toBeGreaterThanOrEqual(10);
    expect(en42501).toBe(refus - 2);
  });

  it('les règles : publication, statut « fournie », purge hors corbeille, règle purgée figée, DELETE', () => {
    expect(code).toContain('new.is_active and not old.is_active');
    expect(code).toContain('new.is_preset is distinct from old.is_preset');
    expect(code).toContain('new.preset_key is distinct from old.preset_key');
    expect(code).toContain('new.purged_at is not null and old.deleted_at is null');
    expect(code).toContain('old.purged_at is not null');
    expect(code).toContain("tg_op = 'delete'");
  });
});
