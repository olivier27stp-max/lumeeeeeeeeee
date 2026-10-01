/**
 * A — Horaires : heures calmes, fenêtre d'envoi, report, changements d'heure,
 * « X avant la date », jours locaux des balayages, fuseau de l'entreprise.
 *
 * Repères America/Toronto :
 *  · retour à l'heure normale : dimanche 1er novembre 2026, 2 h EDT → 1 h EST
 *    (1 h 30 existe DEUX fois : 05:30Z puis 06:30Z) ;
 *  · heure d'été : dimanche 8 mars 2026 et 14 mars 2027, 2 h EST → 3 h EDT.
 *
 * Unitaire pur : aucun réseau. Les fonctions qui lisent la base reçoivent un
 * client EN MÉMOIRE (tests/quarantaine/automation/_enregistreur) — seule la
 * base est remplacée, jamais la fonction testée.
 */
import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest';
import { isQuietHours, horsFenetre, nextSendTime, type ReglagesRegle } from '../../../server/lib/automationEngine';
import {
  fuseauOrg, viderCacheFuseau, oublierFuseau, FUSEAU_DEFAUT, corrigerChangementDHeure, decalageLocalMin,
} from '../../../server/lib/automations-fuseau-org';
import { jourLocal as jourRappel, jourDecale } from '../../../server/lib/rappels-dates';
import { jourLocal, minuitLocal } from '../../../server/lib/dates-locales';
import { echeanceAvantDate, planifierEtape, type Etape, type EtapeAttendre } from '../../../server/lib/automationSequences';
import { clientEnregistreur, requetes } from '../../quarantaine/automation/_enregistreur';

