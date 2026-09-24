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
      'custom_columns.single': { entity: 'clients' },
      custom_column_values: [],
    });
    await balayerRappelsDates(sb.client as never, new Date('2026-09-15T12:00:00-04:00'));

    const lecture = sb.journal.find((e) => e.table === 'custom_column_values');
    const jour = lecture?.filtres.find(([k]) => k === 'value_date')?.[1];
    expect(jour, '7 jours APRÈS le 15 septembre').toBe('2026-09-22');
  });

  it('un décalage nul vise aujourd’hui', async () => {
    const sb = faireSupabase({
      automation_rules: [{ id: 'r1', org_id: 'org-A', conditions: { champ_id: 'col-1', jours_avant: 0 } }],
      'custom_columns.single': { entity: 'clients' },
      custom_column_values: [],
    });
    await balayerRappelsDates(sb.client as never, new Date('2026-09-15T12:00:00-04:00'));
    const lecture = sb.journal.find((e) => e.table === 'custom_column_values');
    expect(lecture?.filtres.find(([k]) => k === 'value_date')?.[1]).toBe('2026-09-15');
  });

  it('une colonne qui ne porte pas sur les CLIENTS est ignorée', async () => {
    /*
     * `custom_columns.entity` vaut 'clients', 'jobs' ou 'invoices' — au
     * PLURIEL (CHECK en base). Sur une colonne de `jobs`, le balayage
     * chercherait un client avec un identifiant de job : jamais rien,
     * silencieusement.
     */
    const sb = faireSupabase({
      automation_rules: [{ id: 'r1', org_id: 'org-A', conditions: { champ_id: 'col-1', jours_avant: 7 } }],
      'custom_columns.single': { entity: 'jobs' },
    });
    const r = await balayerRappelsDates(sb.client as never);
    expect(r.emis).toBe(0);
    expect(sb.journal.some((e) => e.table === 'custom_column_values'), 'aucune lecture de dates').toBe(false);
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
      'custom_columns.single': { entity: 'clients' },
      custom_column_values: [],
    });
    await balayerRappelsDates(sb.client as never);

    const lectureValeurs = sb.journal.find((e) => e.table === 'custom_column_values');
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
    expect(sb.journal.some((e) => e.table === 'custom_column_values')).toBe(false);
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
