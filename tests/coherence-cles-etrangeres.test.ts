/**
 * L'AUDIT DES MÉTADONNÉES DU 2026-09-04, FIGÉ.
 *
 * Sur la prod, en lecture seule : 70 colonnes *_id sans clé étrangère,
 * 139 relations org-scopées, 14 vues, 93 fonctions SECURITY DEFINER
 * appelables par tout utilisateur connecté (36 testées une à une avec
 * la session d'une organisation contre l'autre : 36 refus).
 *
 * Quatre choses étaient réellement cassées ; la migration les corrige.
 * Ces tests empêchent qu'elles reviennent — et surtout la quatrième,
 * qui est un piège de Supabase, pas une erreur d'inattention :
 *
 *   Supabase accorde EXECUTE à anon et authenticated sur CHAQUE nouvelle
 *   fonction. `revoke … from public` ne retire PAS ces grants — ce sont
 *   des grants explicites. Une fonction « réservée au serveur » reste
 *   appelable par n'importe quel utilisateur tant qu'on ne révoque pas
 *   nommément anon et authenticated. Vérifié : oauth_menage() s'exécutait
 *   depuis une session d'utilisateur ordinaire.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const RACINE = resolve(__dirname, '..');
const DOSSIER = resolve(RACINE, 'supabase/migrations');
const MIG = readFileSync(resolve(DOSSIER, '20260904200000_coherence_cles_etrangeres.sql'), 'utf8');

describe('les 17 clés étrangères sont validées', () => {
  it('chacune a son VALIDATE CONSTRAINT', () => {
    const n = (MIG.match(/validate constraint/g) || []).length;
    expect(n).toBe(17);
  });

  it('les deux violations sont résorbées AVANT la validation, selon l intention de la contrainte', () => {
    // form_submissions_lead_id_fkey est ON DELETE SET NULL → on met à null.
    // org_client_counters_org_id_fkey est ON DELETE CASCADE → on supprime.
    const iNull = MIG.indexOf('set lead_id = null');
    const iDel = MIG.indexOf('delete from public.org_client_counters');
    const iVal = MIG.indexOf('validate constraint');
    expect(iNull).toBeGreaterThan(-1);
    expect(iDel).toBeGreaterThan(-1);
    expect(iNull).toBeLessThan(iVal);
    expect(iDel).toBeLessThan(iVal);
  });

  it('la résorption ne touche que les orphelins', () => {
    expect(MIG).toMatch(/set lead_id = null\s+where lead_id is not null\s+and not exists/);
    expect(MIG).toMatch(/delete from public\.org_client_counters k\s+where not exists/);
  });
});

describe('updated_at bouge sur les trois tables qui l avaient figé', () => {
  for (const t of ['tasks', 'client_payment_profiles', 'job_tags']) {
    it(t, () => {
      const plat = MIG.replace(/\s+/g, ' ');
      expect(plat).toContain(`create trigger ${t}_updated_at before update on public.${t} for each row execute function public.set_updated_at()`);
    });
  }
});

describe('la politique demo_requests est évaluée une fois par requête', () => {
  it('current_setting est enveloppé dans un select', () => {
    expect(MIG).toContain("(select current_setting('app.platform_owner_id', true))");
    expect(MIG).not.toMatch(/=\s*current_setting\(/);
  });
});

describe('les privilèges par défaut ne laissent rien d ouvert', () => {
  it('oauth_menage et search_global_source sont fermées à anon et authenticated', () => {
    expect(MIG).toContain('revoke execute on function public.oauth_menage() from anon, authenticated');
    expect(MIG).toContain('revoke execute on function public.search_global_source(uuid, text) from anon, authenticated');
  });

  it('toute fonction révoquée à PUBLIC dans une migration est aussi soit accordée, soit révoquée à authenticated', () => {
    // Le garde contre le piège. Si ce test rougit : une migration a écrit
    // `revoke … from public` sur une fonction en croyant la réserver au
    // serveur. Ajouter `revoke execute on function … from anon, authenticated`
    // — ou, si l'application doit l'appeler, `grant execute … to authenticated`.
    const fichiers = readdirSync(DOSSIER).filter((f) => f.endsWith('.sql')).sort();
    const revoqueesPublic = new Set<string>();
    const accordeesAuth = new Set<string>();
    const revoqueesAuth = new Set<string>();
    for (const f of fichiers) {
      const s = readFileSync(resolve(DOSSIER, f), 'utf8');
      for (const m of s.matchAll(/revoke\s+(?:all|execute)[^;]*?on\s+function\s+public\.([a-z_0-9]+)\s*\([^;]*?\)\s*from\s+([^;]+);/gis)) {
        if (/\bpublic\b/i.test(m[2])) revoqueesPublic.add(m[1]);
        if (/authenticated/i.test(m[2])) revoqueesAuth.add(m[1]);
      }
      for (const m of s.matchAll(/grant\s+(?:all|execute)[^;]*?on\s+function\s+public\.([a-z_0-9]+)\s*\([^;]*?\)\s*to\s+([^;]+);/gis)) {
        if (/authenticated/i.test(m[2])) accordeesAuth.add(m[1]);
      }
    }
    // Vérifiées en prod le 2026-09-04 : ACL = postgres + service_role
    // uniquement, sans grant à anon/authenticated. Leur migration a été
    // rejouée par le bootstrap (db:sync-acl), qui a retiré les privilèges
    // par défaut. Toute NOUVELLE fonction doit passer le test sans figurer
    // ici — l'ajouter à cette liste demande de refaire la vérification.
    const FERMEES_VERIFIEES = new Set([
      'anonymize_inactive_leads', 'anonymize_old_soft_deleted_clients', 'detect_login_anomalies',
      'execute_scheduled_member_deletions', 'purge_expired_portal_tokens', 'purge_old_audit_events',
      'purge_old_failed_logins', 'record_failed_login', 'run_retention_job',
    ]);
    const trous = [...revoqueesPublic]
      .filter((f) => !accordeesAuth.has(f) && !revoqueesAuth.has(f) && !FERMEES_VERIFIEES.has(f))
      .sort();
    expect(trous).toEqual([]);
  });
});
