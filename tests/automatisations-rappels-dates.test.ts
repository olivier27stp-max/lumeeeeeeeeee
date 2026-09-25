/**
 * LES RAPPELS SUR DATE — fin de contrat, garantie, entretien annuel.
 *
 * Le déclencheur qui rapporte le plus dans une entreprise de services :
 * une date écrite une fois, et le rappel part tout seul un an plus tard.
 *
 * Trois choses peuvent mal tourner, et chacune est silencieuse :
 *   · le mauvais JOUR (fuseau du serveur au lieu de celui de l'entreprise :
 *     à Montréal, un balayage à 20 h UTC est déjà « demain ») ;
 *   · une règle qui lit les dates d'une AUTRE organisation ;
 *   · un message envoyé à un client supprimé.
 *
 * Ce fichier tient la garde sur les trois.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { balayerRappelsDates, jourLocal, jourDecale } from '../server/lib/rappels-dates';
import { problemesAvantPublication } from '../src/lib/automationCatalogue';

const RACINE = resolve(__dirname, '..');
const source = readFileSync(resolve(RACINE, 'server/lib/rappels-dates.ts'), 'utf8');

/**
 * Un faux Supabase qui enregistre ce qu'on lui demande et répond ce qu'on
 * lui dit de répondre.
 */
function faireSupabase(reponses: Record<string, unknown> = {}) {
  const journal: Array<{ table: string; filtres: Array<[string, unknown]> }> = [];
  return {
    journal,
    client: {
      from(table: string) {
        const entree = { table, filtres: [] as Array<[string, unknown]> };
        journal.push(entree);
        const chaine: Record<string, unknown> = {};
        for (const m of ['eq', 'limit', 'is']) {
          chaine[m] = (a: unknown, b?: unknown) => { entree.filtres.push([String(a), b]); return chaine; };
        }
        chaine.select = () => {
          const p = Promise.resolve({ data: reponses[table] ?? [], error: null });
          return Object.assign(chaine, { then: p.then.bind(p) });
        };
        chaine.maybeSingle = () => Promise.resolve({
          data: (reponses[`${table}.single`] ?? null), error: null,
        });
        return chaine;
      },
    },
  };
}

describe('le jour se juge dans le fuseau de l’entreprise', () => {
  it('« aujourd’hui » suit Montréal, pas le serveur', () => {
    /*
     * Railway tourne en UTC. Le 15 septembre à 23 h à Montréal, il est déjà
     * le 16 en UTC : un balayage naïf sauterait une journée entière de
     * rappels, une fois par jour, sans que rien n'échoue.
     */
    const soirMontreal = new Date('2026-09-15T23:30:00-04:00');
    expect(jourLocal(soirMontreal)).toBe('2026-09-15');
  });

  it('le décalage compte en jours civils', () => {
    const base = new Date('2026-09-15T12:00:00-04:00');
    expect(jourDecale(0, base)).toBe('2026-09-15');
    expect(jourDecale(-7, base)).toBe('2026-09-08');
    expect(jourDecale(30, base)).toBe('2026-10-15');
  });

  it('le fuseau est écrit une fois, pas deviné à chaque appel', () => {
    expect(source).toMatch(/America\/Toronto/);
    // `new Date().toISOString().slice(0,10)` donnerait le jour UTC : c'est
    // exactement le bug qu'on évite.
    expect(source, 'pas de date UTC tronquée à la main')
      .not.toMatch(/toISOString\(\)\.slice\(0,\s*10\)/);
  });
});

