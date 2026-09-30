/**
 * « Attendre la réponse, au plus N jours » attend VRAIMENT (audit V2, D-07).
 *
 * Mesuré sur staging : l'attente était datée MAINTENANT (délai jamais
 * ajouté), tranchée au tick suivant → « pas de réponse » → relance une à cinq
 * minutes après au lieu de N jours. Et une réponse du client n'était vue qu'à
 * l'échéance. Aussi présent sur origin/main avant correction.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { clientEnregistreur, requetes } from '../quarantaine/automation/_enregistreur';
import { planifierEtape, type Etape } from '../../server/lib/automationSequences';
import { reveillerAttentesReponse } from '../../server/lib/automationEngine';

const ORG = '11111111-1111-4111-8111-111111111111';
const MAINTENANT = new Date('2026-10-01T15:00:00Z');

afterEach(() => vi.useRealTimers());

describe('D-07 — l’attente de réponse a une vraie échéance', () => {
  it('« au plus 1 jour » : la vérification est datée dans 24 h, pas maintenant', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(MAINTENANT);
    const { client, journal } = clientEnregistreur({ automation_scheduled_tasks: { data: null } });
    const etapes: Etape[] = [
      { id: 'e1', type: 'attendre', mode: 'reponse', delai_secondes: 86_400, si_reponse: null, suivant: 'e2' },
      { id: 'e2', type: 'action', action: { type: 'send_sms', config: { body: 'Relance' } } },
    ];
    await planifierEtape({ supabase: client, orgId: ORG, ruleId: 'r1', entityType: 'client', entityId: 'c1', contexte: {}, franchies: 0 }, etapes, 'e1');
    const tache = requetes(journal, 'automation_scheduled_tasks', 'insert')[0]?.valeur as { execute_at: string; step_id: string };
    expect(tache.step_id).toBe('e1');
    expect(tache.execute_at).toBe('2026-10-02T15:00:00.000Z');
  });

  it('une attente ordinaire avant elle s’additionne (2 j + au plus 1 j = 3 j)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(MAINTENANT);
    const { client, journal } = clientEnregistreur({ automation_scheduled_tasks: { data: null } });
    const etapes: Etape[] = [
      { id: 'e0', type: 'attendre', delai_secondes: 172_800, suivant: 'e1' },
      { id: 'e1', type: 'attendre', mode: 'reponse', delai_secondes: 86_400, si_reponse: null, suivant: null },
    ];
    await planifierEtape({ supabase: client, orgId: ORG, ruleId: 'r1', entityType: 'client', entityId: 'c1', contexte: {}, franchies: 0 }, etapes, 'e0');
    expect((requetes(journal, 'automation_scheduled_tasks', 'insert')[0]?.valeur as { execute_at: string }).execute_at).toBe('2026-10-04T15:00:00.000Z');
  });
});

describe('D-07 — une réponse du client réveille l’attente tout de suite', () => {
  it('seules les attentes de CE client passent à maintenant', async () => {
    const { client, journal } = clientEnregistreur({
      automation_scheduled_tasks: (req) => (req.op === 'select'
        ? { data: [
          { id: 't-marie', entity_type: 'client', entity_id: 'marie', execute_at: '2026-10-03T00:00:00Z' },
          { id: 't-paul', entity_type: 'client', entity_id: 'paul', execute_at: '2026-10-03T00:00:00Z' },
        ] }
        : { data: null }),
    });
    const n = await reveillerAttentesReponse(client, ORG, 'marie');
    expect(n).toBe(1);
    const maj = requetes(journal, 'automation_scheduled_tasks', 'update')[0];
    expect(maj.filtres).toContainEqual(['in', 'id', ['t-marie']]);
    expect(maj.filtres).toContainEqual(['eq', 'org_id', ORG]);
    // La lecture ne vise que les attentes de réponse, en attente, du bureau.
    const lecture = requetes(journal, 'automation_scheduled_tasks', 'select')[0];
    expect(lecture.filtres).toContainEqual(['eq', 'action_config->>mode', 'reponse']);
    expect(lecture.filtres).toContainEqual(['eq', 'status', 'pending']);
  });

  it('une lecture ratée ne lève pas : l’attente ira à son échéance', async () => {
    const { client } = clientEnregistreur({ automation_scheduled_tasks: { data: null, error: { message: 'connexion perdue' } } });
    const erreurs = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(reveillerAttentesReponse(client, ORG, 'marie')).resolves.toBe(0);
    erreurs.mockRestore();
  });
});
