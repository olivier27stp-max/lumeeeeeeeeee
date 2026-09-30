/**
 * PR 5 — Client inactif + lien de réservation (drapeau `auto_client_inactif`).
 *
 * Ce que la base décide (seuils 5 / 7 mois, job futur, archivé) est éprouvé
 * contre staging par l'E2E : la fonction SQL `clients_inactifs` porte cette
 * logique. Ici : le balayage (fenêtre horaire, plafond par heure, une fois
 * par période), le déclencheur dans le moteur, le lien (empreinte seule,
 * expiration, un client), la variable, et le respect du désabonnement.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const etat = vi.hoisted(() => ({
  e: { sms: [] as any[], courriels: [] as any[], appels: [] as any[], slack: [] as any[] },
  client: { current: null as any },
}));
vi.mock('../../server/lib/supabase', async (orig) => ({ ...(await orig<any>()), getServiceClient: () => etat.client.current }));
vi.mock('../../server/lib/mailer', async (orig) => ({
  ...(await orig<any>()),
  isMailerConfigured: () => true,
  sendEmail: vi.fn(async (p: any) => { etat.e.courriels.push({ to: p.to, subject: p.subject, html: p.html }); return { sent: true, messageId: 't' }; }),
}));
vi.mock('../../server/lib/twilioProvisioning', async (orig) => ({ ...(await orig<any>()), getOrgSmsFromNumber: async () => '+15550000000' }));

import {
  balayerEntreprise, reglagesInactivite, creerLienReservation, lireLienReservation, empreinteJeton, demandeLienReservation,
} from '../../server/lib/client-inactif';
import { eventBus } from '../../server/lib/eventBus';
import { oublierDrapeaux } from '../../server/lib/automations-drapeaux';
import { typeEnvoi } from '../../server/lib/desabonnement';
import { DECLENCHEURS, declencheurOffert } from '../../src/lib/automationCatalogue';
import { clientEnregistreur, requetes } from './filet-regression/_enregistreur';
import { jouer, evenementPour, courant, IDS, ORG } from './filet-regression/_banc';

process.env.PUBLIC_URL = process.env.PUBLIC_URL || 'https://app.lume.test';
const TZ = process.env.TZ;
// 14 h à Montréal (18 h UTC) : dans la plage 9 h – 19 h.
const JOURNEE = new Date('2026-09-28T18:00:00Z');
// 3 h du matin à Montréal : hors plage.
const NUIT = new Date('2026-09-28T07:00:00Z');

let emis: any[] = [];
beforeEach(() => {
  oublierDrapeaux();
  emis = [];
  eventBus.removeAllListeners();
  eventBus.on('client.inactive', (e: unknown) => { emis.push(e); });
  Object.defineProperty(etat.client, 'current', { get: () => courant.client, configurable: true });
});
afterEach(() => { vi.useRealTimers(); if (TZ === undefined) delete process.env.TZ; else process.env.TZ = TZ; });

/** La base vue par le balayage. `dejaCetteHeure` = déclenchements de la dernière heure. */
function base(opts: { regles?: Array<Record<string, unknown>>; candidats?: Array<Record<string, unknown>>; dejaCetteHeure?: number; reserves?: Set<string> } = {}) {
  const reserves = opts.reserves ?? new Set<string>();
  return clientEnregistreur({
    company_settings: { data: [{ timezone: 'America/Montreal' }] },
    automation_rules: { data: opts.regles ?? [{ id: 'r1', conditions: { mois: 6, max_par_heure: 25 } }] },
    'rpc:clients_inactifs': (req) => {
      const limite = (req.valeur as any).p_limite;
      return { data: (opts.candidats ?? []).slice(0, limite) };
    },
    clients_inactifs_declenches: (req) => {
      if (req.op === 'insert') {
        const v = req.valeur as any;
        const cle = `${v.client_id}|${v.mois}|${v.periode}`;
        if (reserves.has(cle)) return { data: null, error: { code: '23505', message: 'duplicate' } };
        reserves.add(cle);
        return { data: [{}] };
      }
      return { data: [], count: opts.dejaCetteHeure ?? 0 };
    },
  });
}
const candidat = (i: number) => ({ client_id: `aaaaaaaa-0000-4000-8000-1000000000${String(i).padStart(2, '0')}`, periode: `job-${i}`, dernier_job_at: '2026-01-01T00:00:00Z' });

