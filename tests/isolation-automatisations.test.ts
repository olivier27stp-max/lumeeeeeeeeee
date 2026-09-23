/**
 * Cliquet d'isolation multi-tenant du moteur d'automatisations (2026-09-23).
 * ──────────────────────────────────────────────────────────────────────────
 * Le moteur tourne en `service_role`, qui CONTOURNE la RLS. Le filtre
 * `org_id` écrit à la main est donc la seule barrière entre deux clients.
 *
 * Il manquait sur 17 des 18 lectures. Prouvé sur staging avant correction :
 * `.from('clients').select(...).eq('id', X)` — sans `org_id` — renvoyait la
 * fiche d'un client d'une AUTRE organisation, nom et courriel compris. Et
 * `entityId` venait de `req.body` sur `POST /api/workflows/execute-action` :
 * un utilisateur authentifié pouvait faire lire les données d'un autre
 * locataire, puis se les faire envoyer par texto via une action.
 *
 * Ce test est un CLIQUET, pas une démonstration : il relit le source et
 * échoue si une nouvelle lecture d'entité oublie le filtre. Une revue de code
 * ne rattrapera pas un `.eq('id', …)` isolé dans 1 400 lignes — un test, oui.
 *
 * Pourquoi lire le source plutôt que d'exécuter : ces lectures traversent
 * PostgREST, et les simuler demanderait un faux client dont la fidélité
 * deviendrait elle-même une hypothèse. Le fait vérifiable ici est textuel —
 * « chaque lecture d'une table multi-tenant porte org_id » — et c'est
 * exactement ce qui manquait.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Tables portant `org_id` et lues par le moteur avec un id fourni de l'extérieur. */
const TABLES_MULTI_TENANT = [
  'clients', 'jobs', 'invoices', 'quotes', 'schedule_events', 'job_agreements',
];

const FICHIERS = [
  'server/lib/actions/index.ts',
  'server/lib/automationEngine.ts',
];

/**
 * Découpe les chaînes `.from('table')…` jusqu'au terminateur de requête.
 * On s'arrête à `maybeSingle`/`single`/`limit`/`;` : au-delà, on lirait la
 * requête suivante et un `org_id` voisin masquerait l'oubli.
 */
function lecturesDe(source: string, table: string): Array<{ ligne: number; scope: boolean; extrait: string }> {
  const re = new RegExp(
    `\\.from\\('${table}'\\)[\\s\\S]{0,500}?(?=\\.maybeSingle\\(\\)|\\.single\\(\\)|\\.limit\\(|;)`,
    'g',
  );
  const out: Array<{ ligne: number; scope: boolean; extrait: string }> = [];
  for (const m of source.matchAll(re)) {
    const bloc = m[0];
    // Seules les lectures par identifiant nous intéressent : un `.eq('org_id')`
    // seul, ou un filtre par `client_id` dans une requête déjà scopée, ne
    // posent pas le même risque que « va chercher CET id, où qu'il soit ».
    if (!/\.eq\('id',|\.eq\('job_id',|\.eq\('client_id',/.test(bloc)) continue;
    out.push({
      ligne: source.slice(0, m.index ?? 0).split('\n').length,
      // Le verdict porte sur le bloc ENTIER ; `extrait` n'est qu'un affichage.
      // (Juger sur l'extrait tronqué signalait des requêtes correctes dont le
      // `org_id` tombait au-delà des 110 caractères.)
      scope: /\.eq\('org_id'/.test(bloc),
      extrait: bloc.replace(/\s+/g, ' ').slice(0, 110),
    });
  }
  return out;
}

describe('toute lecture d\'entité porte org_id — le service_role ignore la RLS', () => {
  for (const fichier of FICHIERS) {
    it(`${fichier}`, () => {
      const source = readFileSync(resolve(__dirname, '..', fichier), 'utf8');
      const fautifs: string[] = [];
      for (const table of TABLES_MULTI_TENANT) {
        for (const { ligne, scope, extrait } of lecturesDe(source, table)) {
          if (!scope) fautifs.push(`  ${fichier}:${ligne} — ${extrait}`);
        }
      }
      expect(
        fautifs,
        `lecture(s) sans filtre org_id — le moteur tourne en service_role, la RLS ne protège pas :\n${fautifs.join('\n')}`,
      ).toEqual([]);
    });
  }

  it('le détecteur attrape bien une lecture fautive (sinon il ne prouve rien)', () => {
    // Un test de garde qui ne peut pas échouer est un test qui ment : on
    // vérifie que le motif repère un oubli réel.
    const fautif = `const { data } = await supabase.from('clients').select('email').eq('id', entityId).maybeSingle();`;
    const trouve = lecturesDe(fautif, 'clients');
    expect(trouve).toHaveLength(1);
    expect(trouve[0].scope).toBe(false);

    const correct = `const { data } = await supabase.from('clients').select('email').eq('id', entityId).eq('org_id', orgId).maybeSingle();`;
    expect(lecturesDe(correct, 'clients')[0].scope).toBe(true);
  });
});
