/**
 * « Envoyer dans Slack » ne publie JAMAIS dans le Slack de Lume (audit V2,
 * 2026-09-29).
 *
 * L'écran promettait « le canal Slack de votre entreprise », mais aucune
 * connexion Slack par entreprise n'existe : le serveur publiait dans
 * `canalSupport()`, le canal de support INTERNE de Lume. Les messages d'un
 * client (noms, suivis) y seraient arrivés. Aucune règle de prod ne s'en
 * servait encore (0 au 2026-09-29).
 */
import { describe, it, expect, vi } from 'vitest';

const envois: unknown[] = [];
vi.mock('../server/lib/slack', () => ({
  isSlackConfigured: () => true,
  canalSupport: () => 'C_SUPPORT_LUME',
  envoyerMessageSlack: async (m: unknown) => { envois.push(m); },
}));

import { executeEnvoyerSlack } from '../server/lib/actions';
import { ACTIONS, actionCompatible, problemesAvantPublication, trouverAction } from '../src/lib/automationCatalogue';
import { consignes } from '../server/lib/lumi/generer-parcours';

const slack = trouverAction('envoyer_slack')!;

describe('Envoyer dans Slack — pas encore disponible, et le dit', () => {
  it('le serveur ne publie nulle part, surtout pas dans le canal de support de Lume', async () => {
    const r = await executeEnvoyerSlack({ body: 'Suivi : Marie Tremblay' }, {}, { orgId: 'o', entityType: 'client', entityId: 'c' } as never);
    expect(envois).toEqual([]);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/pas encore disponible/);
  });

  it('le catalogue la marque indisponible, avec la raison dans les deux langues', () => {
    // Le sélecteur et le tiroir de l'éditeur lisent ce champ pour la griser.
    expect(slack.indisponible?.fr).toMatch(/Slack/);
    expect(slack.indisponible?.en).toMatch(/Slack/);
    // « Compatible avec le déclencheur » reste une autre question.
    expect(actionCompatible(slack, 'quote.sent')).toBe(true);
  });

  it('la publication la refuse avec la vraie raison', () => {
    const problemes = problemesAvantPublication({
      trigger_event: 'quote.sent',
      actions: [{ type: 'envoyer_slack', config: { body: 'x' } }],
      steps: [],
    });
    expect(problemes.some((p) => p.gravite === 'bloquant' && /n’existe pas encore/.test(p.message))).toBe(true);
  });

  it('Lumi ne la connaît pas', () => {
    expect(consignes(true)).not.toMatch(/envoyer_slack/);
    // Et les autres actions restent proposées.
    expect(ACTIONS.filter((a) => !a.indisponible).length).toBeGreaterThan(10);
  });
});