describe('le balayage', () => {
  it('en journée : émet un client.inactive par candidat, avec les réglages de la règle', async () => {
    const { client } = base({ candidats: [candidat(1), candidat(2)] });
    expect(await balayerEntreprise(client, ORG, JOURNEE)).toBe(2);
    expect(emis).toHaveLength(2);
    expect(emis[0]).toMatchObject({ type: 'client.inactive', orgId: ORG, entityType: 'client', entityId: candidat(1).client_id });
    // Les réglages voyagent en LISTE (toutes les règles du seuil) : chaque règle s'y reconnaît.
    expect(emis[0].metadata).toMatchObject({ mois: [6], max_par_heure: [25], periode: 'job-1' });
    const { evaluateConditions } = await import('../../server/lib/automationEngine');
    expect(evaluateConditions({ mois: 6, max_par_heure: 25 }, emis[0] as never)).toBe(true);
  });

  it('la nuit (heure locale de l\'entreprise) : rien', async () => {
    const { client, journal } = base({ candidats: [candidat(1)] });
    expect(await balayerEntreprise(client, ORG, NUIT)).toBe(0);
    expect(requetes(journal, 'rpc:clients_inactifs')).toHaveLength(0);
  });

  it('une seule fois par période : un 2e passage ne réémet pas le même client', async () => {
    const reserves = new Set<string>();
    expect(await balayerEntreprise(base({ candidats: [candidat(1)], reserves }).client, ORG, JOURNEE)).toBe(1);
    expect(await balayerEntreprise(base({ candidats: [candidat(1)], reserves }).client, ORG, JOURNEE)).toBe(0);
    expect(emis).toHaveLength(1);
  });

  it('se réarme quand un nouveau job est terminé (nouvelle période)', async () => {
    const reserves = new Set<string>();
    await balayerEntreprise(base({ candidats: [candidat(1)], reserves }).client, ORG, JOURNEE);
    const nouvellePeriode = { ...candidat(1), periode: 'job-plus-recent' };
    expect(await balayerEntreprise(base({ candidats: [nouvellePeriode], reserves }).client, ORG, JOURNEE)).toBe(1);
  });

  it('plafond : 400 clients dormants, 25 par heure — pas 400 textos d\'un coup', async () => {
    const tous = Array.from({ length: 400 }, (_, i) => candidat(i));
    expect(await balayerEntreprise(base({ candidats: tous }).client, ORG, JOURNEE)).toBe(25);
    // L'heure suivante, 25 déjà partis dans l'heure glissante → rien de plus.
    expect(await balayerEntreprise(base({ candidats: tous, dejaCetteHeure: 25 }).client, ORG, JOURNEE)).toBe(0);
  });

  it('le plafond est configurable par la règle', async () => {
    const tous = Array.from({ length: 50 }, (_, i) => candidat(i));
    const { client } = base({ candidats: tous, regles: [{ id: 'r1', conditions: { mois: 6, max_par_heure: 5 } }] });
    expect(await balayerEntreprise(client, ORG, JOURNEE)).toBe(5);
  });

  it('sans règle active : aucune requête de candidats', async () => {
    const { client, journal } = base({ regles: [] });
    expect(await balayerEntreprise(client, ORG, JOURNEE)).toBe(0);
    expect(requetes(journal, 'rpc:clients_inactifs')).toHaveLength(0);
  });

  it('les réglages sont bornés', () => {
    expect(reglagesInactivite({})).toEqual({ mois: 6, maxParHeure: 25 });
    expect(reglagesInactivite({ mois: '12', max_par_heure: 0 })).toEqual({ mois: 12, maxParHeure: 25 });
    expect(reglagesInactivite({ mois: 999, max_par_heure: 99999 })).toEqual({ mois: 60, maxParHeure: 1000 });
  });
});

describe('le déclencheur dans le moteur', () => {
  const regle = (mois: number) => ({
    id: `r-inactif-${mois}`, trigger_event: 'client.inactive', delay_seconds: 0,
    conditions: { mois, max_par_heure: 25 },
    actions: [{ type: 'create_notification', config: { title: 'Client inactif', body: 'à relancer' } }],
  });
  const notifs = (s: any) => s.ecritures.filter((w: any) => w.table === 'notifications' && w.op === 'insert');

  it('la règle à 6 mois part sur l\'événement « 6 mois » ; celle à 12 mois, non', async () => {
    expect(notifs(await jouer(regle(6), evenementPour('client.inactive'), etat.e))).toHaveLength(1);
    expect(notifs(await jouer(regle(12), evenementPour('client.inactive'), etat.e))).toHaveLength(0);
  });

  it('{{client.lien_reservation}} : un vrai lien de 30 jours, drapeau ON', async () => {
    const s: any = await jouer(
      { id: 'r-lien', trigger_event: 'client.inactive', delay_seconds: 0, conditions: { mois: 6, max_par_heure: 25 },
        actions: [{ type: 'send_sms', config: { body: 'On s’ennuie de vous ! Réservez : {{client.lien_reservation}}', type_envoi: 'transactionnel' } }] },
      evenementPour('client.inactive'), etat.e,
      { org_features: { data: [{ feature: 'auto_client_inactif', enabled: true }] }, liens_reservation: { data: [{}] } },
    );
    const texto = s.envois.find((e: any) => e.canal === 'sms');
    expect(texto.texte).toMatch(/Réservez : https:\/\/app\.lume\.test\/reserver\/<jeton>$/);
    const lien = s.ecritures.find((w: any) => w.table === 'liens_reservation' && w.op === 'insert');
    // Seule l'empreinte est gardée, jamais le jeton.
    expect(lien.valeur).toMatchObject({ org_id: ORG, client_id: IDS.client });
    expect(lien.valeur.jeton_hash).toBe('<jeton>');
    expect(Object.keys(lien.valeur)).not.toContain('jeton');
  });

  it('drapeau OFF : la variable reste vide, aucun lien créé', async () => {
    const s: any = await jouer(
      { id: 'r-lien-off', trigger_event: 'quote.sent', delay_seconds: 0,
        actions: [{ type: 'send_sms', config: { body: 'Réservez : {{client.lien_reservation}}' } }] },
      evenementPour('quote.sent'), etat.e,
    );
    expect(s.envois.find((e: any) => e.canal === 'sms').texte).toBe('Réservez : ');
    expect(s.ecritures.some((w: any) => w.table === 'liens_reservation')).toBe(false);
  });

  it('c\'est du marketing : il respecte le désabonnement (PR 1)', () => {
    expect(typeEnvoi({ actionType: 'send_sms', declencheur: 'client.inactive' })).toBe('marketing');
  });
});

