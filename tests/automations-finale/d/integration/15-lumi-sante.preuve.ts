/**
 * Agent D — point 4 : Lumi donne-t-elle les mêmes chiffres que l'écran ?
 *
 * L'outil `get_automation_health` (vraie garde, jeton du propriétaire A) résume les 100
 * dernières lignes du journal. Le jeu connu en compte 27 : il les lit donc toutes.
 * Relit le manifeste du jeu (lancer 10-jeu-connu d'abord).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { demarrerMoteur } from '../../../automations-suite/harnais/moteur';
import { sessionDe, COMPTES } from '../../../automations-suite/harnais/bureau-test';
import { lireManifeste, veriteRegle, type Manifeste } from '../jeu-connu';

let b: Awaited<ReturnType<typeof demarrerMoteur>>;
let jeu: Manifeste;
let clientA: SupabaseClient;

beforeAll(async () => {
  b = await demarrerMoteur();
  jeu = lireManifeste();
  const { jeton } = await sessionDe(b.admin, COMPTES.proprioA.email);
  const { buildSupabaseWithAuth } = await import('../../../../server/lib/supabase');
  clientA = buildSupabaseWithAuth(`Bearer ${jeton}`, b.orgA);
});

describe('D — Lumi (get_automation_health) contre le jeu connu', () => {
  it('[D-21] « sautés » ne compte pas les règles écartées par leurs conditions — même définition que l’écran', async () => {
    const { executerOutilGarde } = await import('../../../../server/lib/agent/garde');
    const r = await executerOutilGarde({ name: 'get_automation_health', args: {}, userId: b.users.proprioA, orgId: b.orgA, client: clientA });
    if ('refus' in r) throw new Error(`refus : ${r.refus}`);
    const sante = r.result as { sur_les_dernieres: number; partis: number; sautes: number; echoues: number };

    // La vérité de la base, toutes dates (l'outil n'a pas de fenêtre) : somme sur les règles du jeu.
    const somme = { reussis: 0, sautes: 0, echecs: 0, ecartes: 0 };
    for (const regle of Object.values(jeu.regles)) {
      const v = await veriteRegle(b.admin, regle.id, 365);
      somme.reussis += v.reussis; somme.sautes += v.sautes; somme.echecs += v.echecs; somme.ecartes += v.ecartes;
    }
    expect(sante.sur_les_dernieres, 'le jeu tient dans les 100 lignes lues').toBe(somme.reussis + somme.sautes + somme.echecs + somme.ecartes);
    expect({ partis: sante.partis, echoues: sante.echoues }).toEqual({ partis: somme.reussis, echoues: somme.echecs });
    // L'écran (route de statistiques) ne compte pas une règle écartée parmi les étapes sautées ; Lumi, si.
    expect(sante.sautes, `Lumi : ${sante.sautes} sautés ; base : ${somme.sautes} envois sautés + ${somme.ecartes} règles écartées`).toBe(somme.sautes);
  });
});
