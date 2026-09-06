/**
 * LA SAUVEGARDE QUOTIDIENNE DE LA PROD DOIT AUSSI EXISTER SUR WINDOWS.
 *
 * CONSTAT DU 2026-09-06
 * `npm run backup:install` n'installait que sous launchd (macOS). Sur le
 * poste Windows du propriétaire : launchctl absent, échec silencieux,
 * `backup:status` répondait « tâche ABSENTE, AUCUNE sauvegarde ». Aucune
 * sauvegarde de la prod n'a jamais existé sur ce disque — alors que
 * CLAUDE.md rappelle que Supabase a déjà cessé les siennes trois jours
 * sans alerte.
 *
 * CE QUE CES TESTS FIGENT
 * Une voie Windows (Planificateur de tâches) avec les mêmes exigences que
 * launchd : 03 h 00 tous les jours, rattrapage si le PC dormait, et un
 * état lisible.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const INSTALL = lire('scripts/install-backup-agent.sh');
const STATUS = lire('scripts/backup-status.sh');

describe('installation sous Windows', () => {
  it('détecte Git Bash / MSYS avant de tenter launchd', () => {
    expect(INSTALL.indexOf('MINGW*')).toBeLessThan(INSTALL.indexOf('launchctl bootout'));
  });

  it('enregistre une tâche quotidienne à 03 h 00', () => {
    expect(INSTALL).toContain('New-ScheduledTaskTrigger -Daily -At 03:00');
  });

  it('rattrape un déclenchement manqué — comme launchd, contrairement à cron', () => {
    expect(INSTALL).toContain('-StartWhenAvailable');
  });

  it('ne lance pas deux sauvegardes en parallèle et borne la durée', () => {
    expect(INSTALL).toContain('-MultipleInstances IgnoreNew');
    expect(INSTALL).toContain('-ExecutionTimeLimit');
  });

  it('vérifie la présence de la tâche après installation au lieu de la supposer', () => {
    expect(INSTALL).toMatch(/Get-ScheduledTask -TaskName '\$TACHE' -ErrorAction Stop/);
    expect(INSTALL).toContain('ERREUR: tâche introuvable après installation');
  });

  it('utilise un chemin en barres obliques (cygpath -m), que Git Bash comprend', () => {
    expect(INSTALL).toContain('REPO_WIN="$(cygpath -m "$REPO")"');
  });

  it('sait aussi se désinstaller', () => {
    expect(INSTALL).toContain("Unregister-ScheduledTask -TaskName '$TACHE'");
  });
});

describe('état sous Windows', () => {
  it('interroge le Planificateur, pas launchctl', () => {
    expect(STATUS).toContain("Get-ScheduledTask -TaskName 'Lume Backup Prod'");
  });

  it('lit la date du dernier dump avec stat GNU en repli du stat BSD', () => {
    expect(STATUS).toContain('stat -c %Y');
  });
});
