/**
 * Invariants quotidiens remis au vert (migration 20260926100900) sans rien
 * affaiblir : chaque table sans policy déclare son deny-all, les fonctions
 * trigger ne sont plus exécutables par anon/authenticated, et une vraie panne
 * de cron alerte toujours dès la première erreur.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIG = readFileSync(join(__dirname, '../supabase/migrations/20260926100900_invariants_au_vert.sql'), 'utf8');

describe('invariants au vert', () => {
  it.each(['creator_space_notes', 'failed_login_attempts', 'support_savoir', 'support_slack_channels', 'webhook_receipts'])(
    '%s : deny-all déclaré dans le commentaire', (t) => {
      const i = MIG.indexOf(`comment on table public.${t} is`);
      expect(i).toBeGreaterThan(-1);
      expect(MIG.slice(i, MIG.indexOf(';', i))).toContain('deny-all volontaire');
    });

  it('lumi_traces : RLS forcée', () => {
    expect(MIG).toContain('alter table public.lumi_traces force row level security;');
  });

  it.each(['clients_portal_token_hash', 'jobs_set_completed_at', 'set_support_tickets_updated_at', 'deals_figer_premier_contact', 'jobs_delier_deal'])(
    '%s : révoquée à anon et authenticated nommément', (f) => {
      expect(MIG).toContain(`revoke all on function public.${f}() from public, anon, authenticated;`);
    });

  it('cron : toute erreur réelle alerte dès la première ; seuls les délais de démarrage isolés sont tolérés', () => {
    expect(MIG).toContain("count(*) filter (where r.status = 'failed' and coalesce(r.return_message, '') <> 'job startup timeout') > 0");
    expect(MIG).toContain("count(*) filter (where r.status = 'failed' and r.return_message = 'job startup timeout') >= 3");
  });
});
