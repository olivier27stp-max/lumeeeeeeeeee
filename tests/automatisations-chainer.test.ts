/**
 * DÉMARRER UNE AUTRE AUTOMATISATION — le « Add to Workflow » de GHL.
 *
 * Chaîner deux parcours plutôt que d'en bâtir un seul, énorme et
 * illisible : une soumission acceptée fait entrer le client dans le
 * parcours d'accueil, une facture payée démarre la demande d'avis.
 *
 * C'est une action qui en DÉCLENCHE d'autres — donc celle qui peut faire
 * le plus de dégâts si elle est mal gardée. Trois façons de mal tourner,
 * toutes silencieuses :
 *   · une règle qui se démarre elle-même → boucle infinie de messages ;
 *   · une règle d'une AUTRE entreprise → on écrit à ses clients ;
 *   · une règle en brouillon → des messages que personne n'a publiés.
 *
 * Mon document de catalogue annonçait cette action comme LIVRÉE alors
 * qu'elle n'existait pas. Ce fichier est ce qui rend l'annonce vraie.
 */

import { describe, it, expect } from 'vitest';
import { executeDemarrerAutomatisation } from '../server/lib/actions/index';

const ORG = '11111111-1111-1111-1111-111111111111';
const AUTRE_ORG = '22222222-2222-2222-2222-222222222222';
const CIBLE = '33333333-3333-3333-3333-333333333333';
const COURANTE = '44444444-4444-4444-4444-444444444444';
const CLIENT = '55555555-5555-5555-5555-555555555555';

/**
 * Un faux Supabase qui note ce qu'on lui demande.
 *
 * `regle` est ce que la lecture renverra ; `inserts` recueille les tâches
 * créées, parce que c'est là qu'est le VRAI effet de cette action.
 */
function faireSupabase(regle: unknown, erreurInsert?: { code?: string; message?: string }) {
  const filtres: Array<[string, unknown]> = [];
  const inserts: Array<Record<string, unknown>> = [];
  const client = {
    from(table: string) {
      if (table === 'automation_rules') {
        const chaine: Record<string, unknown> = {};
        chaine.select = () => chaine;
        chaine.eq = (k: string, v: unknown) => { filtres.push([k, v]); return chaine; };
        chaine.maybeSingle = () => Promise.resolve({ data: regle, error: null });
        return chaine;
      }
      return {
        insert: (ligne: Record<string, unknown>) => {
          inserts.push(ligne);
          return Promise.resolve({ error: erreurInsert ?? null });
        },
      };
    },
  };
  return { client, filtres, inserts };
}

const ctx = (sb: { client: unknown }) => ({
  supabase: sb.client,
  orgId: ORG,
  entityType: 'client',
  entityId: CLIENT,
  twilio: null,
  baseUrl: 'https://exemple.test',
  ruleId: COURANTE,
}) as never;

const REGLE_OK = {
  id: CIBLE,
  name: 'Parcours d’accueil',
  is_active: true,
  deleted_at: null,
  actions: [
    { type: 'send_email', config: { subject: 'Bienvenue', body: 'Bonjour' } },
    { type: 'create_task', config: { title: 'Appeler' } },
  ],
};

describe('ce que « démarrer une automatisation » refuse', () => {
  it('se démarrer SOI-MÊME est refusé — sinon boucle infinie', async () => {
    /*
     * La faute qui coûte le plus cher : la règle se rappelle, chaque appel
     * en relance un autre, et le client reçoit des messages sans fin. Le
     * moteur a trois gardes contre les boucles DANS un parcours ; il faut
     * la même chose ENTRE parcours.
     */
    const sb = faireSupabase(REGLE_OK);
    const r = await executeDemarrerAutomatisation({ rule_id: COURANTE }, {}, ctx(sb));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/elle-même/i);
    expect(sb.inserts, 'rien ne doit être planifié').toHaveLength(0);
  });

  it('une règle d’une AUTRE organisation est introuvable', async () => {
    // La lecture filtre `org_id` : la règle d'une autre entreprise ne
    // remonte pas, donc on ne peut pas écrire à ses clients.
    const sb = faireSupabase(null);
    const r = await executeDemarrerAutomatisation({ rule_id: CIBLE }, {}, ctx(sb));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/introuvable/i);
    expect(sb.filtres.some(([k, v]) => k === 'org_id' && v === ORG),
      'l’org doit être filtrée à la lecture').toBe(true);
    expect(sb.inserts).toHaveLength(0);
  });

  it('une règle À LA CORBEILLE ne se démarre pas', async () => {
    const sb = faireSupabase({ ...REGLE_OK, deleted_at: '2026-09-25T00:00:00Z' });
    const r = await executeDemarrerAutomatisation({ rule_id: CIBLE }, {}, ctx(sb));
    expect(r.success).toBe(false);
    expect(sb.inserts).toHaveLength(0);
  });

  it('une règle en BROUILLON ne se démarre pas, et le dit', async () => {
    /*
     * Un brouillon n'envoie rien. Créer ses tâches quand même donnerait
     * des messages que personne n'a publiés — et le silence serait pire
     * qu'un refus.
     */
    const sb = faireSupabase({ ...REGLE_OK, is_active: false });
    const r = await executeDemarrerAutomatisation({ rule_id: CIBLE }, {}, ctx(sb));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/brouillon/i);
    expect(r.error, 'le nom aide à comprendre laquelle').toMatch(/Parcours d’accueil/);
    expect(sb.inserts).toHaveLength(0);
  });

  it('sans automatisation choisie, refus net', async () => {
    const sb = faireSupabase(REGLE_OK);
    for (const config of [{}, { rule_id: '' }, { rule_id: '   ' }]) {
      const r = await executeDemarrerAutomatisation(config, {}, ctx(sb));
      expect(r.success, JSON.stringify(config)).toBe(false);
    }
    expect(sb.inserts).toHaveLength(0);
  });

  it('une règle SANS action ne crée rien', async () => {
    const sb = faireSupabase({ ...REGLE_OK, actions: [] });
    const r = await executeDemarrerAutomatisation({ rule_id: CIBLE }, {}, ctx(sb));
    expect(r.success).toBe(false);
    expect(sb.inserts).toHaveLength(0);
  });
});

