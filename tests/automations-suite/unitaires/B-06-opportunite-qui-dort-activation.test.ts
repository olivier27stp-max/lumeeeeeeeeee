/**
 * B-06 — activer « Opportunité qui dort » n'écrit pas d'un coup à toutes les
 * opportunités DÉJÀ dormantes (mission finale, point 10 : par défaut, une
 * automatisation ne réagit qu'à ce qui arrive après son activation).
 */
import { describe, it, expect } from 'vitest';
import { fauxSupabase } from './_faux-supabase';
import {
  dateActivation, anterieurALActivation, casAnterieurALActivation, decalerMois, ignoreLesCasExistants,
} from '../../../server/lib/automations-activation';

const ORG = '11111111-1111-4111-8111-111111111111';
const JOUR = 86_400_000;
const T = Date.parse('2026-10-05T15:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

describe('[point 10] depuis quand une règle est active', () => {
  it('`activee_le` d’abord ; sans la colonne (migration pas encore appliquée), `updated_at` ; sinon inconnu', () => {
    expect(dateActivation({ activee_le: iso(T), updated_at: iso(T + JOUR) })).toBe(T);
    expect(dateActivation({ updated_at: iso(T) })).toBe(T);
    expect(dateActivation({})).toBeNull();
    expect(dateActivation(null)).toBeNull();
  });

  it('un cas franchi AVANT l’activation est ignoré ; après, il compte ; date d’activation inconnue : on ne conclut pas', () => {
    const regle = { activee_le: iso(T) };
    expect(anterieurALActivation(regle, T - 1)).toBe(true);
    expect(anterieurALActivation(regle, T)).toBe(false);
    expect(anterieurALActivation(regle, T + JOUR)).toBe(false);
    expect(anterieurALActivation({}, T - JOUR)).toBe(false);
  });

  it('le défaut de la mission : les cas existants sont ignorés (l’option « les inclure » n’est pas bâtie — son seul point de branchement)', () => {
    expect(ignoreLesCasExistants({ activee_le: iso(T) })).toBe(true);
  });

  it('les mois se comptent en mois civils, comme en base (31 août − 6 mois = 28 février)', () => {
    expect(iso(decalerMois(Date.parse('2026-08-31T12:00:00Z'), -6))).toBe('2026-02-28T12:00:00.000Z');
    expect(iso(decalerMois(Date.parse('2026-03-15T12:00:00Z'), 6))).toBe('2026-09-15T12:00:00.000Z');
  });
});

describe('[B-06] « Opportunité qui dort » : le seuil doit être franchi APRÈS l’activation', () => {
  const evenement = (jours = 7) => ({ type: 'deal.stage_idle', orgId: ORG, entityId: 'o1', metadata: { idle_days: jours, rule_id: 'r1' } });
  const deal = (activite: number) => fauxSupabase({ deals: [{ id: 'o1', org_id: ORG, last_activity_at: iso(activite) }] }).client;
  const regle = { activee_le: iso(T), conditions: { idle_days: 7 } };

  it('opportunité sans mouvement depuis 30 jours quand on active la règle « 7 jours » : ignorée, avec sa phrase', async () => {
    expect(await casAnterieurALActivation(deal(T - 30 * JOUR), regle, evenement()))
      .toBe('L’opportunité était déjà sans mouvement avant l’activation de l’automatisation');
  });

  it('opportunité qui franchit ses 7 jours APRÈS l’activation (dernière activité 6 jours avant) : la règle réagit', async () => {
    expect(await casAnterieurALActivation(deal(T - 6 * JOUR), regle, evenement())).toBeNull();
  });

  it('le seuil lu est celui de la RÈGLE (« 3 jours »), pas un défaut', async () => {
    const trois = { activee_le: iso(T), conditions: { idle_days: 3 } };
    // Dernière activité il y a 5 jours : pour « 3 jours », déjà dormante avant ; pour « 7 jours », pas encore.
    expect(await casAnterieurALActivation(deal(T - 5 * JOUR), trois, evenement(3))).not.toBeNull();
    expect(await casAnterieurALActivation(deal(T - 5 * JOUR), regle, evenement())).toBeNull();
  });

  it('opportunité illisible (panne de lecture) : on ne fait pas taire la règle', async () => {
    const sb = fauxSupabase({ deals: [] }, { erreurs: { deals: 'timeout' } });
    expect(await casAnterieurALActivation(sb.client, regle, evenement())).toBeNull();
  });

  it('les AUTRES déclencheurs n’entrent jamais ici : aucune lecture (chemin immédiat intact)', async () => {
    const sb = fauxSupabase({ deals: [{ id: 'o1', org_id: ORG, last_activity_at: iso(T - 30 * JOUR) }] });
    for (const type of ['quote.sent', 'invoice.overdue', 'deal.stage_entered', 'note.added', 'date.reached']) {
      expect(await casAnterieurALActivation(sb.client, regle, { type, orgId: ORG, entityId: 'o1', metadata: {} })).toBeNull();
    }
    expect(sb.requetes).toHaveLength(0);
  });
});

describe('[B-06] dans le moteur : l’événement d’une opportunité déjà dormante n’exécute rien, et le journal dit pourquoi', () => {
  it('une ligne « anterieur_activation », aucune action', async () => {
    const { initAutomationEngine } = await import('../../../server/lib/automationEngine');
    const { eventBus } = await import('../../../server/lib/eventBus');
    const sb = fauxSupabase({
      company_settings: [{ org_id: ORG, timezone: 'America/Toronto', automations_paused: false }],
      automation_rules: [{
        id: 'r1', org_id: ORG, name: 'Sans mouvement', trigger_event: 'deal.stage_idle', is_active: true, deleted_at: null,
        conditions: { idle_days: 7 }, delay_seconds: 0, actions: [{ type: 'create_task', config: { title: 'Relancer' } }], steps: null,
        activee_le: new Date().toISOString(),
      }],
      deals: [{ id: 'o1', org_id: ORG, last_activity_at: new Date(Date.now() - 30 * JOUR).toISOString() }],
    });
    eventBus.removeAllListeners();
    initAutomationEngine({ supabase: sb.client, twilio: null as never, baseUrl: 'http://t' });
    await eventBus.emit('deal.stage_idle', { orgId: ORG, entityType: 'deal', entityId: 'o1', metadata: { idle_days: 7, rule_id: 'r1' } });
    await new Promise((r) => setTimeout(r, 300));
    expect(sb.tables.tasks ?? []).toHaveLength(0);
    const lignes = sb.tables.automation_execution_logs ?? [];
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      automation_rule_id: 'r1', entity_id: 'o1', result_success: true,
      result_data: { saute_code: 'anterieur_activation', saute: 'L’opportunité était déjà sans mouvement avant l’activation de l’automatisation' },
    });
  });
});
