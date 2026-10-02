/**
 * Agent P — « Qui est ciblé », côté serveur (server/lib/automations-ciblage.ts) :
 * `ciblageOk` (le moteur) et `apercuCiblage` (le compteur « Touche X clients »).
 *
 *   npx vitest run --maxWorkers=2 tests/automations-finale/p/ciblage-serveur.test.ts
 *
 * Fausse base en mémoire (fausse-base.ts) : on éprouve ce qui est LU et ce qui est
 * conclu. La même chose contre la vraie base : integration/p-ciblage.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FausseBase, uuid } from './fausse-base';
import {
  ciblageOk, apercuCiblage, chargerFiches, nomDuClient, estDemandeDAvis, regleDemandeUnAvis,
  PLAFOND_APERCU_CIBLAGE, TAILLE_APERCU_CIBLAGE,
} from '../../../server/lib/automations-ciblage';
import {
  PREREGLAGES_D_AVIS, CLE_CHAMP_SANS_AVIS, VARIABLES_D_AVIS, canauxDeLaRegle, actionsDUneRegle, texteCiteUnAvis,
  type Ciblage,
} from '../../../src/lib/automationCiblage';
import { REVIEW_PRESET_KEYS, NO_REVIEW_FIELD_KEY } from '../../../server/lib/reviews';
import { logger } from '../../../server/lib/logger';
import { viderCacheFuseau } from '../../../server/lib/automations-fuseau-org';

const ORG = uuid(1, 9);
const AUTRE_ORG = uuid(2, 9);
const CHAMP_REF = uuid(1, 7);
const CHAMP_SANS_AVIS = uuid(2, 7);
const CHAMP_TYPES = uuid(3, 7);
const CHAMP_JOB = uuid(4, 7);

const client = (n: number, p: Record<string, unknown> = {}) => ({
  id: uuid(n), org_id: ORG, first_name: `Prénom${n}`, last_name: `Nom${String(n).padStart(5, '0')}`, company: null, display_as_company: false,
  status: 'active', city: 'Montréal', lead_source: null, source: null, phone: `+1514555${String(1000 + n).slice(-4)}`,
  email: `client${n}@exemple.test`, email_opt_out_at: null, deleted_at: null, ...p,
});
const etiquette = (n: number, tag: string) => ({ id: `t-${n}-${tag}`, client_id: uuid(n), tag });
const valeur = (n: number, champ: string, colonnes: Record<string, unknown>) => ({
  id: `v-${n}-${champ}`, org_id: ORG, object_type: 'client', field_id: champ, client_id: uuid(n),
  value_text: null, value_number: null, value_money_cents: null, value_date: null, value_timestamp: null, value_option_id: null, value_boolean: null, ...colonnes,
});
const CHAMPS = [
  { id: CHAMP_REF, org_id: ORG, object_type: 'client', key: 'refere_par', label: 'Référé par', field_type: 'single_line', config: {}, archived_at: null },
  { id: CHAMP_SANS_AVIS, org_id: ORG, object_type: 'client', key: 'noreview', label: 'Aucune demande d’avis (noreview)', field_type: 'checkbox', config: {}, archived_at: null },
  { id: CHAMP_TYPES, org_id: ORG, object_type: 'client', key: 'services', label: 'Services', field_type: 'dropdown_multi', config: {}, archived_at: null },
  { id: CHAMP_JOB, org_id: ORG, object_type: 'job', key: 'carburant', label: 'Carburant', field_type: 'monetary', config: {}, archived_at: null },
];

let base: FausseBase;
beforeEach(() => {
  viderCacheFuseau();
  base = new FausseBase({
    clients: [client(1), client(2), client(3, { company: 'Tremblay inc.' }), { ...client(4), org_id: AUTRE_ORG }],
    client_tags: [etiquette(1, 'VIP'), etiquette(2, 'Commercial'), etiquette(2, 'Ne pas relancer'), etiquette(4, 'VIP')],
    custom_fields: CHAMPS,
    custom_field_values: [valeur(1, CHAMP_REF, { value_text: 'Commercial' }), valeur(3, CHAMP_SANS_AVIS, { value_boolean: true })],
    custom_field_value_options: [],
    invoices: [{ id: uuid(1, 2), org_id: ORG, client_id: uuid(1) }, { id: uuid(2, 2), org_id: ORG, client_id: uuid(2) }],
    schedule_events: [{ id: uuid(1, 3), org_id: ORG, job_id: null }],
    company_settings: [{ org_id: ORG, timezone: 'America/Toronto' }],
    sms_opt_outs: [], email_unsubscribes: [],
  });
});
afterEach(() => { vi.restoreAllMocks(); });

const vipOuCommercial: Ciblage = {
  inclure: { mode: 'une', regles: [{ type: 'etiquette', valeur: 'VIP' }, { type: 'etiquette', valeur: 'Commercial' }] },
  exclure: [{ type: 'etiquette', valeur: 'Ne pas relancer' }],
};

describe('P — ciblageOk : ce que le moteur demande avant d’agir', () => {
  it('aucun ciblage : ciblé, sans UNE lecture', async () => {
    expect(await ciblageOk(base.client, ORG, 'invoice', uuid(1, 2), { days_overdue: 3 })).toEqual({ cible: true, raison: null, phrase: null, code: null });
    expect(await ciblageOk(base.client, ORG, 'invoice', uuid(1, 2), null)).toMatchObject({ cible: true });
    expect(base.totalLectures()).toBe(0);
  });

  it('une FACTURE est jugée sur les étiquettes de SON client : VIP ou Commercial, jamais « Ne pas relancer »', async () => {
    const conditions = { days_overdue: 3, ciblage: vipOuCommercial };
    expect(await ciblageOk(base.client, ORG, 'invoice', uuid(1, 2), conditions)).toMatchObject({ cible: true });
    expect(await ciblageOk(base.client, ORG, 'invoice', uuid(2, 2), conditions)).toEqual({
      cible: false, raison: 'exclu par l’étiquette « Ne pas relancer »',
      phrase: 'Ignoré : hors ciblage — exclu par l’étiquette « Ne pas relancer »', code: 'hors_ciblage',
    });
    expect(await ciblageOk(base.client, ORG, 'client', uuid(3), conditions)).toMatchObject({ cible: false, raison: 'ne remplit aucune des conditions' });
  });

  it('[mécanisme de E-04] un champ de la fiche CLIENT cible une automatisation de facture', async () => {
    const conditions = { days_overdue: 3, ciblage: { inclure: { mode: 'toutes', regles: [{ type: 'champ', field_id: CHAMP_REF, op: 'is', value: 'Commercial' }] }, exclure: [] } };
    expect(await ciblageOk(base.client, ORG, 'invoice', uuid(1, 2), conditions)).toMatchObject({ cible: true });
    expect(await ciblageOk(base.client, ORG, 'invoice', uuid(2, 2), conditions))
      .toMatchObject({ cible: false, phrase: 'Ignoré : hors ciblage — ne remplit pas la condition sur « Référé par »' });
  });

  it('un champ qui n’est PAS un champ de la fiche client (champ de job) ne cible personne — jamais « vrai pour tous »', async () => {
    const conditions = { ciblage: { inclure: { mode: 'toutes', regles: [{ type: 'champ', field_id: CHAMP_JOB, op: 'is_empty' }] } } };
    expect(await ciblageOk(base.client, ORG, 'client', uuid(1), conditions)).toMatchObject({ cible: false });
  });

  it('les anciennes clés d’étiquette sont jugées de la même façon', async () => {
    expect(await ciblageOk(base.client, ORG, 'client', uuid(1), { client_a_etiquette: 'vip', client_sans_etiquette: 'Ne pas relancer' })).toMatchObject({ cible: true });
    expect(await ciblageOk(base.client, ORG, 'client', uuid(2), { client_sans_etiquette: 'ne pas relancer' }))
      .toMatchObject({ cible: false, raison: 'exclu par l’étiquette « ne pas relancer »' });
  });

  it('[mécanisme de E-05] jugé AU MOMENT de l’appel : l’étiquette posée pendant l’attente change le verdict', async () => {
    const conditions = { client_sans_etiquette: 'Ne pas relancer' };
    expect(await ciblageOk(base.client, ORG, 'client', uuid(1), conditions)).toMatchObject({ cible: true });
    base.lignes('client_tags').push(etiquette(1, 'Ne pas relancer'));
    expect(await ciblageOk(base.client, ORG, 'client', uuid(1), conditions)).toMatchObject({ cible: false, code: 'hors_ciblage' });
  });

  it('fiche SANS client (visite sans job, appel reçu de l’extérieur) : hors ciblage dès qu’un ciblage est posé', async () => {
    const conditions = { ciblage: { exclure: [{ type: 'etiquette', valeur: 'Ne pas relancer' }] } };
    expect(await ciblageOk(base.client, ORG, 'schedule_event', uuid(1, 3), conditions))
      .toMatchObject({ cible: false, raison: 'aucun client n’est lié à cette fiche' });
    expect(await ciblageOk(base.client, ORG, 'automation_webhook_receipt', uuid(5, 3), conditions)).toMatchObject({ cible: false });
  });

  it('le client d’un AUTRE bureau n’est jamais lu', async () => {
    expect(await ciblageOk(base.client, ORG, 'client', uuid(4), { client_a_etiquette: 'VIP' }))
      .toMatchObject({ cible: false, raison: 'la fiche du client est introuvable' });
  });

  it('lecture RATÉE : hors ciblage, signalée (`erreur`), et tracée par le logger', async () => {
    const trace = vi.spyOn(logger, 'error').mockImplementation(() => {});
    base.pannes.client_tags = { message: 'connexion coupée' };
    const v = await ciblageOk(base.client, ORG, 'client', uuid(1), { client_a_etiquette: 'VIP' });
    expect(v).toMatchObject({ cible: false, erreur: true, code: 'hors_ciblage' });
    expect(trace).toHaveBeenCalledTimes(1);
    expect(String(trace.mock.calls[0][0])).toContain('ciblage illisible');
    expect(JSON.stringify(trace.mock.calls[0][1])).toContain('connexion coupée');
  });

  it('seul ce que le ciblage cite est lu : pas d’étiquettes sans règle d’étiquette, pas de champs sans règle de champ', async () => {
    await ciblageOk(base.client, ORG, 'client', uuid(1), { ciblage: { inclure: { mode: 'toutes', regles: [{ type: 'fiche', cle: 'genre', op: 'is', value: 'particulier' }] } } });
    expect(base.lectures).toEqual({ clients: 1 });
    base.lectures = {};
    await ciblageOk(base.client, ORG, 'client', uuid(1), { client_a_etiquette: 'VIP' });
    expect(base.lectures).toEqual({ clients: 1, client_tags: 1 });
    base.lectures = {};
    await ciblageOk(base.client, ORG, 'client', uuid(1), { ciblage: { exclure: [{ type: 'champ', field_id: CHAMP_SANS_AVIS, op: 'is', value: true }] } });
    expect(base.lectures).toEqual({ clients: 1, custom_fields: 1, custom_field_values: 1, company_settings: 1 });
  });

  it('choix multiples : les options choisies sont lues dans leur table', async () => {
    base.lignes('custom_field_values').push(valeur(1, CHAMP_TYPES, {}));
    base.lignes('custom_field_value_options').push({ org_id: ORG, value_id: `v-1-${CHAMP_TYPES}`, option_id: 'opt-vitres' });
    const conditions = (option: string) => ({ ciblage: { inclure: { mode: 'toutes', regles: [{ type: 'champ', field_id: CHAMP_TYPES, op: 'any_of', value: [option] }] } } });
    expect(await ciblageOk(base.client, ORG, 'client', uuid(1), conditions('opt-vitres'))).toMatchObject({ cible: true });
    expect(await ciblageOk(base.client, ORG, 'client', uuid(1), conditions('opt-gouttieres'))).toMatchObject({ cible: false });
  });
});

describe('P — apercuCiblage : « Touche X clients »', () => {
  /** Un carnet de 2 500 clients : 1 sur 5 VIP, 1 sur 7 « Ne pas relancer », STOP, désabonnés, sans téléphone, sans courriel, noreview. */
  function grandCarnet() {
    const clients = Array.from({ length: 2500 }, (_, i) => client(i + 1, {
      phone: (i + 1) % 11 === 0 ? null : `+1438555${String(i + 1).padStart(4, '0')}`,
      email: (i + 1) % 13 === 0 ? '' : `c${i + 1}@exemple.test`,
      email_opt_out_at: (i + 1) % 250 === 0 ? '2026-09-01T00:00:00Z' : null,
    }));
    const tags = clients.flatMap((c, i) => [
      ...((i + 1) % 5 === 0 ? [etiquette(i + 1, 'VIP')] : []),
      ...((i + 1) % 7 === 0 ? [etiquette(i + 1, 'Ne pas relancer')] : []),
    ]);
    base = new FausseBase({
      clients: [...clients, { ...client(9001), org_id: AUTRE_ORG }, { ...client(9002), deleted_at: '2026-01-01T00:00:00Z' }],
      client_tags: [...tags, etiquette(9001, 'VIP'), etiquette(9002, 'VIP')],
      custom_fields: CHAMPS,
      custom_field_values: clients.filter((_, i) => (i + 1) % 50 === 0).map((_, k) => valeur((k + 1) * 50, CHAMP_SANS_AVIS, { value_boolean: true })),
      custom_field_value_options: [],
      sms_opt_outs: [
        ...clients.filter((_, i) => (i + 1) % 20 === 0 && (i + 1) % 11 !== 0).map((c, k) => ({ id: `s${k}`, org_id: ORG, phone: c.phone })),
        { id: 'autre', org_id: AUTRE_ORG, phone: '+14385550005' },
      ],
      email_unsubscribes: [
        ...clients.filter((_, i) => (i + 1) % 100 === 0).map((c, k) => ({ id: `u${k}`, org_id: ORG, email: String(c.email).toUpperCase() === '' ? 'x' : String(c.email), category: 'all' })),
        { id: 'jeton', org_id: ORG, email: 'c5@exemple.test', category: 'pending' },
      ],
      company_settings: [{ org_id: ORG, timezone: 'America/Toronto' }],
    });
    return clients;
  }

  it('compte tout le carnet du bureau (au-delà d’une page de 1 000), jamais un autre bureau ni une fiche supprimée', async () => {
    grandCarnet();
    const tous = await apercuCiblage(base.client, ORG, { ciblage: null, canaux: ['sms', 'email'] });
    expect(tous).toMatchObject({ total: 2500, carnet: 2500, tronque: false, plafond: PLAFOND_APERCU_CIBLAGE });
    const vip = await apercuCiblage(base.client, ORG, { ciblage: { inclure: { mode: 'toutes', regles: [{ type: 'etiquette', valeur: 'vip' }] } }, canaux: ['sms'] });
    expect(vip.total).toBe(500);
    const sauf = await apercuCiblage(base.client, ORG, { ciblage: { inclure: { mode: 'toutes', regles: [{ type: 'etiquette', valeur: 'VIP' }] }, exclure: [{ type: 'etiquette', valeur: 'Ne pas relancer' }] } });
    // Multiples de 5 qui ne sont pas multiples de 7 : 500 − 71.
    expect(sauf.total).toBe(500 - Math.floor(2500 / 35));
  });

  it('« dont » : STOP, désabonnés, sans téléphone, sans courriel — comptés sur les seuls canaux de l’automatisation', async () => {
    const clients = grandCarnet();
    const attendu = {
      sans_telephone: clients.filter((c) => !c.phone).length,
      stop_texto: clients.filter((_, i) => (i + 1) % 20 === 0 && (i + 1) % 11 !== 0).length,
      sans_courriel: clients.filter((c) => !c.email).length,
      desabonnes_courriel: clients.filter((c, i) => c.email && ((i + 1) % 100 === 0 || (i + 1) % 250 === 0)).length,
    };
    const tous = await apercuCiblage(base.client, ORG, { ciblage: null, canaux: ['sms', 'email'] });
    expect(tous.dont).toEqual({ ...attendu, sans_avis: 0 });
    // Le jeton « pending » du client 5 n'est pas un désabonnement.
    expect(tous.dont.desabonnes_courriel).toBe(attendu.desabonnes_courriel);
    base.lectures = {};
    const textoSeul = await apercuCiblage(base.client, ORG, { ciblage: null, canaux: ['sms'] });
    expect(textoSeul.dont).toEqual({ stop_texto: attendu.stop_texto, sans_telephone: attendu.sans_telephone, desabonnes_courriel: 0, sans_courriel: 0, sans_avis: 0 });
    expect(base.lectures.email_unsubscribes ?? 0).toBe(0);
  });

  it('demande d’avis : les clients « Aucune demande d’avis » sont comptés à part — et seulement pour une demande d’avis', async () => {
    grandCarnet();
    expect((await apercuCiblage(base.client, ORG, { ciblage: null, canaux: ['sms'], demandeAvis: true })).dont.sans_avis).toBe(50);
    expect((await apercuCiblage(base.client, ORG, { ciblage: null, canaux: ['sms'] })).dont.sans_avis).toBe(0);
    // Le champ archivé : personne n'est exclu (même règle que `clientRefuseAvis`).
    base.lignes('custom_fields').find((c) => c.id === CHAMP_SANS_AVIS)!.archived_at = '2026-10-01T00:00:00Z';
    expect((await apercuCiblage(base.client, ORG, { ciblage: null, canaux: ['sms'], demandeAvis: true })).dont.sans_avis).toBe(0);
  });

  it('la liste : les 20 premiers par ordre alphabétique, avec ce qui empêche chacun de recevoir', async () => {
    grandCarnet();
    const r = await apercuCiblage(base.client, ORG, { ciblage: { inclure: { mode: 'toutes', regles: [{ type: 'etiquette', valeur: 'VIP' }] } }, canaux: ['sms', 'email'] });
    expect(r.apercu).toHaveLength(TAILLE_APERCU_CIBLAGE);
    // Trié sur le nom AFFICHÉ (« Prénom10 … » passe avant « Prénom5 … »).
    expect(r.apercu[0]).toEqual({ id: uuid(10), nom: 'Prénom10 Nom00010', empechements: [] });
    expect(r.apercu.map((c) => c.nom)).toEqual([...r.apercu.map((c) => c.nom)].sort((a, b) => a.localeCompare(b, 'fr')));
    expect(r.apercu[1]).toEqual({ id: uuid(100), nom: 'Prénom100 Nom00100', empechements: ['stop_texto', 'desabonne_courriel'] });
    expect(r.candidats.find((c) => c.id === uuid(1020))?.empechements).toEqual(['stop_texto']);
    expect(r.candidats.find((c) => c.id === uuid(1045))?.empechements).toEqual(['sans_telephone']);
    expect(r.candidats.find((c) => c.id === uuid(1105))?.empechements).toEqual(['sans_courriel']);
    expect(r.candidats.length).toBe(200);
  });

  it('au-delà du plafond : « tronqué », le total ne compte que les fiches lues', async () => {
    grandCarnet();
    const r = await apercuCiblage(base.client, ORG, { ciblage: null, plafond: 1200 });
    expect(r).toMatchObject({ tronque: true, carnet: 1200, total: 1200, plafond: 1200 });
    expect((await apercuCiblage(base.client, ORG, { ciblage: null, plafond: 2500 })).tronque).toBe(false);
  });

  it('LE COMPTEUR NE PEUT PAS DIRE AUTRE CHOSE QUE LE MOTEUR : pour chaque client, même verdict par `ciblageOk` et par l’aperçu', async () => {
    grandCarnet();
    base.tables.clients = base.lignes('clients').filter((c) => c.org_id !== ORG || Number(String(c.id).slice(-4)) <= 140 || c.deleted_at);
    base.lignes('custom_field_values').push(...[10, 35, 70, 105].map((n) => valeur(n, CHAMP_REF, { value_text: 'Facebook' })));
    const ciblage: Ciblage = {
      inclure: { mode: 'une', regles: [{ type: 'etiquette', valeur: 'VIP' }, { type: 'champ', field_id: CHAMP_REF, op: 'is', value: 'facebook' }] },
      exclure: [{ type: 'etiquette', valeur: 'Ne pas relancer' }, { type: 'champ', field_id: CHAMP_SANS_AVIS, op: 'is', value: true }],
    };
    const apercu = await apercuCiblage(base.client, ORG, { ciblage });
    const { fiches } = await chargerFiches(base.client, ORG, ciblage);
    const parLeMoteur: string[] = [];
    for (const f of fiches) if ((await ciblageOk(base.client, ORG, 'client', f.id, { ciblage })).cible) parLeMoteur.push(f.id);
    expect(parLeMoteur.length).toBeGreaterThan(5);
    expect(apercu.total).toBe(parLeMoteur.length);
    expect(new Set(apercu.candidats.map((c) => c.id))).toEqual(new Set(parLeMoteur));
  });

  it('une lecture ratée LÈVE : l’écran dira « compteur indisponible », jamais un faux nombre', async () => {
    grandCarnet();
    base.pannes.sms_opt_outs = { message: 'délai dépassé' };
    await expect(apercuCiblage(base.client, ORG, { ciblage: null, canaux: ['sms'] })).rejects.toThrow(/STOP : délai dépassé/);
  });

  it('le nom d’un client : la compagnie quand la fiche le demande, sinon la personne, jamais vide', () => {
    expect(nomDuClient({ first_name: 'Marie', last_name: 'Tremblay', company: 'Tremblay inc.', display_as_company: true })).toBe('Tremblay inc.');
    expect(nomDuClient({ first_name: ' Marie ', last_name: 'Tremblay', company: 'Tremblay inc.', display_as_company: false })).toBe('Marie Tremblay');
    expect(nomDuClient({ first_name: null, last_name: null, company: 'Tremblay inc.', display_as_company: false })).toBe('Tremblay inc.');
    expect(nomDuClient({ first_name: null, last_name: '', company: null, display_as_company: false })).toBe('(sans nom)');
  });
});