describe('ce qu’elle fait quand tout va bien', () => {
  it('inscrit l’entité sur CHAQUE action de la règle visée', async () => {
    const sb = faireSupabase(REGLE_OK);
    const r = await executeDemarrerAutomatisation({ rule_id: CIBLE }, {}, ctx(sb));
    expect(r.success).toBe(true);
    expect(sb.inserts, 'une tâche par action').toHaveLength(2);

    for (const t of sb.inserts) {
      expect(t.org_id).toBe(ORG);
      expect(t.automation_rule_id, 'la règle VISÉE, pas la courante').toBe(CIBLE);
      expect(t.entity_id, 'la même entité que le parcours en cours').toBe(CLIENT);
      expect(t.entity_type).toBe('client');
      expect(t.status).toBe('pending');
    }
  });

  it('la clé d’exécution suit le format du moteur — c’est l’anti-doublon', async () => {
    /*
     * `règle:entité:index`, exactement comme `buildExecutionKey` dans
     * automationEngine.ts. L'index unique de `automation_scheduled_tasks`
     * fait alors le travail : deux parcours qui démarrent le même
     * troisième sur le même client ne l'inscrivent qu'une fois.
     */
    const sb = faireSupabase(REGLE_OK);
    await executeDemarrerAutomatisation({ rule_id: CIBLE }, {}, ctx(sb));
    expect(sb.inserts.map((t) => t.execution_key)).toEqual([
      `${CIBLE}:${CLIENT}:0`,
      `${CIBLE}:${CLIENT}:1`,
    ]);
  });

  it('un DOUBLON n’est pas une erreur — c’est la garde qui fonctionne', async () => {
    // 23505 = violation de l'index unique. Le client est déjà inscrit :
    // signaler un échec ferait paraître le parcours cassé alors qu'il est
    // exactement dans l'état voulu.
    const sb = faireSupabase(REGLE_OK, { code: '23505', message: 'duplicate key' });
    const r = await executeDemarrerAutomatisation({ rule_id: CIBLE }, {}, ctx(sb));
    expect(r.success).toBe(true);
    expect((r.data as { inscrites: number }).inscrites, 'aucune nouvelle inscription').toBe(0);
  });

  it('une VRAIE erreur de base remonte, elle', async () => {
    const sb = faireSupabase(REGLE_OK, { code: '42501', message: 'permission denied' });
    const r = await executeDemarrerAutomatisation({ rule_id: CIBLE }, {}, ctx(sb));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/permission denied/);
  });
});

describe('le catalogue annonce ce qui existe vraiment', () => {
  it('l’action est offerte et pointe vers un exécuteur réel', async () => {
    const { ACTIONS } = await import('../src/lib/automationCatalogue');
    const a = ACTIONS.find((x) => x.cle === 'demarrer_automatisation');
    expect(a, 'l’action doit être au catalogue').toBeDefined();
    expect(a!.champs?.[0]?.cle).toBe('rule_id');
    expect(a!.champs?.[0]?.obligatoire, 'sans cible, rien à démarrer').toBe(true);
    expect(a!.champs?.[0]?.type, 'une liste, pas un identifiant à taper').toBe('automatisation');
  });
});