describe('le lien de réservation', () => {
  it('ne stocke que l\'empreinte, dure 30 jours, et pointe /reserver/<64 hex>', async () => {
    const { client, journal } = clientEnregistreur({ liens_reservation: { data: [{}] } });
    const url = await creerLienReservation(client, ORG, IDS.client, new Date('2026-09-28T12:00:00Z'));
    const jeton = url.split('/reserver/')[1];
    expect(jeton).toMatch(/^[0-9a-f]{64}$/);
    const ligne = requetes(journal, 'liens_reservation', 'insert')[0].valeur as any;
    expect(ligne.jeton_hash).toBe(empreinteJeton(jeton));
    expect(ligne.jeton_hash).not.toBe(jeton);
    expect(ligne.expires_at).toBe('2026-10-28T12:00:00.000Z');
  });

  it('lien expiré → « expire » ; inconnu → « inconnu » ; format invalide → « inconnu » sans requête', async () => {
    const jeton = 'a'.repeat(64);
    const expire = clientEnregistreur({ liens_reservation: { data: [{ id: 'l1', org_id: ORG, client_id: IDS.client, expires_at: '2026-09-01T00:00:00Z' }] } });
    expect(await lireLienReservation(expire.client, jeton, new Date('2026-09-28T00:00:00Z'))).toEqual({ etat: 'expire' });
    const inconnu = clientEnregistreur({ liens_reservation: { data: [] } });
    expect(await lireLienReservation(inconnu.client, jeton)).toEqual({ etat: 'inconnu' });
    const invalide = clientEnregistreur({});
    expect(await lireLienReservation(invalide.client, 'pas-un-jeton')).toEqual({ etat: 'inconnu' });
    expect(invalide.journal).toHaveLength(0);
  });

  it('un jeton ne mène qu\'à SON client : la recherche se fait par l\'empreinte du jeton, rien d\'autre', async () => {
    const jetonA = 'b'.repeat(64);
    const { client, journal } = clientEnregistreur({ liens_reservation: { data: [{ id: 'lA', org_id: ORG, client_id: IDS.client, expires_at: '2099-01-01T00:00:00Z' }] } });
    const lu = await lireLienReservation(client, jetonA);
    expect(lu).toEqual({ etat: 'valide', lienId: 'lA', orgId: ORG, clientId: IDS.client });
    expect(requetes(journal, 'liens_reservation')[0].filtres).toEqual([['eq', 'jeton_hash', empreinteJeton(jetonA)]]);
  });

  it('on ne crée un lien que si le message l\'utilise', () => {
    expect(demandeLienReservation('Bonjour {{client.lien_reservation}}')).toBe(true);
    expect(demandeLienReservation('Bonjour {{ client.lien_reservation }}')).toBe(true);
    expect(demandeLienReservation('Bonjour [client_name]', null)).toBe(false);
  });
});

describe('catalogue', () => {
  const d = DECLENCHEURS.find((x) => x.cle === 'client.inactive')!;
  it('« Client inactif », 6 mois et 25/heure par défaut, offert seulement avec le drapeau', () => {
    expect(d.fr).toBe('Client inactif');
    expect(d.conditions_defaut).toEqual({ mois: 6, max_par_heure: 25 });
    expect(declencheurOffert(d, new Set())).toBe(false);
    expect(declencheurOffert(d, new Set(['auto_client_inactif']))).toBe(true);
  });
});