const TO = 'America/Toronto';
/** « Thu 2026-10-01 08:18 » : jour, date et heure murale dans le fuseau. */
const heureLocale = (d: Date, tz = TO) => {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${v('weekday')} ${v('year')}-${v('month')}-${v('day')} ${v('hour')}:${v('minute')}`;
};

// Le module de fuseau journalise ses replis : on garde la sortie propre.
const erreurs = vi.spyOn(console, 'error').mockImplementation(() => {});
afterAll(() => erreurs.mockRestore());

// ─────────────────────────────────────────────────────────────
describe('A-260…A-269 — heures calmes par défaut (8 h ≤ h < 20 h, heure de l\'entreprise)', () => {
  it.each([
    ['A-260', '2026-09-30T11:59:00Z', true, '7 h 59 EDT'],
    ['A-260', '2026-09-30T12:00:00Z', false, '8 h 00 EDT'],
    ['A-260', '2026-09-30T23:59:00Z', false, '19 h 59 EDT'],
    ['A-260', '2026-10-01T00:00:00Z', true, '20 h 00 EDT'],
    ['A-261', '2026-10-01T04:00:00Z', true, 'minuit pile'],
    ['A-261', '2026-10-01T03:59:59Z', true, '23 h 59 59'],
    ['A-262', '2026-11-01T05:30:00Z', true, '1 h 30 EDT (1re fois)'],
    ['A-262', '2026-11-01T06:30:00Z', true, '1 h 30 EST (2e fois)'],
    ['A-262', '2026-11-01T12:59:00Z', true, '7 h 59 EST, jour du changement'],
    ['A-262', '2026-11-01T13:00:00Z', false, '8 h 00 EST, jour du changement'],
    ['A-262', '2026-11-01T12:00:00Z', true, '7 h 00 EST (était 8 h EDT la veille)'],
    ['A-262', '2026-11-02T00:59:00Z', false, '19 h 59 EST'],
    ['A-262', '2026-11-02T01:00:00Z', true, '20 h 00 EST'],
    ['A-263', '2026-03-08T11:59:00Z', true, '7 h 59 EDT, jour de l\'heure d\'été'],
    ['A-263', '2026-03-08T12:00:00Z', false, '8 h 00 EDT, jour de l\'heure d\'été'],
    ['A-263', '2026-03-08T07:30:00Z', true, '3 h 30 EDT (2 h 30 n\'existe pas)'],
    ['A-263', '2027-03-14T12:00:00Z', false, '8 h 00 EDT, 14 mars 2027'],
    ['A-263', '2027-03-14T11:59:00Z', true, '7 h 59 EDT, 14 mars 2027'],
  ])('[%s] %s → calme = %s (%s)', (_id, iso, calme) => {
    expect(isQuietHours(new Date(iso), TO)).toBe(calme);
    expect(horsFenetre(null, new Date(iso), TO)).toBe(calme);
  });

  it('[A-264] le fuseau de l\'entreprise, pas celui du serveur : 17 h à Vancouver = 20 h à Toronto', () => {
    const d = new Date('2026-10-01T00:30:00Z');
    expect(isQuietHours(d, TO)).toBe(true);
    expect(isQuietHours(d, 'America/Vancouver')).toBe(false);
    expect(isQuietHours(new Date('2026-09-30T13:00:00Z'), 'America/Halifax')).toBe(false);
    expect(isQuietHours(new Date('2026-09-30T13:00:00Z'), 'America/Vancouver')).toBe(true);
  });

  it('[A-265] sans fuseau, le défaut est America/Toronto', () => {
    expect(FUSEAU_DEFAUT).toBe('America/Toronto');
    expect(isQuietHours(new Date('2026-09-30T11:59:00Z'))).toBe(true);
    expect(isQuietHours(new Date('2026-09-30T12:00:00Z'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
describe('A-270…A-279 — fenêtre réglée et jours ouvrables', () => {
  const f = (debut: number, fin: number, jours_ouvrables?: boolean): ReglagesRegle => ({ fenetre: { debut, fin }, jours_ouvrables });

  it.each([
    ['A-270', f(9, 17), '2026-09-30T12:59:00Z', true], ['A-270', f(9, 17), '2026-09-30T13:00:00Z', false],
    ['A-270', f(9, 17), '2026-09-30T20:59:00Z', false], ['A-270', f(9, 17), '2026-09-30T21:00:00Z', true],
    ['A-271', f(7, 22), '2026-09-30T10:59:00Z', true], ['A-271', f(7, 22), '2026-09-30T11:00:00Z', false],
    ['A-271', f(7, 22), '2026-10-01T01:59:00Z', false], ['A-271', f(7, 22), '2026-10-01T02:00:00Z', true],
    ['A-271', f(21, 22), '2026-10-01T01:30:00Z', false], ['A-271', f(21, 22), '2026-10-01T00:59:00Z', true],
  ])('[%s] fenêtre %j à %s → hors = %s', (_id, reglages, iso, hors) => {
    expect(horsFenetre(reglages, new Date(iso), TO)).toBe(hors);
  });

  it.each([
    ['A-272', '2026-10-02T14:00:00Z', false, 'vendredi 10 h'],
    ['A-272', '2026-10-03T14:00:00Z', true, 'samedi 10 h'],
    ['A-272', '2026-10-04T14:00:00Z', true, 'dimanche 10 h'],
    ['A-272', '2026-10-05T14:00:00Z', false, 'lundi 10 h'],
    ['A-273', '2026-10-03T03:30:00Z', true, 'vendredi 23 h 30 local = samedi UTC (heure calme)'],
    ['A-273', '2026-11-01T15:00:00Z', true, 'dimanche du changement d\'heure'],
  ])('[%s] jours ouvrables, %s → hors = %s (%s)', (_id, iso, hors) => {
    expect(horsFenetre({ jours_ouvrables: true }, new Date(iso), TO)).toBe(hors);
  });

  it('[A-274] le jour de la semaine se lit dans le fuseau de l\'entreprise (dimanche 20 h Vancouver = lundi UTC)', () => {
    const d = new Date('2026-10-05T03:00:00Z'); // dimanche 20 h Vancouver, lundi 3 h UTC
    expect(horsFenetre({ jours_ouvrables: true, fenetre: { debut: 7, fin: 22 } }, d, 'America/Vancouver')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
describe('A-280…A-289 — report à la prochaine fenêtre (nextSendTime)', () => {
  it('[A-280] 20 h 18 un mercredi → le lendemain entre 8 h et 8 h 30', () => {
    const r = nextSendTime(new Date('2026-10-01T00:18:00Z'), null, TO);
    expect(heureLocale(r)).toMatch(/^Thu 2026-10-01 08:(1[89]|2\d)$/);
    expect(horsFenetre(null, r, TO)).toBe(false);
  });

  it('[A-281] samedi, jours ouvrables → lundi matin (pas dimanche)', () => {
    const r = nextSendTime(new Date('2026-10-03T14:00:00Z'), { jours_ouvrables: true }, TO);
    expect(heureLocale(r)).toMatch(/^Mon 2026-10-05 08:/);
  });

  it('[A-282] vendredi 22 h 05, fenêtre 21-22 + jours ouvrables → lundi 21 h (près de 3 jours)', () => {
    const r = nextSendTime(new Date('2026-10-03T02:05:00Z'), { fenetre: { debut: 21, fin: 22 }, jours_ouvrables: true }, TO);
    expect(heureLocale(r)).toMatch(/^Mon 2026-10-05 21:/);
  });

  it('[A-283] nuit du retour à l\'heure normale : 1 h 30 (EST, 2e passage) → 8 h EST le 1er novembre', () => {
    const r = nextSendTime(new Date('2026-11-01T06:30:00Z'), null, TO);
    expect(heureLocale(r)).toMatch(/^Sun 2026-11-01 08:[0-2]\d$/);
    expect(r.getTime() - Date.parse('2026-11-01T06:30:00Z')).toBe(13 * 30 * 60_000); // 6 h 30 réelles
  });

  it('[A-284] nuit du passage à l\'heure d\'été : 1 h EST → 8 h EDT le 8 mars (6 h réelles)', () => {
    const r = nextSendTime(new Date('2026-03-08T06:00:00Z'), null, TO);
    expect(r.toISOString()).toBe('2026-03-08T12:00:00.000Z');
    expect(heureLocale(r)).toMatch(/^Sun 2026-03-08 08:00$/);
  });

  it('[A-285] fin de mois : 31 octobre 20 h 30 → 1er novembre 8 h (jour du changement)', () => {
    const r = nextSendTime(new Date('2026-11-01T00:30:00Z'), null, TO);
    expect(heureLocale(r)).toMatch(/^Sun 2026-11-01 08:/);
  });

  // Balayage : de 17 min en 17 min sur deux semaines couvrant le 1er novembre,
  // pour chaque réglage valide. Le résultat doit TOUJOURS être dans la
  // fenêtre, après le départ, et au plus 72 h plus tard.
  const REGLAGES_VALIDES: Array<[string, ReglagesRegle | null]> = [
    ['défaut', null], ['9-17', { fenetre: { debut: 9, fin: 17 } }], ['7-22', { fenetre: { debut: 7, fin: 22 } }],
    ['21-22', { fenetre: { debut: 21, fin: 22 } }], ['jours ouvrables', { jours_ouvrables: true }],
    ['21-22 + jours ouvrables', { fenetre: { debut: 21, fin: 22 }, jours_ouvrables: true }],
  ];
  it.each(REGLAGES_VALIDES)('[A-286] balayage 2 semaines (dont le changement d\'heure), réglage %s : toujours dans la fenêtre', (_l, reglages) => {
    const depart = Date.parse('2026-10-24T00:00:00Z');
    for (let t = depart; t < depart + 14 * 86_400_000; t += 17 * 60_000) {
      const d = new Date(t);
      if (!horsFenetre(reglages, d, TO)) continue;
      const r = nextSendTime(d, reglages, TO);
      expect(horsFenetre(reglages, r, TO), `${d.toISOString()} → ${r.toISOString()}`).toBe(false);
      expect(r.getTime()).toBeGreaterThan(t);
      expect(r.getTime() - t).toBeLessThanOrEqual(72 * 3_600_000);
    }
  }, 120_000);

  // Une fenêtre impossible n'arrive pas par l'éditeur (Zod), mais bien par
  // un préréglage, Lumi ou une règle ancienne. Avant : nextSendTime rendait
  // l'heure de départ, en pleine heure calme — la tâche était repoussée « à
  // maintenant » à chaque passage de la file, sans jamais partir ni laisser
  // de trace.
  it.each([
    ['A-287', 'fenêtre inversée 20-8', { fenetre: { debut: 20, fin: 8 } }],
    ['A-287', 'fenêtre vide 12-12', { fenetre: { debut: 12, fin: 12 } }],
    ['A-287', 'fenêtre hors bornes 25-30', { fenetre: { debut: 25, fin: 30 } }],
    ['A-287', 'fenêtre illisible', { fenetre: { debut: Number.NaN, fin: Number.NaN } }],
    ['A-287', 'fenêtre inversée + jours ouvrables', { fenetre: { debut: 18, fin: 9 }, jours_ouvrables: true }],
  ])('[%s] %s : le report tombe dans la fenêtre par défaut (8 h-20 h), jamais « maintenant »', (_id, _l, reglages) => {
    const nuit = new Date('2026-10-01T03:00:00Z'); // 23 h
    const r = nextSendTime(nuit, reglages as ReglagesRegle, TO);
    expect(r.getTime()).toBeGreaterThan(nuit.getTime());
    expect(isQuietHours(r, TO)).toBe(false);
    expect(horsFenetre(reglages as ReglagesRegle, r, TO)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
describe('A-290…A-299 — « X avant le rendez-vous » garde l\'heure locale (corrigerChangementDHeure)', () => {
  const H = 3_600_000;
  const J = 24 * H;
  it.each([
    // [id, rdv (UTC), délai, rappel attendu (UTC), explication]
    ['A-290', '2026-11-03T15:00:00Z', -7 * J, '2026-10-27T14:00:00Z', 'rdv mardi 10 h EST, 7 j avant = 10 h EDT'],
    ['A-290', '2026-11-02T15:00:00Z', -1 * J, '2026-11-01T15:00:00Z', 'rdv lundi 10 h EST, veille 10 h EST (même décalage)'],
    ['A-291', '2026-11-01T06:30:00Z', -1 * J, '2026-10-31T05:30:00Z', 'rdv 1 h 30 EST (2e passage), veille 1 h 30 EDT'],
    ['A-292', '2026-03-09T14:00:00Z', -2 * J, '2026-03-07T15:00:00Z', 'rdv lundi 10 h EDT, 2 j avant = samedi 10 h EST'],
    ['A-292', '2027-03-15T14:00:00Z', -7 * J, '2027-03-08T15:00:00Z', 'rdv 15 mars 2027 10 h EDT, 7 j avant = 10 h EST'],
    ['A-293', '2026-10-15T14:00:00Z', -2 * J, '2026-10-13T14:00:00Z', 'hors changement d\'heure : aucune correction'],
    ['A-293', '2026-11-03T15:00:00Z', -2 * H, '2026-11-03T13:00:00Z', '2 h avant, même jour : aucune correction'],
  ])('[%s] %s %s → %s (%s)', (_id, rdv, delai, attendu) => {
    const ref = Date.parse(rdv);
    expect(new Date(corrigerChangementDHeure(ref, ref + delai, TO)).toISOString()).toBe(new Date(attendu).toISOString());
  });

  it('[A-294] décalage local : −240 min en été, −300 min en hiver (Toronto), +60/+120 à Paris', () => {
    expect(decalageLocalMin(Date.parse('2026-07-01T12:00:00Z'), TO)).toBe(-240);
    expect(decalageLocalMin(Date.parse('2026-12-01T12:00:00Z'), TO)).toBe(-300);
    expect(decalageLocalMin(Date.parse('2026-11-01T05:30:00Z'), TO)).toBe(-240);
    expect(decalageLocalMin(Date.parse('2026-11-01T06:30:00Z'), TO)).toBe(-300);
    expect(decalageLocalMin(Date.parse('2026-12-01T12:00:00Z'), 'Europe/Paris')).toBe(60);
    expect(decalageLocalMin(Date.parse('2026-07-01T12:00:00Z'), 'Europe/Paris')).toBe(120);
    expect(decalageLocalMin(Date.parse('2026-10-01T04:00:00Z'), TO)).toBe(-240); // minuit local
  });
});

// ─────────────────────────────────────────────────────────────
describe('A-300…A-309 — attente « avant la date » d\'un parcours (échéance et planification)', () => {
  const ORG = '11111111-1111-4111-8111-111111111111';
  const attente: EtapeAttendre = { id: 'a', type: 'attendre', mode: 'avant_date', delai_secondes: 0, secondes_avant: 7 * 86_400, suivant: 'b', si_depasse: 'c' };
  const etapes: Etape[] = [
    attente,
    { id: 'b', type: 'action', action: { type: 'create_notification', config: { title: 'Rappel' } } },
    { id: 'c', type: 'arreter' },
  ];
  const base = (start_at: string, timezone = TO) => clientEnregistreur({
    schedule_events: { data: { start_at, start_time: null, status: 'scheduled', deleted_at: null } },
    company_settings: { data: { timezone } },
    automation_scheduled_tasks: { data: null, error: null },
  });
  const tache = { id: 't1', org_id: ORG, automation_rule_id: 'r1', entity_type: 'schedule_event', entity_id: 'e1', sequence_context: {} };
  beforeEach(() => viderCacheFuseau());

  it('[A-300] à l\'échéance, rendez-vous déplacé plus tard : replanifié 7 jours avant À LA MÊME HEURE LOCALE', async () => {
    const { client, journal } = base('2026-11-03T15:00:00Z'); // mardi 3 nov. 10 h EST
    const verdict = await echeanceAvantDate(client, tache, attente, etapes, Date.parse('2026-10-20T12:00:00Z'));
    expect(verdict).toBe('replanifie');
    const maj = requetes(journal, 'automation_scheduled_tasks', 'update')[0].valeur as { execute_at: string };
    expect(maj.execute_at).toBe('2026-10-27T14:00:00.000Z'); // mardi 27 oct. 10 h EDT
  });

  it('[A-301] planification de l\'attente : la tâche est datée 7 jours avant à la même heure locale', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
    try {
      const { client, journal } = base('2026-11-03T15:00:00Z');
      await planifierEtape({ supabase: client, orgId: ORG, ruleId: 'r1', entityType: 'schedule_event', entityId: 'e1', contexte: {}, franchies: 0 }, etapes, 'a');
      const ins = requetes(journal, 'automation_scheduled_tasks', 'insert')[0].valeur as { execute_at: string; step_id: string };
      expect(ins.step_id).toBe('a');
      expect(ins.execute_at).toBe('2026-10-27T14:00:00.000Z');
    } finally { vi.useRealTimers(); }
  });

  it('[A-302] moment dépassé de plus de 30 min : on suit « si dépassé », pas le rappel', async () => {
    const { client } = base('2026-10-21T15:00:00Z');
    expect(await echeanceAvantDate(client, tache, attente, etapes, Date.parse('2026-10-20T12:00:00Z'))).toBe('depasse');
  });

  it('[A-303] moment atteint (± 2 min) : on passe au rappel', async () => {
    const { client } = base('2026-10-27T14:00:00Z');
    expect(await echeanceAvantDate(client, tache, attente, etapes, Date.parse('2026-10-20T14:01:00Z'))).toBe('suite');
  });

  it('[A-304] rendez-vous annulé : le parcours s\'arrête', async () => {
    const { client } = clientEnregistreur({ schedule_events: { data: { start_at: '2026-11-03T15:00:00Z', status: 'cancelled', deleted_at: null } } });
    expect(await echeanceAvantDate(client, tache, attente, etapes, Date.parse('2026-10-20T12:00:00Z'))).toBe('annule');
  });
});

// ─────────────────────────────────────────────────────────────
describe('A-310…A-319 — jours locaux des balayages (rappels-dates, dates-locales)', () => {
  it.each([
    ['A-310', '2026-10-01T03:59:00Z', '2026-09-30', '23 h 59 le 30 à Toronto'],
    ['A-310', '2026-10-01T04:00:00Z', '2026-10-01', 'minuit le 1er'],
    ['A-310', '2026-11-01T05:30:00Z', '2026-11-01', '1 h 30 EDT'],
    ['A-310', '2026-11-02T04:59:00Z', '2026-11-01', '23 h 59 EST'],
  ])('[%s] jourLocal(%s) = %s (%s)', (_id, iso, jour) => {
    expect(jourRappel(new Date(iso))).toBe(jour);
    expect(jourLocal(TO, new Date(iso))).toBe(jour);
  });

  it.each([
    ['A-311', 1, '2026-09-30T16:00:00Z', '2026-10-01'],
    ['A-311', -1, '2026-10-01T16:00:00Z', '2026-09-30'],
    ['A-311', 0, '2026-10-31T16:00:00Z', '2026-10-31'],
    ['A-312', 1, '2026-10-31T16:00:00Z', '2026-11-01'],
    ['A-312', 30, '2026-10-31T16:00:00Z', '2026-11-30'],
    ['A-312', 1, '2028-02-28T17:00:00Z', '2028-02-29'],
    ['A-312', 365, '2027-02-28T17:00:00Z', '2028-02-28'],
    ['A-312', -365, '2026-09-30T16:00:00Z', '2025-09-30'],
    // Près de minuit, le jour du changement d'heure : ajouter 24 h ne suffit pas.
    ['A-313', 1, '2026-11-01T04:30:00Z', '2026-11-02'], // 0 h 30 EDT le 1er → le 2
    ['A-313', 7, '2026-10-30T04:30:00Z', '2026-11-06'], // 0 h 30 EDT le 30 oct.
    ['A-313', -1, '2026-03-09T04:30:00Z', '2026-03-08'], // 0 h 30 EDT le 9 mars → le 8
    ['A-313', -7, '2026-03-12T04:30:00Z', '2026-03-05'],
    ['A-313', 1, '2026-03-08T04:30:00Z', '2026-03-08'], // 23 h 30 EST le 7 mars → le 8
  ])('[%s] jourDecale(%i) depuis %s = %s', (_id, jours, iso, attendu) => {
    const base = new Date(iso);
    // Le jour visé est TOUJOURS jour local de la base + N jours civils.
    const [a, m, j] = jourRappel(base).split('-').map(Number);
    const attenduCivil = new Date(Date.UTC(a, m - 1, j + jours)).toISOString().slice(0, 10);
    expect(jourDecale(jours, base)).toBe(attenduCivil);
    expect(jourLocal(TO, base, jours)).toBe(attenduCivil);
    expect(attenduCivil).toBe(attendu);
  });

  it.each([
    ['A-314', '2026-09-30', TO, '2026-09-30T04:00:00.000Z'],
    ['A-314', '2026-12-01', TO, '2026-12-01T05:00:00.000Z'],
    ['A-314', '2026-11-01', TO, '2026-11-01T04:00:00.000Z'],
    ['A-314', '2026-11-02', TO, '2026-11-02T05:00:00.000Z'],
    ['A-314', '2026-03-08', TO, '2026-03-08T05:00:00.000Z'],
    ['A-314', '2026-03-09', TO, '2026-03-09T04:00:00.000Z'],
    ['A-315', '2026-03-29', 'Europe/Paris', '2026-03-28T23:00:00.000Z'],
    ['A-315', '2026-10-01', 'America/Vancouver', '2026-10-01T07:00:00.000Z'],
    ['A-315', '2028-02-29', TO, '2028-02-29T05:00:00.000Z'],
  ])('[%s] minuitLocal(%s, %s) = %s', (_id, jour, tz, attendu) => {
    expect(minuitLocal(jour, tz)).toBe(attendu);
    expect(jourLocal(tz, new Date(attendu))).toBe(jour);
  });
});

// ─────────────────────────────────────────────────────────────
describe('A-320…A-324 — fuseau de l\'entreprise (fuseauOrg)', () => {
  const faux = (reponse: { data?: unknown; error?: { message: string } | null }) => {
    let lectures = 0;
    const client = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { lectures++; return { data: reponse.data ?? null, error: reponse.error ?? null }; } }) }) }) };
    return { client: client as unknown as Parameters<typeof fuseauOrg>[0], lectures: () => lectures };
  };
  beforeEach(() => viderCacheFuseau());

  it.each([
    ['A-320', { timezone: 'America/Vancouver' }, 'America/Vancouver'],
    ['A-320', { timezone: '  Europe/Paris ' }, 'Europe/Paris'],
    ['A-321', { timezone: 'Mars/Olympus' }, 'America/Toronto'],
    ['A-321', { timezone: '' }, 'America/Toronto'],
    ['A-321', null, 'America/Toronto'],
  ])('[%s] réglage %j → %s', async (_id, ligne, attendu) => {
    const { client } = faux({ data: ligne });
    expect(await fuseauOrg(client, 'org-a')).toBe(attendu);
  });

  it('[A-322] gardé en cache 5 min, par entreprise', async () => {
    const { client, lectures } = faux({ data: { timezone: 'America/Vancouver' } });
    await fuseauOrg(client, 'org-a');
    await fuseauOrg(client, 'org-a');
    expect(lectures()).toBe(1);
    await fuseauOrg(client, 'org-b');
    expect(lectures()).toBe(2);
    oublierFuseau('org-a');
    await fuseauOrg(client, 'org-a');
    expect(lectures()).toBe(3);
  });

  it('[A-323] une lecture en erreur retombe sur Toronto SANS mettre l\'échec en cache', async () => {
    const panne = faux({ error: { message: 'boom' } });
    expect(await fuseauOrg(panne.client, 'org-a')).toBe('America/Toronto');
    const ok = faux({ data: { timezone: 'America/Halifax' } });
    expect(await fuseauOrg(ok.client, 'org-a')).toBe('America/Halifax');
  });
});