describe('P — « Aucune demande d’avis » : ce qui est une demande d’avis', () => {
  const texto = (body: string) => ({ type: 'send_sms', config: { body } });

  it('[mécanisme de E-17] un texto écrit à la main avec un lien d’avis EST une demande d’avis', () => {
    expect(estDemandeDAvis({}, texto('Bonjour [client_first_name], laissez-nous un avis : [google_review_url]'))).toBe(true);
    expect(estDemandeDAvis(null, texto('Votre avis compte : {review_link}'))).toBe(true);
    expect(estDemandeDAvis(null, texto('Sondage : {{ survey_url }}'))).toBe(true);
    expect(estDemandeDAvis(null, texto('Avis : [facebook_review_url|notre page]'))).toBe(true);
    expect(estDemandeDAvis(null, { type: 'send_email', config: { subject: 'Merci', body: '<p>Bonjour</p>', body_en: '<p>Review us: [review_page_url]</p>' } })).toBe(true);
  });

  it('l’action « Demander un avis » et les préréglages d’avis en sont toujours ; un message ordinaire, jamais', () => {
    expect(estDemandeDAvis(null, { type: 'request_review', config: {} })).toBe(true);
    expect(estDemandeDAvis({ preset_key: 'google_review' }, texto('Merci de votre confiance.'))).toBe(true);
    expect(estDemandeDAvis({ preset_key: 'review_reminder_7d' }, { type: 'send_email', config: { subject: 'x', body: 'y' } })).toBe(true);
    expect(estDemandeDAvis({ preset_key: 'thank_you_after_job' }, texto('Merci de votre confiance.'))).toBe(false);
    expect(estDemandeDAvis(null, texto('Votre facture [invoice_number] : [invoice_link]. Écrivez google_review_url si vous voulez.'))).toBe(false);
    // Une action qui n'écrit pas au client n'est jamais une demande d'avis, même dans un préréglage d'avis.
    expect(estDemandeDAvis({ preset_key: 'google_review' }, { type: 'create_task', config: { title: 'Rappeler [google_review_url]' } })).toBe(false);
    expect(estDemandeDAvis(null, null)).toBe(false);
    expect(texteCiteUnAvis(42)).toBe(false);
  });

  it('une règle « demande un avis » dès qu’UNE de ses étapes en est une — parcours ou format d’origine', () => {
    const parcours = { steps: [
      { id: 'e1', type: 'action', action: texto('Merci !'), suivant: 'e2' },
      { id: 'e2', type: 'attendre', delai_secondes: 86400, suivant: 'e3' },
      { id: 'e3', type: 'action', action: texto('Un avis ? [google_review_url]') },
    ] };
    expect(regleDemandeUnAvis(parcours)).toBe(true);
    expect(regleDemandeUnAvis({ actions: [texto('Merci !')] })).toBe(false);
    expect(regleDemandeUnAvis({ actions: [{ type: 'request_review', config: {} }] })).toBe(true);
    // Le parcours gagne sur `actions` : c'est lui que le moteur exécute.
    expect(regleDemandeUnAvis({ steps: [{ id: 'e1', type: 'action', action: texto('Merci !') }], actions: [texto('[google_review_url]')] })).toBe(false);
    expect(canauxDeLaRegle(parcours)).toEqual(['sms']);
    expect(canauxDeLaRegle({ actions: [{ type: 'request_review', config: {} }] })).toEqual(['sms', 'email']);
    // Une automatisation NEUVE (action provisoire « À compléter ») n'envoie rien.
    expect(actionsDUneRegle({ steps: [], actions: [texto('À compléter')] })).toEqual([]);
    expect(canauxDeLaRegle({ steps: [], actions: [texto('À compléter')] })).toEqual([]);
  });

  it('les constantes partagées avec le navigateur sont celles du serveur', () => {
    expect([...PREREGLAGES_D_AVIS]).toEqual([...REVIEW_PRESET_KEYS]);
    expect(CLE_CHAMP_SANS_AVIS).toBe(NO_REVIEW_FIELD_KEY);
    expect([...VARIABLES_D_AVIS]).toEqual(['google_review_url', 'facebook_review_url', 'review_page_url', 'review_link', 'survey_url']);
  });
});