describe('le SENS du décalage — la faute qui ne se voit pas', () => {
  it('« 7 jours avant » cherche les dates dans 7 JOURS, pas il y a 7 jours', async () => {
    /*
     * Mesuré contre la vraie base : avec le signe inversé, le balayage
     * cherchait les dates de la semaine PASSÉE. Résultat : 0 émis sur une
     * donnée pourtant présente, et aucune erreur nulle part.
     *
     * On vérifie le JOUR effectivement demandé à la base, pas la formule —
     * c'est le seul moyen de ne pas se refaire prendre.
     */
    const sb = faireSupabase({
      automation_rules: [{ id: 'r1', org_id: 'org-A', conditions: { champ_id: 'col-1', jours_avant: 7 } }],
      'custom_fields.single': { object_type: 'client', field_type: 'date', archived_at: null },
      custom_field_values: [],
    });
    await balayerRappelsDates(sb.client as never, new Date('2026-09-15T12:00:00-04:00'));

    const lecture = sb.journal.find((e) => e.table === 'custom_field_values');
    const jour = lecture?.filtres.find(([k]) => k === 'value_date')?.[1];
    expect(jour, '7 jours APRÈS le 15 septembre').toBe('2026-09-22');
  });

  it('un décalage nul vise aujourd’hui', async () => {
    const sb = faireSupabase({
      automation_rules: [{ id: 'r1', org_id: 'org-A', conditions: { champ_id: 'col-1', jours_avant: 0 } }],
      'custom_fields.single': { object_type: 'client', field_type: 'date', archived_at: null },
      custom_field_values: [],
    });
    await balayerRappelsDates(sb.client as never, new Date('2026-09-15T12:00:00-04:00'));
    const lecture = sb.journal.find((e) => e.table === 'custom_field_values');
    expect(lecture?.filtres.find(([k]) => k === 'value_date')?.[1]).toBe('2026-09-15');
  });

  it('un champ qui ne porte pas sur les CLIENTS est ignoré', async () => {
    /*
     * `custom_fields.object_type` vaut client, deal, job, quote ou invoice
     * — au SINGULIER (enum `cf_object_type`, relevé dans le catalogue le
     * 2026-09-24). Sur un champ de `job`, `custom_field_values.client_id`
     * est nul : le balayage ne trouverait jamais rien, silencieusement.
     */
    const sb = faireSupabase({
      automation_rules: [{ id: 'r1', org_id: 'org-A', conditions: { champ_id: 'col-1', jours_avant: 7 } }],
      'custom_fields.single': { object_type: 'job', field_type: 'date', archived_at: null },
    });
    const r = await balayerRappelsDates(sb.client as never);
    expect(r.emis).toBe(0);
    expect(sb.journal.some((e) => e.table === 'custom_field_values'), 'aucune lecture de dates').toBe(false);
  });
});

describe('le balayage ne sort jamais de son organisation', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('filtre `org_id` sur les valeurs de dates', async () => {
    /*
     * Le balayage tourne avec le client service_role : la RLS ne s'applique
     * PAS. Sans ce filtre explicite, une règle lirait les dates de toutes
     * les entreprises — et enverrait des messages à leurs clients.
     */
    const sb = faireSupabase({
      automation_rules: [{ id: 'r1', org_id: 'org-A', conditions: { champ_id: 'col-1', jours_avant: 7 } }],
      'custom_fields.single': { object_type: 'client', field_type: 'date', archived_at: null },
      custom_field_values: [],
    });
    await balayerRappelsDates(sb.client as never);

    const lectureValeurs = sb.journal.find((e) => e.table === 'custom_field_values');
    expect(lectureValeurs, 'le balayage doit lire les valeurs').toBeDefined();
    const orgFiltre = lectureValeurs!.filtres.find(([k]) => k === 'org_id');
    expect(orgFiltre?.[1], 'l’org de la RÈGLE, jamais une autre').toBe('org-A');
  });

  it('ne traite que les règles ACTIVES', async () => {
    // Une règle en brouillon ne doit rien envoyer.
    const sb = faireSupabase({ automation_rules: [] });
    await balayerRappelsDates(sb.client as never);
    const lecture = sb.journal.find((e) => e.table === 'automation_rules');
    expect(lecture!.filtres.some(([k, v]) => k === 'is_active' && v === true)).toBe(true);
  });
});

