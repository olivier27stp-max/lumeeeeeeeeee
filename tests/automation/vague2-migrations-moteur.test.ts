/**
 * Les trois correctifs du moteur qui vivent en base (audit V2) — cliquets
 * sur la DERNIÈRE définition dans les migrations. Les preuves de bout en
 * bout ont été faites sur staging (voir les messages de commit) :
 *   · D-03 : règle faite dans l'éditeur, deal immobile 10 j → 1 alerte (0 avant) ;
 *   · D-09 : deux tâches simultanées → TASK-1002 et TASK-1003 (avant : la 2e perdue, 23505) ;
 *   · C29/C30 : les 3 tâches planifiées existent, un chemin hors liste est refusé.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DOSSIER = join(__dirname, '..', '..', 'supabase', 'migrations');
const SQL = readdirSync(DOSSIER).filter((f) => f.endsWith('.sql')).sort().map((f) => ({ f, sql: readFileSync(join(DOSSIER, f), 'utf8') }));

function derniere(nom: string): string {
  let corps = '';
  for (const { sql } of SQL) {
    for (const m of sql.matchAll(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${nom}\\s*\\([\\s\\S]*?\\$(fn|function|\\$)\\$;`, 'gi'))) corps = m[0];
  }
  return corps;
}

describe('D-03 — deal sans mouvement : l’étape de l’éditeur compte', () => {
  const f = derniere('pipeline_detecter_stagnation');
  it('lit conditions.stage_id quand la colonne est vide', () => {
    expect(f).toMatch(/r\.stage_id is null and \(r\.conditions ->> 'stage_id'\) = d\.stage_id::text/);
  });
  it('vide partout = toutes les étapes ouvertes', () => {
    expect(f).toMatch(/r\.stage_id is null and coalesce\(r\.conditions ->> 'stage_id', ''\) = ''/);
    expect(f).toMatch(/s\.kind = 'open'/);
  });
  it('une règle à la corbeille ne détecte rien', () => {
    expect(f).toMatch(/r\.deleted_at is null/);
  });
});

describe('D-09 — numéro de tâche sans collision', () => {
  it('verrou transactionnel PAR BUREAU avant le calcul', () => {
    const f = derniere('generate_task_public_id');
    expect(f).toMatch(/pg_advisory_xact_lock\(hashtextextended\('task_public_id:' \|\| NEW\.org_id::text, 0\)\)/);
    expect(f.indexOf('pg_advisory_xact_lock')).toBeLessThan(f.indexOf('max('));
  });
});

describe('C29/C30 — les trois tâches quotidiennes ont un déclencheur', () => {
  const tout = SQL.map((x) => x.sql).join('\n');
  it('pg_cron planifie rappels-dates, recurring-invoices, webhook-retries', () => {
    for (const chemin of ['/api/cron/rappels-dates', '/api/cron/recurring-invoices', '/api/cron/webhook-retries']) {
      expect(tout).toMatch(new RegExp(`cron\\.schedule\\([^;]*trigger_cron_api\\('${chemin.replace(/\//g, '\\/')}'\\)`));
    }
  });
  it('liste blanche, et jamais de repli vers la prod', () => {
    const f = derniere('trigger_cron_api');
    expect(f).toMatch(/if p_chemin not in \(/);
    expect(f).not.toMatch(/coalesce\([\s\S]*?lumecrm\.net/);
  });
  it('les routes tiennent un verrou (un double appel ne crée rien de plus)', () => {
    const cron = readFileSync(join(__dirname, '..', '..', 'server', 'routes', 'cron.ts'), 'utf8');
    expect(cron).toMatch(/withAdvisoryLock\('cron-recurring-invoices'/);
    expect(cron).toMatch(/withAdvisoryLock\('cron-webhook-retries'/);
  });
});
