import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Le statut d'un client suit ses jobs.
 *
 * Trouvé le 2026-09-01 par le parcours complet du robot : créer un job
 * laissait le client au statut « prospect ». Or `src/pages/Clients.tsx`
 * affirme que « le trigger DB jobs_sync_client_status fait autorité » — un
 * déclencheur qui n'existait NI en test NI en production.
 *
 * La migration qui le crée (20260607010000) n'avait jamais été appliquée.
 * Aucun client n'était encore mal classé, mais le défaut était dormant : il
 * se serait manifesté au premier client à qui l'on ouvre un job.
 *
 * En appliquant le correctif, `check_exposed_trigger_functions()` a signalé
 * que la fonction devenait appelable par `anon` — un visiteur non connecté.
 * Elle tourne en `security definer` et modifie des clients : le verrou est
 * indispensable.
 */

const RACINE = process.cwd();
const lire = (p: string) => fs.readFileSync(path.join(RACINE, p), 'utf8');
const MIGRATION = 'supabase/migrations/20260901200000_client_status_declencheur.sql';

describe('la migration installe le déclencheur', () => {
  const sql = lire(MIGRATION);

  it('crée la fonction de calcul et le déclencheur', () => {
    expect(sql).toContain('create or replace function public.sync_client_status_from_jobs');
    expect(sql).toContain('create or replace function public.jobs_sync_client_status');
    expect(sql).toContain('create trigger trg_jobs_sync_client_status');
  });

  it('couvre les trois opérations', () => {
    // Sans le DELETE, retirer le dernier job d'un client le laisserait
    // « actif » à tort ; sans l'UPDATE, la mise de côté d'un job non plus.
    expect(sql).toContain('after insert or update or delete on public.jobs');
  });

  it('recalcule les DEUX clients quand un job change de main', () => {
    expect(sql).toContain('if old.client_id is distinct from new.client_id then');
  });

  it('ne réactive jamais un client archivé à la main', () => {
    expect(sql).toContain("status <> 'inactive'");
  });
});

describe('les fonctions ne sont pas exposées', () => {
  const sql = lire(MIGRATION);

  it('EXECUTE est révoqué à anon et authenticated', () => {
    // Elles tournent en security definer et modifient des clients : personne
    // ne doit pouvoir les appeler directement.
    expect(sql).toMatch(/revoke all on function public\.jobs_sync_client_status\(\)[\s\S]*?anon/);
    expect(sql).toMatch(/revoke all on function public\.sync_client_status_from_jobs\(uuid\)[\s\S]*?anon/);
  });

  it('la migration échoue si une fonction reste exposée', () => {
    expect(sql).toContain('check_exposed_trigger_functions()');
    expect(sql).toContain('restent exposées');
  });
});

describe('le code de l\'application dit vrai', () => {
  it('le commentaire de Clients.tsx correspond maintenant à la réalité', () => {
    // Ce commentaire affirmait l'existence du déclencheur alors qu'il
    // n'existait pas. Il est désormais exact.
    expect(lire('src/pages/Clients.tsx')).toContain('jobs_sync_client_status');
  });
});