describe('ce que le balayage refuse d’envoyer', () => {
  it('une règle sans champ date visé est ignorée, pas plantée', async () => {
    const sb = faireSupabase({
      automation_rules: [{ id: 'r1', org_id: 'org-A', conditions: {} }],
    });
    const r = await balayerRappelsDates(sb.client as never);
    expect(r.emis).toBe(0);
    expect(r.erreurs, 'une règle mal réglée n’est pas une erreur système').toBe(0);
    // Et elle n'a pas déclenché de lecture de dates.
    expect(sb.journal.some((e) => e.table === 'custom_field_values')).toBe(false);
  });

  it('un client SUPPRIMÉ ne reçoit rien', () => {
    /*
     * Une date survit à son client. Écrire à quelqu'un qui a demandé son
     * effacement serait une faute — et invisible, puisque l'envoi
     * « réussirait ».
     */
    expect(source).toMatch(/deleted_at/);
    expect(source).toMatch(/if \(!client \|\| client\.deleted_at\) continue/);
  });

  it('le décalage est borné', () => {
    // Une faute de frappe (« 3650 ») ferait balayer dix ans de dates.
    expect(source).toMatch(/Math\.max\(-365, Math\.min\(365/);
  });

  it('une organisation en erreur n’empêche pas les autres', () => {
    // Le genre de panne qui passe inaperçue parce qu'elle n'affecte qu'un
    // client : la boucle doit continuer.
    const boucle = source.slice(source.indexOf('for (const regle of regles)'));
    expect(boucle).toMatch(/try \{/);
    expect(boucle).toMatch(/les autres continuent/);
  });
});

describe('le cron est branché', () => {
  const cron = readFileSync(resolve(RACINE, 'server/routes/cron.ts'), 'utf8');

  it('la route existe et est protégée', () => {
    expect(cron).toMatch(/cron\/rappels-dates/);
    const route = cron.slice(cron.indexOf("'/cron/rappels-dates'"));
    expect(route.slice(0, 300), 'un cron ouvert serait déclenchable par n’importe qui')
      .toMatch(/checkCronAuth/);
  });

  it('elle utilise le client service_role', () => {
    // Le balayage lit les dates de toutes les orgs : il ne peut pas passer
    // par une session utilisateur.
    const route = cron.slice(cron.indexOf("'/cron/rappels-dates'"));
    expect(route.slice(0, 400)).toMatch(/getServiceClient/);
  });
});

describe('les NOMS de tables — la faute que les mocks ne voient pas', () => {
  /*
   * Ce fichier a passé au vert pendant que le balayage lisait
   * `custom_columns` / `custom_column_values` : des tables qui N'EXISTENT
   * PAS. Le faux Supabase répondait à n'importe quel nom, donc les tests
   * confirmaient le bug au lieu de le révéler. C'est `check:db-coherence`,
   * qui interroge le vrai catalogue, qui l'a trouvé.
   *
   * On fige donc les noms réels (catalogue de staging, 2026-09-24). Avec
   * PostgREST, une table inexistante fait échouer TOUTE la requête et
   * supabase-js ne lève jamais : la fonctionnalité meurt en silence.
   */
  it('lit `custom_fields` et `custom_field_values`, jamais `custom_columns`', () => {
    expect(source).toMatch(/from\('custom_fields'\)/);
    expect(source).toMatch(/from\('custom_field_values'\)/);
    expect(source, 'ces tables n’existent pas en base').not.toMatch(/custom_columns?'/);
  });

  it('les colonnes citées sont celles du vrai schéma', () => {
    // `object_type` (pas `entity`), `field_id` (pas `column_id`),
    // `client_id` (pas `record_id`).
    expect(source).toMatch(/object_type/);
    expect(source).toMatch(/\.eq\('field_id'/);
    expect(source).toMatch(/client_id/);
    expect(source).not.toMatch(/'column_id'/);
    expect(source).not.toMatch(/'record_id'/);
  });

  it('l’entité se compare au SINGULIER', () => {
    // `cf_object_type` vaut client, deal, job, quote, invoice. Comparer à
    // 'clients' ne serait jamais vrai : zéro rappel, zéro erreur.
    expect(source).toMatch(/object_type !== 'client'/);
    expect(source).not.toMatch(/=== 'clients'|!== 'clients'/);
  });

  it('le champ date se choisit — le déclencheur n’est plus « bientôt »', () => {
    /*
     * Le balayage a besoin de `conditions.champ_id`. Tant qu'aucun écran ne
     * permettait de le saisir, le déclencheur était grisé — publier aurait
     * donné une automatisation qui ne part JAMAIS, sans message.
     *
     * Le panneau de réglage existe maintenant (`PanneauDeclencheur.tsx`) :
     * le déclencheur s'ouvre, et ses deux réglages sont déclarés au
     * catalogue.
     */
    const catalogue = readFileSync(resolve(RACINE, 'src/lib/automationCatalogue.ts'), 'utf8');
    // L'entrée SEULE : de sa clé à son accolade fermante. Découper jusqu'au
    // déclencheur suivant ramassait le `bientot: true` des déclencheurs de
    // pipeline qui viennent après — le test aurait échoué pour rien.
    const debut = catalogue.indexOf("cle: 'date.reached'");
    expect(debut, 'le déclencheur doit exister').toBeGreaterThan(-1);
    const bloc = catalogue.slice(debut, catalogue.indexOf('\n  },', debut));
    expect(bloc, 'le déclencheur est branché : plus de « bientôt »').not.toMatch(/bientot: true/);
    expect(bloc, 'il faut pouvoir choisir QUELLE date').toMatch(/cle: 'champ_id'[\s\S]*type: 'champ_date'/);
    expect(bloc, 'et combien de jours avant').toMatch(/cle: 'jours_avant'/);
    expect(bloc, 'le champ date est OBLIGATOIRE').toMatch(/cle: 'champ_id'[\s\S]*obligatoire: true/);
  });

  it('publier sans champ date choisi est REFUSÉ', () => {
    /*
     * Le seul garde-fou qui compte vraiment : sans `champ_id`, le balayage
     * passe son chemin et la règle est publiée, affichée active, et ne part
     * jamais. On vérifie le comportement, pas la présence d'une ligne.
     */
    const bloquants = (r: Parameters<typeof problemesAvantPublication>[0]) =>
      problemesAvantPublication(r).filter((p) => p.gravite === 'bloquant');

    const parcours = {
      trigger_event: 'date.reached',
      actions: [{ type: 'send_sms', config: { body: 'Rappel' } }],
      fr: true,
    };

    expect(bloquants({ ...parcours, conditions: {} }).length,
      'sans champ date, la publication doit être refusée').toBeGreaterThan(0);
    expect(bloquants({ ...parcours, conditions: null }).length,
      'conditions absentes = même refus').toBeGreaterThan(0);
    expect(bloquants({ ...parcours, conditions: { champ_id: '   ' } }).length,
      'un champ rempli d’espaces ne compte pas').toBeGreaterThan(0);

    // Avec le champ choisi, plus rien ne bloque de ce côté.
    const avecChamp = bloquants({
      ...parcours,
      conditions: { champ_id: '11111111-1111-1111-1111-111111111111', jours_avant: 7 },
    });
    expect(avecChamp.map((p) => p.message).join(' | '))
      .not.toMatch(/date|champ/i);
  });

  it('« jours avant » reste FACULTATIF — 0 est une valeur légitime', () => {
    // Le jour même est un cas courant (anniversaire, échéance). Le rendre
    // obligatoire forcerait à saisir « 0 » pour rien.
    const bloquants = problemesAvantPublication({
      trigger_event: 'date.reached',
      actions: [{ type: 'send_sms', config: { body: 'x' } }],
      conditions: { champ_id: '11111111-1111-1111-1111-111111111111' },
      fr: true,
    }).filter((p) => p.gravite === 'bloquant');
    expect(bloquants.map((p) => p.message).join(' | ')).not.toMatch(/jours/i);
  });
});
