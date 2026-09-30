/**
 * Vague 3 (audit V2, « Journaux », Moyenne) — un membre sans droit sur les
 * automatisations ne lit plus les journaux d'exécution de tout le bureau, ni
 * les destinataires.
 *
 * Preuve sous de vraies sessions (staging, 2026-09-30, avant / après la
 * migration 20261004100000) : le vendeur `membre-sans` (leads.read, pas
 * automations.read) lisait 166 journaux dont 30 avec un courriel ou un
 * téléphone ; après : 0 journal par la table, et l'onglet « Relances » de la
 * fiche d'un deal rend ses 7 relances par `relances_du_deal`, sans aucune
 * donnée de contact. Propriétaire et membre avec automations.read : 166
 * inchangé. Technicien : 0.
 *
 * Ici : ce qui se vérifie sans base — le contenu de la migration et le
 * chemin qu'emprunte l'onglet.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rpc = vi.hoisted(() => vi.fn(async (_nom: string, _args: unknown) => ({ data: [{ id: 'l1', action_type: 'send_sms', result_success: true, result_error: null, trigger_event: 'deal.stage_entered', created_at: '2026-09-30T12:00:00Z', entity_id: 'deal-1' }], error: null })));
const from = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/supabase', () => ({ supabase: { rpc, from } }));
vi.mock('../src/lib/orgApi', () => ({ getCurrentOrgIdOrThrow: async () => 'org-a' }));
vi.mock('../src/lib/clientsApi', () => ({ listClients: async () => [] }));

const MIG = readFileSync(resolve(__dirname, '../supabase/migrations/20261004100000_journaux_automatisations_prospects.sql'), 'utf8');
const sansCommentaires = MIG.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('migration 20261004100000 — journaux réservés à « Voir les automatisations »', () => {
  it('la policy de lecture ne mentionne plus leads.read', () => {
    const policy = /create policy automation_execution_logs_select_org[\s\S]*?;/.exec(sansCommentaires)?.[0] ?? '';
    expect(policy).toContain("'automations.read'");
    expect(policy).not.toContain('leads.read');
  });

  it('relances_du_deal ne rend aucune colonne de contact et masque le motif d’échec', () => {
    const corps = /create or replace function public\.relances_du_deal[\s\S]*?\$\$;/.exec(sansCommentaires)?.[0] ?? '';
    expect(corps).toContain('security definer');
    expect(corps).toContain('set search_path');
    expect(corps).not.toMatch(/\baction_config\b/);
    expect(corps).not.toMatch(/\bresult_data\b/);
    expect(corps).toContain('[courriel]');
    expect(corps).toContain('[téléphone]');
    // Mêmes conditions que la policy des deals + une des deux permissions.
    expect(corps).toContain('peut_voir_pipeline(auth.uid(), dl.pipeline_id)');
    expect(corps).toContain("member_has_permission(auth.uid(), dl.org_id, 'leads.read')");
    expect(corps).toContain('bureau_actif_demande()');
    // Seulement le deal et son contact.
    expect(corps).toContain("l.entity_type = 'deal' and l.entity_id = d.id");
    expect(corps).toContain("l.entity_type in ('client', 'lead') and l.entity_id = d.client_id");
  });

  it('fermée à anon, ouverte à authenticated', () => {
    expect(sansCommentaires).toContain('revoke execute on function public.relances_du_deal(uuid) from public, anon;');
    expect(sansCommentaires).toContain('grant execute on function public.relances_du_deal(uuid) to authenticated;');
  });

  it('un bloc DOWN est fourni', () => {
    expect(MIG).toContain('-- DOWN');
    expect(MIG).toContain('-- drop function if exists public.relances_du_deal(uuid);');
  });
});

describe('onglet « Relances » de la fiche d’un deal', () => {
  it('passe par relances_du_deal, jamais par la table des journaux', async () => {
    const { fetchRelances } = await import('../src/lib/pipelineVentesApi');
    const r = await fetchRelances('deal-1');
    expect(rpc).toHaveBeenCalledWith('relances_du_deal', { p_deal_id: 'deal-1' });
    expect(from).not.toHaveBeenCalledWith('automation_execution_logs');
    expect(r).toEqual([{ id: 'l1', action: 'send_sms', reussi: true, erreur: null, declencheur: 'deal.stage_entered', created_at: '2026-09-30T12:00:00Z' }]);
  });

  it('aucun code client ne lit la table pour un vendeur', () => {
    const src = readFileSync(resolve(__dirname, '../src/lib/pipelineVentesApi.ts'), 'utf8');
    expect(src).not.toContain(".from('automation_execution_logs')");
  });
});
