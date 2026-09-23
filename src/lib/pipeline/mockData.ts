/**
 * Pipeline de ventes — données de maquette
 * ========================================
 * Jeu de données 100 % constant et déterministe pour la maquette du pipeline
 * AVANT-JOB (les leads entrent, avancent, et « Gagné » mène à la création
 * d'une job). Aucun appel réseau, aucune dépendance : tout est écrit en dur.
 *
 * Contexte : entreprise de nettoyage résidentiel/commercial à Montréal.
 * Date de référence (« maintenant ») : MOCK_NOW.
 *
 * Règle : le badge « Job à créer » est DÉRIVÉ (étape gagnée + jobId null),
 * jamais stocké sur le deal.
 */

/** Date de référence de la maquette — sert de « maintenant » à tous les calculs. */
export const MOCK_NOW = '2026-09-23T09:00:00-04:00';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StageKind = 'open' | 'won' | 'lost';

export interface MockStage {
  id: string;
  nameFr: string;
  nameEn: string;
  guidanceFr: string;
  guidanceEn: string;
  position: number;
  kind: StageKind;
  archivedAt: string | null;
}

export type DealSource = 'form_web' | 'meta' | 'manual';

export interface MockDeal {
  id: string;
  stageId: string;
  clientName: string;
  clientEmail: string | null;
  clientPhone: string | null;
  address: string;
  source: DealSource;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  fbclid: string | null;
  assignedUserId: string | null;
  assignedName: string | null;
  createdAt: string;
  stageEnteredAt: string;
  firstContactedAt: string | null;
  lastActivityAt: string;
  wonAt: string | null;
  lostAt: string | null;
  lostReason: string | null;
  lostFromStageId: string | null;
  jobId: string | null;
  jobAmountCents: number | null;
  invoicePaidCents: number | null;
}

export interface MockStageHistory {
  id: string;
  dealId: string;
  fromStageId: string | null;
  toStageId: string;
  actorType: 'user' | 'automation' | 'lumi' | 'system';
  actorName: string | null;
  createdAt: string;
}

export interface MockActivity {
  id: string;
  dealId: string;
  kind: 'note' | 'call' | 'sms' | 'email' | 'stage' | 'action';
  body: string;
  authorName: string | null;
  createdAt: string;
}

export interface MockStageAction {
  id: string;
  stageId: string;
  trigger: 'stage_entered' | 'stage_exited' | 'stage_idle';
  idleDays: number | null;
  actionType: 'send_email' | 'send_sms' | 'create_task' | 'create_notification';
  labelFr: string;
  labelEn: string;
  position: number;
  enabled: boolean;
}

export interface MockMember {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Étapes
// ---------------------------------------------------------------------------

/** Les 6 étapes du pipeline. La guidance est le conseil affiché dans le « Path ». */
export const MOCK_STAGES: MockStage[] = [
  {
    id: 'stg_nouveau',
    nameFr: 'Nouveau lead',
    nameEn: 'New lead',
    guidanceFr: 'Appelle dans les 15 minutes : c’est là que 80 % des soumissions se gagnent. Note le type de surface et la superficie approximative dès le premier contact.',
    guidanceEn: 'Call within 15 minutes — that’s where 80% of quotes are won. Capture the surface type and rough square footage on the first contact.',
    position: 1,
    kind: 'open',
    archivedAt: null,
  },
  {
    id: 'stg_contacte',
    nameFr: 'Contacté',
    nameEn: 'Contacted',
    guidanceFr: 'Qualifie le besoin : fréquence souhaitée, budget, accès au bâtiment. Fixe tout de suite la date de la visite ou envoie la soumission si le besoin est standard.',
    guidanceEn: 'Qualify the need: desired frequency, budget, building access. Book the site visit right away, or send the quote if the job is standard.',
    position: 2,
    kind: 'open',
    archivedAt: null,
  },
  {
    id: 'stg_soumission',
    nameFr: 'Soumission envoyée',
    nameEn: 'Quote sent',
    guidanceFr: 'Confirme la réception par téléphone le lendemain. Une soumission ouverte sans appel de suivi se ferme deux fois moins souvent.',
    guidanceEn: 'Confirm receipt by phone the next day. An open quote with no follow-up call closes half as often.',
    position: 3,
    kind: 'open',
    archivedAt: null,
  },
  {
    id: 'stg_relance',
    nameFr: 'Relance',
    nameEn: 'Follow-up',
    guidanceFr: 'Trois relances maximum, espacées de 3 jours, puis tranche. Propose un rabais première visite ou un essai d’un mois plutôt que de baisser le prix récurrent.',
    guidanceEn: 'Three follow-ups max, three days apart, then decide. Offer a first-visit discount or a one-month trial instead of cutting the recurring price.',
    position: 4,
    kind: 'open',
    archivedAt: null,
  },
  {
    id: 'stg_gagne',
    nameFr: 'Gagné',
    nameEn: 'Won',
    guidanceFr: 'Crée la job immédiatement pour bloquer la date dans l’horaire. Confirme l’accès (codes, clés, stationnement) avant la première visite.',
    guidanceEn: 'Create the job right away to lock the date in the schedule. Confirm access (codes, keys, parking) before the first visit.',
    position: 5,
    kind: 'won',
    archivedAt: null,
  },
  {
    id: 'stg_perdu',
    nameFr: 'Perdu',
    nameEn: 'Lost',
    guidanceFr: 'Note la vraie raison, pas « pas intéressé » : c’est ce qui ajuste les prix. Remets un rappel à 6 mois si le client a simplement reporté.',
    guidanceEn: 'Log the real reason, not “not interested” — that’s what tunes pricing. Set a 6-month reminder if the client merely postponed.',
    position: 6,
    kind: 'lost',
    archivedAt: null,
  },
];

// ---------------------------------------------------------------------------
// Membres
// ---------------------------------------------------------------------------

export const MOCK_MEMBERS: MockMember[] = [
  { id: 'mbr_marie_eve', name: 'Marie-Ève Tremblay' },
  { id: 'mbr_alexandre', name: 'Alexandre Roy' },
  { id: 'mbr_sophie', name: 'Sophie Bergeron' },
  { id: 'mbr_karim', name: 'Karim Haddad' },
];

// ---------------------------------------------------------------------------
// Deals — 25, répartis sur les 12 dernières semaines avant MOCK_NOW
// ---------------------------------------------------------------------------

/**
 * 25 deals : 8 ouverts (étapes 1 à 4), 9 gagnés, 4 perdus, plus 4 ouverts
 * supplémentaires en relance/soumission. Les fbclid sont des chaînes plausibles
 * (format `IwAR…`), volontairement inertes.
 */
export const MOCK_DEALS: MockDeal[] = [
  // --- Ouverts : Nouveau lead -----------------------------------------------
  {
    id: 'deal_01',
    stageId: 'stg_nouveau',
    clientName: 'Geneviève Lapointe',
    clientEmail: 'g.lapointe@videotron.ca',
    clientPhone: '514-555-0182',
    address: '4230 rue Saint-Denis, Montréal, QC H2J 2K9',
    source: 'form_web',
    utmSource: 'google',
    utmMedium: 'organic',
    utmCampaign: null,
    utmContent: null,
    fbclid: null,
    assignedUserId: 'mbr_marie_eve',
    assignedName: 'Marie-Ève Tremblay',
    createdAt: '2026-09-22T08:12:00-04:00',
    stageEnteredAt: '2026-09-22T08:12:00-04:00',
    firstContactedAt: null,
    lastActivityAt: '2026-09-22T08:12:00-04:00',
    wonAt: null,
    lostAt: null,
    lostReason: null,
    lostFromStageId: null,
    jobId: null,
    jobAmountCents: null,
    invoicePaidCents: null,
  },
  {
    id: 'deal_02',
    stageId: 'stg_nouveau',
    clientName: 'Syndicat Le Grand Sault',
    clientEmail: 'admin@legrandsault.qc.ca',
    clientPhone: '450-555-0447',
    address: '1875 boulevard des Laurentides, Laval, QC H7M 2P4',
    source: 'meta',
    utmSource: 'facebook',
    utmMedium: 'paid_social',
    utmCampaign: 'meta_commercial_q3',
    utmContent: 'carrousel_tarifs',
    fbclid: 'IwAR2kQ7xTn4pLm9bVzR8dFhGw1sJcE0aYuNqXoP3MiKtB6H',
    assignedUserId: null,
    assignedName: null,
    createdAt: '2026-09-21T14:40:00-04:00',
    stageEnteredAt: '2026-09-21T14:40:00-04:00',
    firstContactedAt: null,
    lastActivityAt: '2026-09-21T14:40:00-04:00',
    wonAt: null,
    lostAt: null,
    lostReason: null,
    lostFromStageId: null,
    jobId: null,
    jobAmountCents: null,
    invoicePaidCents: null,
  },
  {
    id: 'deal_03',
    stageId: 'stg_nouveau',
    clientName: 'Mathieu Ouellet',
    clientEmail: 'mathieu.ouellet@gmail.com',
    clientPhone: '438-555-0913',
    address: '720 avenue Bernard, Outremont, QC H2V 1T7',
    source: 'manual',
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    fbclid: null,
    assignedUserId: 'mbr_karim',
    assignedName: 'Karim Haddad',
    createdAt: '2026-09-19T11:05:00-04:00',
    stageEnteredAt: '2026-09-19T11:05:00-04:00',
    firstContactedAt: '2026-09-19T11:48:00-04:00', // < 1 h
    lastActivityAt: '2026-09-19T11:48:00-04:00',
    wonAt: null,
    lostAt: null,
    lostReason: null,
    lostFromStageId: null,
    jobId: null,
    jobAmountCents: null,
    invoicePaidCents: null,
  },

  // --- Ouverts : Contacté ---------------------------------------------------
  {
    id: 'deal_04',
    stageId: 'stg_contacte',
    clientName: 'Julie Charbonneau',
    clientEmail: 'jcharbonneau@outlook.com',
    clientPhone: '514-555-0338',
    address: '2915 rue Sherbrooke Est, Montréal, QC H1W 1B7',
    source: 'meta',
    utmSource: 'facebook',
    utmMedium: 'paid_social',
    utmCampaign: 'meta_nettoyage_printemps',
    utmContent: 'video_avant_apres',
    fbclid: 'IwAR8jHqZ3vCmR7nLbTyU4wXdKp0eSgF2aQiOoM5NrJhV9Bz',
    assignedUserId: 'mbr_sophie',
    assignedName: 'Sophie Bergeron',
    createdAt: '2026-09-15T09:22:00-04:00',
    stageEnteredAt: '2026-09-16T10:05:00-04:00',
    firstContactedAt: '2026-09-16T10:05:00-04:00', // > 24 h
    lastActivityAt: '2026-09-18T15:30:00-04:00',
    wonAt: null,
    lostAt: null,
    lostReason: null,
    lostFromStageId: null,
    jobId: null,
    jobAmountCents: null,
    invoicePaidCents: null,
  },
  {
    id: 'deal_05',
    stageId: 'stg_contacte',
    clientName: 'Clinique dentaire Rosemont',
    clientEmail: 'reception@dentaire-rosemont.ca',
    clientPhone: '514-555-0761',
    address: '3400 boulevard Rosemont, Montréal, QC H1X 1K2',
    source: 'form_web',
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    fbclid: null,
    assignedUserId: 'mbr_alexandre',
    assignedName: 'Alexandre Roy',
    createdAt: '2026-09-11T13:17:00-04:00',
    stageEnteredAt: '2026-09-11T16:02:00-04:00',
    firstContactedAt: '2026-09-11T16:02:00-04:00', // < 24 h
    lastActivityAt: '2026-09-12T09:10:00-04:00',
    wonAt: null,
    lostAt: null,
    lostReason: null,
    lostFromStageId: null,
    jobId: null,
    jobAmountCents: null,
    invoicePaidCents: null,
  },

  // --- Ouverts : Soumission envoyée ----------------------------------------
  {
    id: 'deal_06',
    stageId: 'stg_soumission',
    clientName: 'Pierre-Luc Gagnon',
    clientEmail: 'pl.gagnon@hotmail.com',
    clientPhone: '450-555-0295',
    address: '188 rue Saint-Charles Ouest, Longueuil, QC J4H 1C8',
    source: 'meta',
    utmSource: 'facebook',
    utmMedium: 'paid_social',
    utmCampaign: 'meta_retargeting_devis',
    utmContent: 'video_avant_apres',
    fbclid: 'IwAR5tYbN8pQwE2sVzL6cRdMhJ1kXoA9fUiGrT0nBvCyD4Ke',
    assignedUserId: 'mbr_marie_eve',
    assignedName: 'Marie-Ève Tremblay',
    createdAt: '2026-09-08T10:44:00-04:00',
    stageEnteredAt: '2026-09-10T14:20:00-04:00',
    firstContactedAt: '2026-09-08T11:20:00-04:00', // < 1 h
    lastActivityAt: '2026-09-10T14:20:00-04:00',
    wonAt: null,
    lostAt: null,
    lostReason: null,
    lostFromStageId: null,
    jobId: null,
    jobAmountCents: null,
    invoicePaidCents: null,
  },
  {
    id: 'deal_07',
    stageId: 'stg_soumission',
    clientName: 'Immeubles Côté-Vertu inc.',
    clientEmail: 'gestion@cotevertu-immeubles.com',
    clientPhone: '514-555-0620',
    address: '2540 boulevard Côte-Vertu, Saint-Laurent, QC H4R 1P8',
    source: 'manual',
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    fbclid: null,
    assignedUserId: 'mbr_alexandre',
    assignedName: 'Alexandre Roy',
    createdAt: '2026-09-02T08:30:00-04:00',
    stageEnteredAt: '2026-09-05T11:15:00-04:00',
    firstContactedAt: '2026-09-02T14:05:00-04:00', // < 24 h
    lastActivityAt: '2026-09-05T11:15:00-04:00',
    wonAt: null,
    lostAt: null,
    lostReason: null,
    lostFromStageId: null,
    jobId: null,
    jobAmountCents: null,
    invoicePaidCents: null,
  },
  {
    id: 'deal_08',
    stageId: 'stg_soumission',
    clientName: 'Nadia Bouchard',
    clientEmail: 'nadia.bouchard@gmail.com',
    clientPhone: '438-555-0174',
    address: '6710 rue Beaubien Est, Montréal, QC H1M 1B3',
    source: 'form_web',
    utmSource: 'google',
    utmMedium: 'organic',
    utmCampaign: null,
    utmContent: null,
    fbclid: null,
    assignedUserId: null,
    assignedName: null,
    createdAt: '2026-08-28T16:10:00-04:00',
    stageEnteredAt: '2026-09-01T09:40:00-04:00',
    firstContactedAt: '2026-08-29T09:15:00-04:00', // > 24 h
    lastActivityAt: '2026-09-01T09:40:00-04:00',
    wonAt: null,
    lostAt: null,
    lostReason: null,
    lostFromStageId: null,
    jobId: null,
    jobAmountCents: null,
    invoicePaidCents: null,
  },

  // --- Ouverts : Relance ----------------------------------------------------
  {
    id: 'deal_09',
    stageId: 'stg_relance',
    clientName: 'Restaurant Chez Odette',
    clientEmail: 'info@chezodette.ca',
    clientPhone: '514-555-0509',
    address: '1201 rue Wellington, Verdun, QC H4G 1V7',
    source: 'meta',
    utmSource: 'facebook',
    utmMedium: 'paid_social',
    utmCampaign: 'meta_commercial_q3',
    utmContent: 'carrousel_tarifs',
    fbclid: 'IwAR1mLpX9dRcV5qZwB3nTyHkJ8sGeA0oUfPiM6rNvKtC2Yj',
    assignedUserId: 'mbr_sophie',
    assignedName: 'Sophie Bergeron',
    createdAt: '2026-08-24T12:05:00-04:00',
    stageEnteredAt: '2026-09-03T10:00:00-04:00',
    firstContactedAt: '2026-08-24T12:50:00-04:00', // < 1 h
    lastActivityAt: '2026-09-12T14:25:00-04:00',
    wonAt: null,
    lostAt: null,
    lostReason: null,
    lostFromStageId: null,
    jobId: null,
    jobAmountCents: null,
    invoicePaidCents: null,
  },
  {
    id: 'deal_10',
    stageId: 'stg_relance',
    clientName: 'François Deschamps',
    clientEmail: 'f.deschamps@videotron.ca',
    clientPhone: '450-555-0836',
    address: '455 rue Guillaume, Longueuil, QC J4K 2X3',
    source: 'manual',
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    fbclid: null,
    assignedUserId: 'mbr_karim',
    assignedName: 'Karim Haddad',
    createdAt: '2026-08-18T09:30:00-04:00',
    stageEnteredAt: '2026-08-31T11:45:00-04:00',
    firstContactedAt: '2026-08-19T14:10:00-04:00', // > 24 h
    lastActivityAt: '2026-09-04T16:05:00-04:00',
    wonAt: null,
    lostAt: null,
    lostReason: null,
    lostFromStageId: null,
    jobId: null,
    jobAmountCents: null,
    invoicePaidCents: null,
  },
  {
    id: 'deal_11',
    stageId: 'stg_relance',
    clientName: 'Garderie Les Petits Pas',
    clientEmail: 'direction@lespetitspas.qc.ca',
    clientPhone: '514-555-0288',
    address: '3810 rue Ontario Est, Montréal, QC H1W 1S5',
    source: 'form_web',
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    fbclid: null,
    assignedUserId: 'mbr_marie_eve',
    assignedName: 'Marie-Ève Tremblay',
    createdAt: '2026-08-12T15:20:00-04:00',
    stageEnteredAt: '2026-08-26T09:15:00-04:00',
    firstContactedAt: '2026-08-12T16:05:00-04:00', // < 1 h
    lastActivityAt: '2026-08-30T10:40:00-04:00',
    wonAt: null,
    lostAt: null,
    lostReason: null,
    lostFromStageId: null,
    jobId: null,
    jobAmountCents: null,
    invoicePaidCents: null,
  },
  {
    id: 'deal_12',
    stageId: 'stg_relance',
    clientName: 'Stéphanie Lavoie',
    clientEmail: 'steph.lavoie@gmail.com',
    clientPhone: '438-555-0655',
    address: '990 rue de la Montagne, Montréal, QC H3G 1L7',
    source: 'meta',
    utmSource: 'facebook',
    utmMedium: 'paid_social',
    utmCampaign: 'meta_nettoyage_printemps',
    utmContent: 'temoignage_client',
    fbclid: 'IwAR7bKvH2nQsE9pLmXtY4dRwG3jCfU1aOiZrT8yNvBcM0Ke',
    assignedUserId: null,
    assignedName: null,
    createdAt: '2026-08-06T10:12:00-04:00',
    stageEnteredAt: '2026-08-20T13:30:00-04:00',
    firstContactedAt: '2026-08-06T21:45:00-04:00', // < 24 h
    lastActivityAt: '2026-08-22T11:20:00-04:00',
    wonAt: null,
    lostAt: null,
    lostReason: null,
    lostFromStageId: null,
    jobId: null,
    jobAmountCents: null,
    invoicePaidCents: null,
  },

  // --- Gagnés ---------------------------------------------------------------
  {
    id: 'deal_13',
    stageId: 'stg_gagne',
    clientName: 'Bureau comptable Fortin & Associés',
    clientEmail: 'bureau@fortin-associes.ca',
    clientPhone: '514-555-0141',
    address: '1250 boulevard René-Lévesque Ouest, Montréal, QC H3B 4W8',
    source: 'meta',
    utmSource: 'facebook',
    utmMedium: 'paid_social',
    utmCampaign: 'meta_commercial_q3',
    utmContent: 'carrousel_tarifs',
    fbclid: 'IwAR3nPqW6xTcL8mZvR1yHdKjG5sBeA2oUfIrN9tMvXyC4Jk',
    assignedUserId: 'mbr_alexandre',
    assignedName: 'Alexandre Roy',
    createdAt: '2026-09-04T08:50:00-04:00',
    stageEnteredAt: '2026-09-17T15:10:00-04:00',
    firstContactedAt: '2026-09-04T09:25:00-04:00', // < 1 h
    lastActivityAt: '2026-09-17T15:10:00-04:00',
    wonAt: '2026-09-17T15:10:00-04:00',
    lostAt: null,
    lostReason: null,
    lostFromStageId: null,
    jobId: null, // « Job à créer » — badge dérivé
    jobAmountCents: null,
    invoicePaidCents: null,
  },
  {
    id: 'deal_14',
    stageId: 'stg_gagne',
    clientName: 'Marc-André Pelletier',
    clientEmail: 'ma.pelletier@outlook.com',
    clientPhone: '450-555-0733',
    address: '3055 avenue du Bois, Laval, QC H7W 5B1',
    source: 'form_web',
    utmSource: 'google',
    utmMedium: 'organic',
    utmCampaign: null,
    utmContent: null,
    fbclid: null,
    assignedUserId: 'mbr_sophie',
    assignedName: 'Sophie Bergeron',
    createdAt: '2026-09-09T11:30:00-04:00',
    stageEnteredAt: '2026-09-20T10:05:00-04:00',
    firstContactedAt: '2026-09-10T08:40:00-04:00', // > 24 h
    lastActivityAt: '2026-09-20T10:05:00-04:00',
    wonAt: '2026-09-20T10:05:00-04:00',
    lostAt: null,
    lostReason: null,
    lostFromStageId: null,
    jobId: null, // « Job à créer » — badge dérivé
    jobAmountCents: null,
    invoicePaidCents: null,
  },
  {
    id: 'deal_15',
    stageId: 'stg_gagne',
    clientName: 'Résidence Le Bel Âge',
    clientEmail: 'administration@lebelage.qc.ca',
    clientPhone: '514-555-0492',
    address: '7200 rue Sherbrooke Est, Montréal, QC H1N 1E7',
    source: 'meta',
    utmSource: 'facebook',
    utmMedium: 'paid_social',
    utmCampaign: 'meta_commercial_q3',
    utmContent: 'video_avant_apres',
    fbclid: 'IwAR9qMtZ4vBnR7cLpXwY2dHkJ6sGeF0aOiUrT3yNvKcD8Bm',
    assignedUserId: 'mbr_alexandre',
    assignedName: 'Alexandre Roy',
    createdAt: '2026-08-14T09:15:00-04:00',
    stageEnteredAt: '2026-09-01T14:00:00-04:00',
    firstContactedAt: '2026-08-14T09:52:00-04:00', // < 1 h
    lastActivityAt: '2026-09-15T11:30:00-04:00',
    wonAt: '2026-09-01T14:00:00-04:00',
    lostAt: null,
    lostReason: null,
    lostFromStageId: null,
    jobId: 'job_2041',
    jobAmountCents: 448000,
    invoicePaidCents: 448000,
  },
  {
    id: 'deal_16',
    stageId: 'stg_gagne',
    clientName: 'Caroline Fournier',
    clientEmail: 'caroline.fournier@gmail.com',
    clientPhone: '438-555-0207',
    address: '5420 rue Clark, Montréal, QC H2T 2V5',
    source: 'form_web',
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    fbclid: null,
    assignedUserId: 'mbr_marie_eve',
    assignedName: 'Marie-Ève Tremblay',
    createdAt: '2026-08-21T13:40:00-04:00',
    stageEnteredAt: '2026-09-02T10:20:00-04:00',
    firstContactedAt: '2026-08-21T14:10:00-04:00', // < 1 h
    lastActivityAt: '2026-09-08T09:05:00-04:00',
    wonAt: '2026-09-02T10:20:00-04:00',
    lostAt: null,
    lostReason: null,
    lostFromStageId: null,
    jobId: 'job_2042',
    jobAmountCents: 42500,
    invoicePaidCents: 42500,
  },
  {
    id: 'deal_17',
    stageId: 'stg_gagne',
    clientName: 'Boutique Verdure & Cie',
    clientEmail: 'contact@verdureetcie.ca',
    clientPhone: '514-555-0378',
    address: '4055 rue Notre-Dame Ouest, Montréal, QC H4C 1R2',
    source: 'meta',
    utmSource: 'facebook',
    utmMedium: 'paid_social',
    utmCampaign: 'meta_retargeting_devis',
    utmContent: 'carrousel_tarifs',
    fbclid: 'IwAR4jRvK8pQnM2sLzXtY9dHwG1cBeA5oUfIrT6yNmVcP0Xk',
    assignedUserId: 'mbr_karim',
    assignedName: 'Karim Haddad',
    createdAt: '2026-08-07T15:55:00-04:00',
    stageEnteredAt: '2026-08-25T11:40:00-04:00',
    firstContactedAt: '2026-08-08T10:30:00-04:00', // > 24 h
    lastActivityAt: '2026-09-05T13:15:00-04:00',
    wonAt: '2026-08-25T11:40:00-04:00',
    lostAt: null,
    lostReason: null,
    lostFromStageId: null,
    jobId: 'job_2043',
    jobAmountCents: 187500,
    invoicePaidCents: 93750,
  },
  {
    id: 'deal_18',
    stageId: 'stg_gagne',
    clientName: 'Isabelle Morin',
    clientEmail: 'isabelle.morin@videotron.ca',
    clientPhone: '450-555-0916',
    address: '1140 rue de Normandie, Longueuil, QC J4J 4M9',
    source: 'manual',
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    fbclid: null,
    assignedUserId: 'mbr_sophie',
    assignedName: 'Sophie Bergeron',
    createdAt: '2026-07-31T10:05:00-04:00',
    stageEnteredAt: '2026-08-18T14:50:00-04:00',
    firstContactedAt: '2026-07-31T16:20:00-04:00', // < 24 h
    lastActivityAt: '2026-08-28T09:45:00-04:00',
    wonAt: '2026-08-18T14:50:00-04:00',
    lostAt: null,
    lostReason: null,
    lostFromStageId: null,
    jobId: 'job_2044',
    jobAmountCents: 31000,
    invoicePaidCents: 31000,
  },
  {
    id: 'deal_19',
    stageId: 'stg_gagne',
    clientName: 'Entrepôt Logi-Nord',
    clientEmail: 'operations@loginord.com',
    clientPhone: '450-555-0124',
    address: '2200 boulevard Industriel, Laval, QC H7S 1P6',
    source: 'meta',
    utmSource: 'facebook',
    utmMedium: 'paid_social',
    utmCampaign: 'meta_commercial_q3',
    utmContent: 'temoignage_client',
    fbclid: 'IwAR6tNbY3vCmQ8pLwXzR4dKhJ0sGfA7oUiZrM2yNvBtD5Je',
    assignedUserId: 'mbr_alexandre',
    assignedName: 'Alexandre Roy',
    createdAt: '2026-07-24T08:20:00-04:00',
    stageEnteredAt: '2026-08-12T16:30:00-04:00',
    firstContactedAt: '2026-07-24T08:55:00-04:00', // < 1 h
    lastActivityAt: '2026-09-10T10:10:00-04:00',
    wonAt: '2026-08-12T16:30:00-04:00',
    lostAt: null,
    lostReason: null,
    lostFromStageId: null,
    jobId: 'job_2045',
    jobAmountCents: 396000,
    invoicePaidCents: 396000,
  },
  {
    id: 'deal_20',
    stageId: 'stg_gagne',
    clientName: 'Daniel Bergevin',
    clientEmail: 'dbergevin@hotmail.com',
    clientPhone: '514-555-0567',
    address: '8125 rue Lajeunesse, Montréal, QC H2P 2M6',
    source: 'form_web',
    utmSource: 'google',
    utmMedium: 'organic',
    utmCampaign: null,
    utmContent: null,
    fbclid: null,
    assignedUserId: 'mbr_karim',
    assignedName: 'Karim Haddad',
    createdAt: '2026-07-17T14:15:00-04:00',
    stageEnteredAt: '2026-08-04T09:30:00-04:00',
    firstContactedAt: '2026-07-18T11:40:00-04:00', // > 24 h
    lastActivityAt: '2026-08-14T15:20:00-04:00',
    wonAt: '2026-08-04T09:30:00-04:00',
    lostAt: null,
    lostReason: null,
    lostFromStageId: null,
    jobId: 'job_2046',
    jobAmountCents: 18000,
    invoicePaidCents: 18000,
  },
  {
    id: 'deal_21',
    stageId: 'stg_gagne',
    clientName: 'Copropriété Les Terrasses du Parc',
    clientEmail: 'ca@terrassesduparc.ca',
    clientPhone: '514-555-0810',
    address: '5600 avenue du Parc, Montréal, QC H2V 4H1',
    source: 'form_web',
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    fbclid: null,
    assignedUserId: 'mbr_marie_eve',
    assignedName: 'Marie-Ève Tremblay',
    createdAt: '2026-07-08T09:45:00-04:00',
    stageEnteredAt: '2026-07-29T13:10:00-04:00',
    firstContactedAt: '2026-07-08T10:20:00-04:00', // < 1 h
    lastActivityAt: '2026-08-20T11:50:00-04:00',
    wonAt: '2026-07-29T13:10:00-04:00',
    lostAt: null,
    lostReason: null,
    lostFromStageId: null,
    jobId: 'job_2047',
    jobAmountCents: 264000,
    invoicePaidCents: 132000,
  },

  // --- Perdus ---------------------------------------------------------------
  {
    id: 'deal_22',
    stageId: 'stg_perdu',
    clientName: 'Véronique Desjardins',
    clientEmail: 'v.desjardins@gmail.com',
    clientPhone: '438-555-0431',
    address: '2610 rue Masson, Montréal, QC H1Y 1V4',
    source: 'meta',
    utmSource: 'facebook',
    utmMedium: 'paid_social',
    utmCampaign: 'meta_nettoyage_printemps',
    utmContent: 'video_avant_apres',
    fbclid: 'IwAR0pLqX5dRvC9nMwB2yTkHjG8sEeA3oUfIrN7tMvZcK1Yb',
    assignedUserId: 'mbr_sophie',
    assignedName: 'Sophie Bergeron',
    createdAt: '2026-09-01T10:30:00-04:00',
    stageEnteredAt: '2026-09-14T16:20:00-04:00',
    firstContactedAt: '2026-09-01T11:05:00-04:00', // < 1 h
    lastActivityAt: '2026-09-14T16:20:00-04:00',
    wonAt: null,
    lostAt: '2026-09-14T16:20:00-04:00',
    lostReason: 'Prix trop élevé',
    lostFromStageId: 'stg_soumission',
    jobId: null,
    jobAmountCents: null,
    invoicePaidCents: null,
  },
  {
    id: 'deal_23',
    stageId: 'stg_perdu',
    clientName: 'Atelier mécanique Rive-Sud',
    clientEmail: 'info@mecaniquerivesud.ca',
    clientPhone: '450-555-0672',
    address: '780 chemin de Chambly, Longueuil, QC J4H 3L8',
    source: 'manual',
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    fbclid: null,
    assignedUserId: 'mbr_karim',
    assignedName: 'Karim Haddad',
    createdAt: '2026-08-19T13:05:00-04:00',
    stageEnteredAt: '2026-09-06T09:50:00-04:00',
    firstContactedAt: '2026-08-21T10:15:00-04:00', // > 24 h
    lastActivityAt: '2026-09-06T09:50:00-04:00',
    wonAt: null,
    lostAt: '2026-09-06T09:50:00-04:00',
    lostReason: 'A choisi un concurrent',
    lostFromStageId: 'stg_relance',
    jobId: null,
    jobAmountCents: null,
    invoicePaidCents: null,
  },
  {
    id: 'deal_24',
    stageId: 'stg_perdu',
    clientName: 'Luc Théberge',
    clientEmail: null,
    clientPhone: '514-555-0959',
    address: '1445 rue Fleury Est, Montréal, QC H2C 1S6',
    source: 'meta',
    utmSource: 'facebook',
    utmMedium: 'paid_social',
    utmCampaign: 'meta_retargeting_devis',
    utmContent: 'temoignage_client',
    fbclid: 'IwAR2vKmZ7pQtN4sLxXwY1dRhJ9cGeB6oUfIaT0yNrVcM3Jp',
    assignedUserId: 'mbr_marie_eve',
    assignedName: 'Marie-Ève Tremblay',
    createdAt: '2026-08-03T11:25:00-04:00',
    stageEnteredAt: '2026-08-27T14:40:00-04:00',
    firstContactedAt: '2026-08-03T12:10:00-04:00', // < 1 h
    lastActivityAt: '2026-08-27T14:40:00-04:00',
    wonAt: null,
    lostAt: '2026-08-27T14:40:00-04:00',
    lostReason: 'Ne répond plus',
    lostFromStageId: 'stg_relance',
    jobId: null,
    jobAmountCents: null,
    invoicePaidCents: null,
  },
  {
    id: 'deal_25',
    stageId: 'stg_perdu',
    clientName: 'Ferme Les Trois Érables',
    clientEmail: 'contact@troiserables.qc.ca',
    clientPhone: '450-555-0349',
    address: '312 rang Saint-Antoine, Saint-Hyacinthe, QC J2S 7B2',
    source: 'form_web',
    utmSource: 'google',
    utmMedium: 'organic',
    utmCampaign: null,
    utmContent: null,
    fbclid: null,
    assignedUserId: 'mbr_alexandre',
    assignedName: 'Alexandre Roy',
    createdAt: '2026-07-14T15:40:00-04:00',
    stageEnteredAt: '2026-07-16T09:05:00-04:00',
    firstContactedAt: '2026-07-15T09:30:00-04:00', // > 24 h
    lastActivityAt: '2026-07-16T09:05:00-04:00',
    wonAt: null,
    lostAt: '2026-07-16T09:05:00-04:00',
    lostReason: 'Hors territoire',
    lostFromStageId: 'stg_contacte',
    jobId: null,
    jobAmountCents: null,
    invoicePaidCents: null,
  },
];

// ---------------------------------------------------------------------------
// Historique d'étapes — 52 entrées, cohérentes avec les deals
// ---------------------------------------------------------------------------

export const MOCK_STAGE_HISTORY: MockStageHistory[] = [
  // deal_01 — Nouveau lead
  { id: 'hist_001', dealId: 'deal_01', fromStageId: null, toStageId: 'stg_nouveau', actorType: 'system', actorName: null, createdAt: '2026-09-22T08:12:00-04:00' },
  // deal_02 — Nouveau lead (arrivé par Meta)
  { id: 'hist_002', dealId: 'deal_02', fromStageId: null, toStageId: 'stg_nouveau', actorType: 'system', actorName: null, createdAt: '2026-09-21T14:40:00-04:00' },
  // deal_03 — Nouveau lead
  { id: 'hist_003', dealId: 'deal_03', fromStageId: null, toStageId: 'stg_nouveau', actorType: 'user', actorName: 'Karim Haddad', createdAt: '2026-09-19T11:05:00-04:00' },
  // deal_04 — jusqu'à Contacté
  { id: 'hist_004', dealId: 'deal_04', fromStageId: null, toStageId: 'stg_nouveau', actorType: 'system', actorName: null, createdAt: '2026-09-15T09:22:00-04:00' },
  { id: 'hist_005', dealId: 'deal_04', fromStageId: 'stg_nouveau', toStageId: 'stg_contacte', actorType: 'user', actorName: 'Sophie Bergeron', createdAt: '2026-09-16T10:05:00-04:00' },
  // deal_05 — jusqu'à Contacté
  { id: 'hist_006', dealId: 'deal_05', fromStageId: null, toStageId: 'stg_nouveau', actorType: 'system', actorName: null, createdAt: '2026-09-11T13:17:00-04:00' },
  { id: 'hist_007', dealId: 'deal_05', fromStageId: 'stg_nouveau', toStageId: 'stg_contacte', actorType: 'user', actorName: 'Alexandre Roy', createdAt: '2026-09-11T16:02:00-04:00' },
  // deal_06 — jusqu'à Soumission
  { id: 'hist_008', dealId: 'deal_06', fromStageId: null, toStageId: 'stg_nouveau', actorType: 'system', actorName: null, createdAt: '2026-09-08T10:44:00-04:00' },
  { id: 'hist_009', dealId: 'deal_06', fromStageId: 'stg_nouveau', toStageId: 'stg_contacte', actorType: 'user', actorName: 'Marie-Ève Tremblay', createdAt: '2026-09-08T11:20:00-04:00' },
  { id: 'hist_010', dealId: 'deal_06', fromStageId: 'stg_contacte', toStageId: 'stg_soumission', actorType: 'automation', actorName: 'Soumission envoyée', createdAt: '2026-09-10T14:20:00-04:00' },
  // deal_07 — jusqu'à Soumission
  { id: 'hist_011', dealId: 'deal_07', fromStageId: null, toStageId: 'stg_nouveau', actorType: 'user', actorName: 'Alexandre Roy', createdAt: '2026-09-02T08:30:00-04:00' },
  { id: 'hist_012', dealId: 'deal_07', fromStageId: 'stg_nouveau', toStageId: 'stg_contacte', actorType: 'user', actorName: 'Alexandre Roy', createdAt: '2026-09-02T14:05:00-04:00' },
  { id: 'hist_013', dealId: 'deal_07', fromStageId: 'stg_contacte', toStageId: 'stg_soumission', actorType: 'automation', actorName: 'Soumission envoyée', createdAt: '2026-09-05T11:15:00-04:00' },
  // deal_08 — jusqu'à Soumission
  { id: 'hist_014', dealId: 'deal_08', fromStageId: null, toStageId: 'stg_nouveau', actorType: 'system', actorName: null, createdAt: '2026-08-28T16:10:00-04:00' },
  { id: 'hist_015', dealId: 'deal_08', fromStageId: 'stg_nouveau', toStageId: 'stg_contacte', actorType: 'user', actorName: 'Marie-Ève Tremblay', createdAt: '2026-08-29T09:15:00-04:00' },
  { id: 'hist_016', dealId: 'deal_08', fromStageId: 'stg_contacte', toStageId: 'stg_soumission', actorType: 'automation', actorName: 'Soumission envoyée', createdAt: '2026-09-01T09:40:00-04:00' },
  // deal_09 — jusqu'à Relance
  { id: 'hist_017', dealId: 'deal_09', fromStageId: null, toStageId: 'stg_nouveau', actorType: 'system', actorName: null, createdAt: '2026-08-24T12:05:00-04:00' },
  { id: 'hist_018', dealId: 'deal_09', fromStageId: 'stg_nouveau', toStageId: 'stg_contacte', actorType: 'user', actorName: 'Sophie Bergeron', createdAt: '2026-08-24T12:50:00-04:00' },
  { id: 'hist_019', dealId: 'deal_09', fromStageId: 'stg_contacte', toStageId: 'stg_soumission', actorType: 'automation', actorName: 'Soumission envoyée', createdAt: '2026-08-28T10:30:00-04:00' },
  { id: 'hist_020', dealId: 'deal_09', fromStageId: 'stg_soumission', toStageId: 'stg_relance', actorType: 'automation', actorName: 'Sans réponse 3 jours', createdAt: '2026-09-03T10:00:00-04:00' },
  // deal_10 — jusqu'à Relance
  { id: 'hist_021', dealId: 'deal_10', fromStageId: null, toStageId: 'stg_nouveau', actorType: 'user', actorName: 'Karim Haddad', createdAt: '2026-08-18T09:30:00-04:00' },
  { id: 'hist_022', dealId: 'deal_10', fromStageId: 'stg_nouveau', toStageId: 'stg_contacte', actorType: 'user', actorName: 'Karim Haddad', createdAt: '2026-08-19T14:10:00-04:00' },
  { id: 'hist_023', dealId: 'deal_10', fromStageId: 'stg_contacte', toStageId: 'stg_soumission', actorType: 'automation', actorName: 'Soumission envoyée', createdAt: '2026-08-25T15:20:00-04:00' },
  { id: 'hist_024', dealId: 'deal_10', fromStageId: 'stg_soumission', toStageId: 'stg_relance', actorType: 'lumi', actorName: 'Lumi', createdAt: '2026-08-31T11:45:00-04:00' },
  // deal_11 — jusqu'à Relance
  { id: 'hist_025', dealId: 'deal_11', fromStageId: null, toStageId: 'stg_nouveau', actorType: 'system', actorName: null, createdAt: '2026-08-12T15:20:00-04:00' },
  { id: 'hist_026', dealId: 'deal_11', fromStageId: 'stg_nouveau', toStageId: 'stg_contacte', actorType: 'user', actorName: 'Marie-Ève Tremblay', createdAt: '2026-08-12T16:05:00-04:00' },
  { id: 'hist_027', dealId: 'deal_11', fromStageId: 'stg_contacte', toStageId: 'stg_soumission', actorType: 'automation', actorName: 'Soumission envoyée', createdAt: '2026-08-19T09:50:00-04:00' },
  { id: 'hist_028', dealId: 'deal_11', fromStageId: 'stg_soumission', toStageId: 'stg_relance', actorType: 'automation', actorName: 'Sans réponse 7 jours', createdAt: '2026-08-26T09:15:00-04:00' },
  // deal_12 — jusqu'à Relance
  { id: 'hist_029', dealId: 'deal_12', fromStageId: null, toStageId: 'stg_nouveau', actorType: 'system', actorName: null, createdAt: '2026-08-06T10:12:00-04:00' },
  { id: 'hist_030', dealId: 'deal_12', fromStageId: 'stg_nouveau', toStageId: 'stg_contacte', actorType: 'user', actorName: 'Sophie Bergeron', createdAt: '2026-08-06T21:45:00-04:00' },
  { id: 'hist_031', dealId: 'deal_12', fromStageId: 'stg_contacte', toStageId: 'stg_soumission', actorType: 'automation', actorName: 'Soumission envoyée', createdAt: '2026-08-13T11:00:00-04:00' },
  { id: 'hist_032', dealId: 'deal_12', fromStageId: 'stg_soumission', toStageId: 'stg_relance', actorType: 'automation', actorName: 'Sans réponse 7 jours', createdAt: '2026-08-20T13:30:00-04:00' },
  // deal_13 — gagné sans job
  { id: 'hist_033', dealId: 'deal_13', fromStageId: null, toStageId: 'stg_nouveau', actorType: 'system', actorName: null, createdAt: '2026-09-04T08:50:00-04:00' },
  { id: 'hist_034', dealId: 'deal_13', fromStageId: 'stg_nouveau', toStageId: 'stg_contacte', actorType: 'user', actorName: 'Alexandre Roy', createdAt: '2026-09-04T09:25:00-04:00' },
  { id: 'hist_035', dealId: 'deal_13', fromStageId: 'stg_contacte', toStageId: 'stg_soumission', actorType: 'automation', actorName: 'Soumission envoyée', createdAt: '2026-09-08T13:40:00-04:00' },
  { id: 'hist_036', dealId: 'deal_13', fromStageId: 'stg_soumission', toStageId: 'stg_gagne', actorType: 'user', actorName: 'Alexandre Roy', createdAt: '2026-09-17T15:10:00-04:00' },
  // deal_14 — gagné sans job
  { id: 'hist_037', dealId: 'deal_14', fromStageId: null, toStageId: 'stg_nouveau', actorType: 'system', actorName: null, createdAt: '2026-09-09T11:30:00-04:00' },
  { id: 'hist_038', dealId: 'deal_14', fromStageId: 'stg_nouveau', toStageId: 'stg_contacte', actorType: 'user', actorName: 'Sophie Bergeron', createdAt: '2026-09-10T08:40:00-04:00' },
  { id: 'hist_039', dealId: 'deal_14', fromStageId: 'stg_contacte', toStageId: 'stg_soumission', actorType: 'automation', actorName: 'Soumission envoyée', createdAt: '2026-09-14T10:15:00-04:00' },
  { id: 'hist_040', dealId: 'deal_14', fromStageId: 'stg_soumission', toStageId: 'stg_gagne', actorType: 'user', actorName: 'Sophie Bergeron', createdAt: '2026-09-20T10:05:00-04:00' },
  // deal_15 — gagné après relance
  { id: 'hist_041', dealId: 'deal_15', fromStageId: null, toStageId: 'stg_nouveau', actorType: 'system', actorName: null, createdAt: '2026-08-14T09:15:00-04:00' },
  { id: 'hist_042', dealId: 'deal_15', fromStageId: 'stg_nouveau', toStageId: 'stg_contacte', actorType: 'user', actorName: 'Alexandre Roy', createdAt: '2026-08-14T09:52:00-04:00' },
  { id: 'hist_043', dealId: 'deal_15', fromStageId: 'stg_contacte', toStageId: 'stg_soumission', actorType: 'automation', actorName: 'Soumission envoyée', createdAt: '2026-08-19T14:05:00-04:00' },
  { id: 'hist_044', dealId: 'deal_15', fromStageId: 'stg_soumission', toStageId: 'stg_relance', actorType: 'automation', actorName: 'Sans réponse 3 jours', createdAt: '2026-08-24T09:00:00-04:00' },
  { id: 'hist_045', dealId: 'deal_15', fromStageId: 'stg_relance', toStageId: 'stg_gagne', actorType: 'user', actorName: 'Alexandre Roy', createdAt: '2026-09-01T14:00:00-04:00' },
  // deal_16 — gagné
  { id: 'hist_046', dealId: 'deal_16', fromStageId: null, toStageId: 'stg_nouveau', actorType: 'system', actorName: null, createdAt: '2026-08-21T13:40:00-04:00' },
  { id: 'hist_047', dealId: 'deal_16', fromStageId: 'stg_nouveau', toStageId: 'stg_contacte', actorType: 'user', actorName: 'Marie-Ève Tremblay', createdAt: '2026-08-21T14:10:00-04:00' },
  { id: 'hist_048', dealId: 'deal_16', fromStageId: 'stg_contacte', toStageId: 'stg_soumission', actorType: 'automation', actorName: 'Soumission envoyée', createdAt: '2026-08-26T10:30:00-04:00' },
  { id: 'hist_049', dealId: 'deal_16', fromStageId: 'stg_soumission', toStageId: 'stg_gagne', actorType: 'user', actorName: 'Marie-Ève Tremblay', createdAt: '2026-09-02T10:20:00-04:00' },
  // deal_17 — gagné après relance
  { id: 'hist_050', dealId: 'deal_17', fromStageId: null, toStageId: 'stg_nouveau', actorType: 'system', actorName: null, createdAt: '2026-08-07T15:55:00-04:00' },
  { id: 'hist_051', dealId: 'deal_17', fromStageId: 'stg_nouveau', toStageId: 'stg_contacte', actorType: 'user', actorName: 'Karim Haddad', createdAt: '2026-08-08T10:30:00-04:00' },
  { id: 'hist_052', dealId: 'deal_17', fromStageId: 'stg_contacte', toStageId: 'stg_soumission', actorType: 'automation', actorName: 'Soumission envoyée', createdAt: '2026-08-13T09:20:00-04:00' },
  { id: 'hist_053', dealId: 'deal_17', fromStageId: 'stg_soumission', toStageId: 'stg_relance', actorType: 'automation', actorName: 'Sans réponse 3 jours', createdAt: '2026-08-18T09:00:00-04:00' },
  { id: 'hist_054', dealId: 'deal_17', fromStageId: 'stg_relance', toStageId: 'stg_gagne', actorType: 'user', actorName: 'Karim Haddad', createdAt: '2026-08-25T11:40:00-04:00' },
  // deal_18 — gagné
  { id: 'hist_055', dealId: 'deal_18', fromStageId: null, toStageId: 'stg_nouveau', actorType: 'user', actorName: 'Sophie Bergeron', createdAt: '2026-07-31T10:05:00-04:00' },
  { id: 'hist_056', dealId: 'deal_18', fromStageId: 'stg_nouveau', toStageId: 'stg_contacte', actorType: 'user', actorName: 'Sophie Bergeron', createdAt: '2026-07-31T16:20:00-04:00' },
  { id: 'hist_057', dealId: 'deal_18', fromStageId: 'stg_contacte', toStageId: 'stg_soumission', actorType: 'automation', actorName: 'Soumission envoyée', createdAt: '2026-08-06T11:10:00-04:00' },
  { id: 'hist_058', dealId: 'deal_18', fromStageId: 'stg_soumission', toStageId: 'stg_gagne', actorType: 'user', actorName: 'Sophie Bergeron', createdAt: '2026-08-18T14:50:00-04:00' },
  // deal_19 — gagné après relance
  { id: 'hist_059', dealId: 'deal_19', fromStageId: null, toStageId: 'stg_nouveau', actorType: 'system', actorName: null, createdAt: '2026-07-24T08:20:00-04:00' },
  { id: 'hist_060', dealId: 'deal_19', fromStageId: 'stg_nouveau', toStageId: 'stg_contacte', actorType: 'user', actorName: 'Alexandre Roy', createdAt: '2026-07-24T08:55:00-04:00' },
  { id: 'hist_061', dealId: 'deal_19', fromStageId: 'stg_contacte', toStageId: 'stg_soumission', actorType: 'automation', actorName: 'Soumission envoyée', createdAt: '2026-07-30T15:40:00-04:00' },
  { id: 'hist_062', dealId: 'deal_19', fromStageId: 'stg_soumission', toStageId: 'stg_relance', actorType: 'automation', actorName: 'Sans réponse 7 jours', createdAt: '2026-08-06T09:00:00-04:00' },
  { id: 'hist_063', dealId: 'deal_19', fromStageId: 'stg_relance', toStageId: 'stg_gagne', actorType: 'user', actorName: 'Alexandre Roy', createdAt: '2026-08-12T16:30:00-04:00' },
  // deal_20 — gagné
  { id: 'hist_064', dealId: 'deal_20', fromStageId: null, toStageId: 'stg_nouveau', actorType: 'system', actorName: null, createdAt: '2026-07-17T14:15:00-04:00' },
  { id: 'hist_065', dealId: 'deal_20', fromStageId: 'stg_nouveau', toStageId: 'stg_contacte', actorType: 'user', actorName: 'Karim Haddad', createdAt: '2026-07-18T11:40:00-04:00' },
  { id: 'hist_066', dealId: 'deal_20', fromStageId: 'stg_contacte', toStageId: 'stg_soumission', actorType: 'automation', actorName: 'Soumission envoyée', createdAt: '2026-07-24T10:05:00-04:00' },
  { id: 'hist_067', dealId: 'deal_20', fromStageId: 'stg_soumission', toStageId: 'stg_gagne', actorType: 'user', actorName: 'Karim Haddad', createdAt: '2026-08-04T09:30:00-04:00' },
  // deal_21 — gagné après relance
  { id: 'hist_068', dealId: 'deal_21', fromStageId: null, toStageId: 'stg_nouveau', actorType: 'system', actorName: null, createdAt: '2026-07-08T09:45:00-04:00' },
  { id: 'hist_069', dealId: 'deal_21', fromStageId: 'stg_nouveau', toStageId: 'stg_contacte', actorType: 'user', actorName: 'Marie-Ève Tremblay', createdAt: '2026-07-08T10:20:00-04:00' },
  { id: 'hist_070', dealId: 'deal_21', fromStageId: 'stg_contacte', toStageId: 'stg_soumission', actorType: 'automation', actorName: 'Soumission envoyée', createdAt: '2026-07-15T14:30:00-04:00' },
  { id: 'hist_071', dealId: 'deal_21', fromStageId: 'stg_soumission', toStageId: 'stg_relance', actorType: 'automation', actorName: 'Sans réponse 7 jours', createdAt: '2026-07-22T09:00:00-04:00' },
  { id: 'hist_072', dealId: 'deal_21', fromStageId: 'stg_relance', toStageId: 'stg_gagne', actorType: 'user', actorName: 'Marie-Ève Tremblay', createdAt: '2026-07-29T13:10:00-04:00' },
  // deal_22 — perdu depuis Soumission
  { id: 'hist_073', dealId: 'deal_22', fromStageId: null, toStageId: 'stg_nouveau', actorType: 'system', actorName: null, createdAt: '2026-09-01T10:30:00-04:00' },
  { id: 'hist_074', dealId: 'deal_22', fromStageId: 'stg_nouveau', toStageId: 'stg_contacte', actorType: 'user', actorName: 'Sophie Bergeron', createdAt: '2026-09-01T11:05:00-04:00' },
  { id: 'hist_075', dealId: 'deal_22', fromStageId: 'stg_contacte', toStageId: 'stg_soumission', actorType: 'automation', actorName: 'Soumission envoyée', createdAt: '2026-09-05T13:25:00-04:00' },
  { id: 'hist_076', dealId: 'deal_22', fromStageId: 'stg_soumission', toStageId: 'stg_perdu', actorType: 'user', actorName: 'Sophie Bergeron', createdAt: '2026-09-14T16:20:00-04:00' },
  // deal_23 — perdu depuis Relance
  { id: 'hist_077', dealId: 'deal_23', fromStageId: null, toStageId: 'stg_nouveau', actorType: 'user', actorName: 'Karim Haddad', createdAt: '2026-08-19T13:05:00-04:00' },
  { id: 'hist_078', dealId: 'deal_23', fromStageId: 'stg_nouveau', toStageId: 'stg_contacte', actorType: 'user', actorName: 'Karim Haddad', createdAt: '2026-08-21T10:15:00-04:00' },
  { id: 'hist_079', dealId: 'deal_23', fromStageId: 'stg_contacte', toStageId: 'stg_soumission', actorType: 'automation', actorName: 'Soumission envoyée', createdAt: '2026-08-26T09:35:00-04:00' },
  { id: 'hist_080', dealId: 'deal_23', fromStageId: 'stg_soumission', toStageId: 'stg_relance', actorType: 'automation', actorName: 'Sans réponse 3 jours', createdAt: '2026-08-31T09:00:00-04:00' },
  { id: 'hist_081', dealId: 'deal_23', fromStageId: 'stg_relance', toStageId: 'stg_perdu', actorType: 'user', actorName: 'Karim Haddad', createdAt: '2026-09-06T09:50:00-04:00' },
  // deal_24 — perdu depuis Relance
  { id: 'hist_082', dealId: 'deal_24', fromStageId: null, toStageId: 'stg_nouveau', actorType: 'system', actorName: null, createdAt: '2026-08-03T11:25:00-04:00' },
  { id: 'hist_083', dealId: 'deal_24', fromStageId: 'stg_nouveau', toStageId: 'stg_contacte', actorType: 'user', actorName: 'Marie-Ève Tremblay', createdAt: '2026-08-03T12:10:00-04:00' },
  { id: 'hist_084', dealId: 'deal_24', fromStageId: 'stg_contacte', toStageId: 'stg_soumission', actorType: 'automation', actorName: 'Soumission envoyée', createdAt: '2026-08-10T16:00:00-04:00' },
  { id: 'hist_085', dealId: 'deal_24', fromStageId: 'stg_soumission', toStageId: 'stg_relance', actorType: 'automation', actorName: 'Sans réponse 7 jours', createdAt: '2026-08-17T09:00:00-04:00' },
  { id: 'hist_086', dealId: 'deal_24', fromStageId: 'stg_relance', toStageId: 'stg_perdu', actorType: 'user', actorName: 'Marie-Ève Tremblay', createdAt: '2026-08-27T14:40:00-04:00' },
  // deal_25 — perdu depuis Contacté (hors territoire)
  { id: 'hist_087', dealId: 'deal_25', fromStageId: null, toStageId: 'stg_nouveau', actorType: 'system', actorName: null, createdAt: '2026-07-14T15:40:00-04:00' },
  { id: 'hist_088', dealId: 'deal_25', fromStageId: 'stg_nouveau', toStageId: 'stg_contacte', actorType: 'user', actorName: 'Alexandre Roy', createdAt: '2026-07-15T09:30:00-04:00' },
  { id: 'hist_089', dealId: 'deal_25', fromStageId: 'stg_contacte', toStageId: 'stg_perdu', actorType: 'user', actorName: 'Alexandre Roy', createdAt: '2026-07-16T09:05:00-04:00' },
];

// ---------------------------------------------------------------------------
// Activités — fil du deal
// ---------------------------------------------------------------------------

export const MOCK_ACTIVITIES: MockActivity[] = [
  { id: 'act_01', dealId: 'deal_01', kind: 'stage', body: 'Lead reçu du formulaire du site.', authorName: null, createdAt: '2026-09-22T08:12:00-04:00' },
  { id: 'act_02', dealId: 'deal_02', kind: 'stage', body: 'Lead reçu de la campagne Meta « Commercial Q3 ».', authorName: null, createdAt: '2026-09-21T14:40:00-04:00' },
  { id: 'act_03', dealId: 'deal_02', kind: 'action', body: 'Courriel de bienvenue envoyé automatiquement.', authorName: 'Automatisation', createdAt: '2026-09-21T14:42:00-04:00' },
  { id: 'act_04', dealId: 'deal_03', kind: 'call', body: 'Appel sortant, 6 min. Condo de 3 chambres, ménage aux deux semaines.', authorName: 'Karim Haddad', createdAt: '2026-09-19T11:48:00-04:00' },
  { id: 'act_05', dealId: 'deal_04', kind: 'call', body: 'Deux tentatives, boîte vocale. Message laissé.', authorName: 'Sophie Bergeron', createdAt: '2026-09-15T14:30:00-04:00' },
  { id: 'act_06', dealId: 'deal_04', kind: 'sms', body: 'SMS de rappel : « Bonjour Julie, on peut passer estimer jeudi ou vendredi ? »', authorName: 'Sophie Bergeron', createdAt: '2026-09-16T10:05:00-04:00' },
  { id: 'act_07', dealId: 'deal_04', kind: 'note', body: 'Veut un ménage profond avant un déménagement le 1er octobre. Urgent.', authorName: 'Sophie Bergeron', createdAt: '2026-09-18T15:30:00-04:00' },
  { id: 'act_08', dealId: 'deal_05', kind: 'call', body: 'Parlé à la réceptionniste. Entretien 3 soirs/semaine, 2 200 pi². Visite à planifier.', authorName: 'Alexandre Roy', createdAt: '2026-09-11T16:02:00-04:00' },
  { id: 'act_09', dealId: 'deal_05', kind: 'note', body: 'Exige un certificat d’assurance responsabilité avant le premier soir.', authorName: 'Alexandre Roy', createdAt: '2026-09-12T09:10:00-04:00' },
  { id: 'act_10', dealId: 'deal_06', kind: 'email', body: 'Soumission #S-1187 envoyée : 245 $/visite, aux deux semaines.', authorName: 'Marie-Ève Tremblay', createdAt: '2026-09-10T14:20:00-04:00' },
  { id: 'act_11', dealId: 'deal_07', kind: 'email', body: 'Soumission #S-1191 envoyée : contrat annuel, 4 étages, 1 480 $/mois.', authorName: 'Alexandre Roy', createdAt: '2026-09-05T11:15:00-04:00' },
  { id: 'act_12', dealId: 'deal_07', kind: 'note', body: 'Le gestionnaire compare trois fournisseurs. Décision au conseil du 28.', authorName: 'Alexandre Roy', createdAt: '2026-09-05T11:40:00-04:00' },
  { id: 'act_13', dealId: 'deal_08', kind: 'email', body: 'Soumission #S-1183 envoyée : grand ménage d’automne, 320 $.', authorName: 'Marie-Ève Tremblay', createdAt: '2026-09-01T09:40:00-04:00' },
  { id: 'act_14', dealId: 'deal_09', kind: 'sms', body: 'Relance 1 : « Bonjour, avez-vous eu la chance de regarder notre soumission ? »', authorName: 'Sophie Bergeron', createdAt: '2026-09-07T09:30:00-04:00' },
  { id: 'act_15', dealId: 'deal_09', kind: 'call', body: 'Le gérant rappelle : intéressé, veut un essai d’un mois avant de signer.', authorName: 'Sophie Bergeron', createdAt: '2026-09-12T14:25:00-04:00' },
  { id: 'act_16', dealId: 'deal_10', kind: 'stage', body: 'Déplacé en Relance par Lumi : aucune réponse depuis 6 jours.', authorName: 'Lumi', createdAt: '2026-08-31T11:45:00-04:00' },
  { id: 'act_17', dealId: 'deal_10', kind: 'email', body: 'Relance 2 envoyée avec un rabais de 10 % sur la première visite.', authorName: 'Karim Haddad', createdAt: '2026-09-04T16:05:00-04:00' },
  { id: 'act_18', dealId: 'deal_11', kind: 'note', body: 'La direction attend le budget de septembre. Rappeler le 2 octobre.', authorName: 'Marie-Ève Tremblay', createdAt: '2026-08-30T10:40:00-04:00' },
  { id: 'act_19', dealId: 'deal_12', kind: 'sms', body: 'Relance 1 sans réponse.', authorName: 'Sophie Bergeron', createdAt: '2026-08-22T11:20:00-04:00' },
  { id: 'act_20', dealId: 'deal_13', kind: 'call', body: 'Rappel en 35 min. Bureau de 12 postes, entretien hebdomadaire.', authorName: 'Alexandre Roy', createdAt: '2026-09-04T09:25:00-04:00' },
  { id: 'act_21', dealId: 'deal_13', kind: 'stage', body: 'Soumission acceptée par courriel. Gagné — la job reste à créer.', authorName: 'Alexandre Roy', createdAt: '2026-09-17T15:10:00-04:00' },
  { id: 'act_22', dealId: 'deal_14', kind: 'stage', body: 'Accepté au téléphone. Gagné — la job reste à créer.', authorName: 'Sophie Bergeron', createdAt: '2026-09-20T10:05:00-04:00' },
  { id: 'act_23', dealId: 'deal_15', kind: 'call', body: 'Visite sur place avec la directrice. 42 unités, corridors et cafétéria.', authorName: 'Alexandre Roy', createdAt: '2026-08-18T13:20:00-04:00' },
  { id: 'act_24', dealId: 'deal_15', kind: 'action', body: 'Job #2041 créée depuis le deal gagné.', authorName: 'Automatisation', createdAt: '2026-09-01T14:05:00-04:00' },
  { id: 'act_25', dealId: 'deal_15', kind: 'note', body: 'Facture réglée en entier par virement.', authorName: 'Marie-Ève Tremblay', createdAt: '2026-09-15T11:30:00-04:00' },
  { id: 'act_26', dealId: 'deal_16', kind: 'action', body: 'Job #2042 créée. Première visite le 5 septembre.', authorName: 'Automatisation', createdAt: '2026-09-02T10:25:00-04:00' },
  { id: 'act_27', dealId: 'deal_17', kind: 'email', body: 'Relance 2 : offre d’un essai d’un mois. Acceptée le lendemain.', authorName: 'Karim Haddad', createdAt: '2026-08-24T10:10:00-04:00' },
  { id: 'act_28', dealId: 'deal_17', kind: 'note', body: 'Moitié de la facture réglée, solde dû au 30e jour.', authorName: 'Karim Haddad', createdAt: '2026-09-05T13:15:00-04:00' },
  { id: 'act_29', dealId: 'deal_18', kind: 'call', body: 'Ménage résidentiel mensuel confirmé, 310 $ par visite.', authorName: 'Sophie Bergeron', createdAt: '2026-08-18T14:50:00-04:00' },
  { id: 'act_30', dealId: 'deal_19', kind: 'note', body: 'Entrepôt de 18 000 pi². Contrat trimestriel signé par le directeur des opérations.', authorName: 'Alexandre Roy', createdAt: '2026-08-12T16:35:00-04:00' },
  { id: 'act_31', dealId: 'deal_19', kind: 'action', body: 'Job #2045 créée, équipe de 4 assignée.', authorName: 'Automatisation', createdAt: '2026-08-12T16:40:00-04:00' },
  { id: 'act_32', dealId: 'deal_20', kind: 'sms', body: 'Confirmation du rendez-vous de nettoyage post-rénovation.', authorName: 'Karim Haddad', createdAt: '2026-08-04T09:35:00-04:00' },
  { id: 'act_33', dealId: 'deal_21', kind: 'note', body: 'Décision du conseil d’administration : contrat de 12 mois, 2 200 $/mois.', authorName: 'Marie-Ève Tremblay', createdAt: '2026-07-29T13:15:00-04:00' },
  { id: 'act_34', dealId: 'deal_21', kind: 'action', body: 'Job #2047 créée, facturation mensuelle activée.', authorName: 'Automatisation', createdAt: '2026-07-29T13:20:00-04:00' },
  { id: 'act_35', dealId: 'deal_22', kind: 'note', body: 'Trouve la soumission 25 % plus chère qu’une offre reçue sur Kijiji.', authorName: 'Sophie Bergeron', createdAt: '2026-09-14T16:20:00-04:00' },
  { id: 'act_36', dealId: 'deal_23', kind: 'call', body: 'A signé avec un concurrent qui inclut le lavage de vitres.', authorName: 'Karim Haddad', createdAt: '2026-09-06T09:50:00-04:00' },
  { id: 'act_37', dealId: 'deal_24', kind: 'sms', body: 'Trois relances sans réponse. Dossier fermé.', authorName: 'Marie-Ève Tremblay', createdAt: '2026-08-27T14:40:00-04:00' },
  { id: 'act_38', dealId: 'deal_25', kind: 'note', body: 'Saint-Hyacinthe est hors du territoire desservi. Référé à un partenaire.', authorName: 'Alexandre Roy', createdAt: '2026-07-16T09:05:00-04:00' },
];

// ---------------------------------------------------------------------------
// Actions d'étape (automatisations)
// ---------------------------------------------------------------------------

export const MOCK_STAGE_ACTIONS: MockStageAction[] = [
  {
    id: 'sa_01',
    stageId: 'stg_nouveau',
    trigger: 'stage_entered',
    idleDays: null,
    actionType: 'send_email',
    labelFr: 'Envoyer le courriel de bienvenue',
    labelEn: 'Send the welcome email',
    position: 1,
    enabled: true,
  },
  {
    id: 'sa_02',
    stageId: 'stg_nouveau',
    trigger: 'stage_entered',
    idleDays: null,
    actionType: 'create_notification',
    labelFr: 'Notifier le vendeur assigné',
    labelEn: 'Notify the assigned rep',
    position: 2,
    enabled: true,
  },
  {
    id: 'sa_03',
    stageId: 'stg_nouveau',
    trigger: 'stage_idle',
    idleDays: 3,
    actionType: 'create_task',
    labelFr: 'Créer une tâche « Rappeler ce lead »',
    labelEn: 'Create a “Call this lead” task',
    position: 3,
    enabled: true,
  },
  {
    id: 'sa_04',
    stageId: 'stg_contacte',
    trigger: 'stage_entered',
    idleDays: null,
    actionType: 'create_task',
    labelFr: 'Créer une tâche « Préparer la soumission »',
    labelEn: 'Create a “Prepare the quote” task',
    position: 1,
    enabled: true,
  },
  {
    id: 'sa_05',
    stageId: 'stg_soumission',
    trigger: 'stage_idle',
    idleDays: 3,
    actionType: 'send_sms',
    labelFr: 'Envoyer le SMS de relance 1',
    labelEn: 'Send follow-up SMS #1',
    position: 1,
    enabled: true,
  },
  {
    id: 'sa_06',
    stageId: 'stg_soumission',
    trigger: 'stage_exited',
    idleDays: null,
    actionType: 'create_notification',
    labelFr: 'Prévenir le responsable des ventes',
    labelEn: 'Alert the sales lead',
    position: 2,
    enabled: false,
  },
  {
    id: 'sa_07',
    stageId: 'stg_relance',
    trigger: 'stage_idle',
    idleDays: 7,
    actionType: 'send_email',
    labelFr: 'Envoyer le courriel de dernière chance',
    labelEn: 'Send the last-chance email',
    position: 1,
    enabled: true,
  },
  {
    id: 'sa_08',
    stageId: 'stg_gagne',
    trigger: 'stage_entered',
    idleDays: null,
    actionType: 'create_task',
    labelFr: 'Créer la job et confirmer l’accès',
    labelEn: 'Create the job and confirm access',
    position: 1,
    enabled: true,
  },
  {
    id: 'sa_09',
    stageId: 'stg_perdu',
    trigger: 'stage_entered',
    idleDays: null,
    actionType: 'create_task',
    labelFr: 'Planifier un rappel dans 6 mois',
    labelEn: 'Schedule a 6-month reminder',
    position: 1,
    enabled: false,
  },
];

// ---------------------------------------------------------------------------
// Helpers purs — utilisés par l'écran de stats
// ---------------------------------------------------------------------------

/** Index étape → kind, pour éviter un find() dans chaque boucle. */
function kindParEtape(stages: MockStage[]): Map<string, StageKind> {
  const m = new Map<string, StageKind>();
  for (const s of stages) m.set(s.id, s.kind);
  return m;
}

function millis(iso: string): number {
  return new Date(iso).getTime();
}

const MS_PAR_JOUR = 86_400_000;
const MS_PAR_HEURE = 3_600_000;

/** Regroupe les deals par identifiant d'étape. Toute étape connue a une entrée. */
export function dealsByStage(deals: MockDeal[]): Record<string, MockDeal[]> {
  const out: Record<string, MockDeal[]> = {};
  for (const deal of deals) {
    const bucket = out[deal.stageId];
    if (bucket) bucket.push(deal);
    else out[deal.stageId] = [deal];
  }
  return out;
}

/** Badge DÉRIVÉ : étape gagnée + aucune job créée. Jamais stocké sur le deal. */
export function isJobACreer(deal: MockDeal, stages: MockStage[]): boolean {
  return kindParEtape(stages).get(deal.stageId) === 'won' && deal.jobId === null;
}

/** Taux de closing = gagnés / (gagnés + perdus). 0 si aucun deal fermé. */
export function tauxClosing(deals: MockDeal[], stages: MockStage[]): number {
  const kinds = kindParEtape(stages);
  let gagnes = 0;
  let perdus = 0;
  for (const deal of deals) {
    const k = kinds.get(deal.stageId);
    if (k === 'won') gagnes += 1;
    else if (k === 'lost') perdus += 1;
  }
  const total = gagnes + perdus;
  return total === 0 ? 0 : gagnes / total;
}

/** Somme en cents des montants de job, pour les deals qui ont une job. */
export function revenusGeneres(deals: MockDeal[]): number {
  let total = 0;
  for (const deal of deals) {
    if (deal.jobId !== null) total += deal.jobAmountCents ?? 0;
  }
  return total;
}

/** Délai entre la création et le premier contact, en heures. null si jamais contacté. */
export function delaiPremierContactHeures(deal: MockDeal): number | null {
  if (deal.firstContactedAt === null) return null;
  return (millis(deal.firstContactedAt) - millis(deal.createdAt)) / MS_PAR_HEURE;
}

export interface RepartitionSource {
  source: DealSource;
  /** Campagne UTM pour les leads Meta, null sinon. */
  campagne: string | null;
  leads: number;
  gagnes: number;
  perdus: number;
  tauxClosing: number;
  revenusCents: number;
  revenuMoyenParLeadCents: number;
}

/** Répartition par source (et par campagne pour Meta). */
export function repartitionParSource(deals: MockDeal[], stages: MockStage[]): RepartitionSource[] {
  const kinds = kindParEtape(stages);
  const groupes = new Map<string, RepartitionSource>();

  for (const deal of deals) {
    const campagne = deal.source === 'meta' ? deal.utmCampaign : null;
    const cle = `${deal.source}|${campagne ?? ''}`;
    let g = groupes.get(cle);
    if (!g) {
      g = {
        source: deal.source,
        campagne,
        leads: 0,
        gagnes: 0,
        perdus: 0,
        tauxClosing: 0,
        revenusCents: 0,
        revenuMoyenParLeadCents: 0,
      };
      groupes.set(cle, g);
    }
    g.leads += 1;
    const k = kinds.get(deal.stageId);
    if (k === 'won') g.gagnes += 1;
    else if (k === 'lost') g.perdus += 1;
    if (deal.jobId !== null) g.revenusCents += deal.jobAmountCents ?? 0;
  }

  const out = Array.from(groupes.values());
  for (const g of out) {
    const fermes = g.gagnes + g.perdus;
    g.tauxClosing = fermes === 0 ? 0 : g.gagnes / fermes;
    g.revenuMoyenParLeadCents = g.leads === 0 ? 0 : Math.round(g.revenusCents / g.leads);
  }
  // Tri stable : source puis campagne, pour un rendu déterministe.
  out.sort((a, b) => (a.source === b.source
    ? (a.campagne ?? '').localeCompare(b.campagne ?? '')
    : a.source.localeCompare(b.source)));
  return out;
}

export interface EtapeEntonnoir {
  stageId: string;
  nameFr: string;
  nameEn: string;
  /** Nombre de deals ayant TRAVERSÉ l'étape, même s'ils l'ont quittée. */
  atteints: number;
  /** Part des deals de l'étape précédente qui ont atteint celle-ci. */
  tauxPassage: number;
}

/**
 * Entonnoir calculé sur l'HISTORIQUE : un deal passé par une étape y compte,
 * même s'il est reparti. Les étapes closes (gagné/perdu) sont incluses.
 */
export function entonnoir(
  deals: MockDeal[],
  stages: MockStage[],
  history: MockStageHistory[],
): EtapeEntonnoir[] {
  const idsDeals = new Set(deals.map((d) => d.id));
  const parEtape = new Map<string, Set<string>>();
  for (const s of stages) parEtape.set(s.id, new Set<string>());

  for (const h of history) {
    if (!idsDeals.has(h.dealId)) continue;
    parEtape.get(h.toStageId)?.add(h.dealId);
  }

  const ordonnees = [...stages].sort((a, b) => a.position - b.position);
  const out: EtapeEntonnoir[] = [];
  let precedent: number | null = null;

  for (const s of ordonnees) {
    const atteints = parEtape.get(s.id)?.size ?? 0;
    const tauxPassage = precedent === null || precedent === 0 ? 1 : atteints / precedent;
    out.push({ stageId: s.id, nameFr: s.nameFr, nameEn: s.nameEn, atteints, tauxPassage });
    // Les étapes closes ne forment pas la suite de l'entonnoir : on garde le
    // dernier volume ouvert comme référence de passage.
    if (s.kind === 'open') precedent = atteints;
  }
  return out;
}

/** Durée moyenne, en jours, entre création et fermeture (gagné ou perdu). */
export function dureeMoyenneCycleJours(deals: MockDeal[], stages: MockStage[]): number | null {
  const kinds = kindParEtape(stages);
  let somme = 0;
  let n = 0;
  for (const deal of deals) {
    const k = kinds.get(deal.stageId);
    const fin = k === 'won' ? deal.wonAt : k === 'lost' ? deal.lostAt : null;
    if (fin === null) continue;
    somme += (millis(fin) - millis(deal.createdAt)) / MS_PAR_JOUR;
    n += 1;
  }
  return n === 0 ? null : somme / n;
}

export interface TempsEtape {
  stageId: string;
  jours: number;
}

/**
 * Temps moyen passé dans chaque étape, d'après les transitions successives
 * d'un même deal. Une étape jamais quittée n'est pas comptée (pas de fin).
 */
export function tempsMoyenParEtapeJours(
  history: MockStageHistory[],
  stages: MockStage[],
): TempsEtape[] {
  const parDeal = new Map<string, MockStageHistory[]>();
  for (const h of history) {
    const liste = parDeal.get(h.dealId);
    if (liste) liste.push(h);
    else parDeal.set(h.dealId, [h]);
  }

  const cumul = new Map<string, { somme: number; n: number }>();
  for (const liste of parDeal.values()) {
    const triee = [...liste].sort((a, b) => millis(a.createdAt) - millis(b.createdAt));
    for (let i = 0; i < triee.length - 1; i += 1) {
      const debut = triee[i];
      const suite = triee[i + 1];
      if (!debut || !suite) continue;
      const jours = (millis(suite.createdAt) - millis(debut.createdAt)) / MS_PAR_JOUR;
      const acc = cumul.get(debut.toStageId) ?? { somme: 0, n: 0 };
      acc.somme += jours;
      acc.n += 1;
      cumul.set(debut.toStageId, acc);
    }
  }

  return [...stages]
    .sort((a, b) => a.position - b.position)
    .map((s) => {
      const acc = cumul.get(s.id);
      return { stageId: s.id, jours: acc && acc.n > 0 ? acc.somme / acc.n : 0 };
    });
}

export interface RaisonPerte {
  raison: string;
  nombre: number;
  /** Étape d'où le deal a été perdu, null si non renseignée. */
  stageIdPerdu: string | null;
}

/** Raisons de perte, de la plus fréquente à la moins fréquente. */
export function raisonsDePerte(deals: MockDeal[], stages: MockStage[]): RaisonPerte[] {
  const kinds = kindParEtape(stages);
  const compte = new Map<string, RaisonPerte>();
  for (const deal of deals) {
    if (kinds.get(deal.stageId) !== 'lost') continue;
    const raison = deal.lostReason ?? 'Non précisée';
    const cle = `${raison}|${deal.lostFromStageId ?? ''}`;
    const courant = compte.get(cle);
    if (courant) courant.nombre += 1;
    else compte.set(cle, { raison, nombre: 1, stageIdPerdu: deal.lostFromStageId });
  }
  return Array.from(compte.values())
    .sort((a, b) => (b.nombre - a.nombre) || a.raison.localeCompare(b.raison));
}

export interface StatsVendeur {
  memberId: string | null;
  nom: string;
  pris: number;
  gagnes: number;
  tauxClosing: number;
  delaiContactMoyenHeures: number | null;
}

/** Performance par vendeur. Les deals non assignés forment une ligne à part. */
export function parVendeur(deals: MockDeal[], stages: MockStage[]): StatsVendeur[] {
  const kinds = kindParEtape(stages);
  const acc = new Map<string, { s: StatsVendeur; perdus: number; sommeDelai: number; nDelai: number }>();

  for (const deal of deals) {
    const cle = deal.assignedUserId ?? '';
    let a = acc.get(cle);
    if (!a) {
      a = {
        s: {
          memberId: deal.assignedUserId,
          nom: deal.assignedName ?? 'Non assigné',
          pris: 0,
          gagnes: 0,
          tauxClosing: 0,
          delaiContactMoyenHeures: null,
        },
        perdus: 0,
        sommeDelai: 0,
        nDelai: 0,
      };
      acc.set(cle, a);
    }
    a.s.pris += 1;
    const k = kinds.get(deal.stageId);
    if (k === 'won') a.s.gagnes += 1;
    else if (k === 'lost') a.perdus += 1;
    const delai = delaiPremierContactHeures(deal);
    if (delai !== null) {
      a.sommeDelai += delai;
      a.nDelai += 1;
    }
  }

  const out = Array.from(acc.values()).map(({ s, perdus, sommeDelai, nDelai }) => {
    const fermes = s.gagnes + perdus;
    s.tauxClosing = fermes === 0 ? 0 : s.gagnes / fermes;
    s.delaiContactMoyenHeures = nDelai === 0 ? null : sommeDelai / nDelai;
    return s;
  });
  out.sort((a, b) => (b.gagnes - a.gagnes) || a.nom.localeCompare(b.nom));
  return out;
}

export interface ATraiter {
  nonAssignes: MockDeal[];
  sansActiviteDepuis7Jours: MockDeal[];
  jobACreer: MockDeal[];
}

/** Les trois listes d'action de l'écran, calculées à partir de MOCK_NOW. */
export function aTraiter(deals: MockDeal[], stages: MockStage[]): ATraiter {
  const kinds = kindParEtape(stages);
  const maintenant = millis(MOCK_NOW);
  const seuil = maintenant - 7 * MS_PAR_JOUR;

  const nonAssignes: MockDeal[] = [];
  const sansActiviteDepuis7Jours: MockDeal[] = [];
  const jobACreer: MockDeal[] = [];

  for (const deal of deals) {
    const k = kinds.get(deal.stageId);
    const ouvert = k === 'open';
    if (ouvert && deal.assignedUserId === null) nonAssignes.push(deal);
    if (ouvert && millis(deal.lastActivityAt) < seuil) sansActiviteDepuis7Jours.push(deal);
    if (k === 'won' && deal.jobId === null) jobACreer.push(deal);
  }
  return { nonAssignes, sansActiviteDepuis7Jours, jobACreer };
}

export interface SemaineTendance {
  /** Lundi de la semaine, au format AAAA-MM-JJ. */
  semaine: string;
  leads: number;
  gagnes: number;
}

/** Début de semaine (lundi) en UTC, pour un regroupement déterministe. */
function lundiDe(ms: number): number {
  const d = new Date(ms);
  const jour = (d.getUTCDay() + 6) % 7; // lundi = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - jour * MS_PAR_JOUR;
}

function jourIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 12 entrées hebdomadaires jusqu'à la semaine de MOCK_NOW, les plus anciennes d'abord. */
export function tendanceHebdo(deals: MockDeal[], stages: MockStage[]): SemaineTendance[] {
  const kinds = kindParEtape(stages);
  const semaineCourante = lundiDe(millis(MOCK_NOW));
  const out: SemaineTendance[] = [];
  const index = new Map<number, SemaineTendance>();

  for (let i = 11; i >= 0; i -= 1) {
    const debut = semaineCourante - i * 7 * MS_PAR_JOUR;
    const entree: SemaineTendance = { semaine: jourIso(debut), leads: 0, gagnes: 0 };
    index.set(debut, entree);
    out.push(entree);
  }

  for (const deal of deals) {
    const sLead = index.get(lundiDe(millis(deal.createdAt)));
    if (sLead) sLead.leads += 1;
    if (kinds.get(deal.stageId) === 'won' && deal.wonAt !== null) {
      const sGagne = index.get(lundiDe(millis(deal.wonAt)));
      if (sGagne) sGagne.gagnes += 1;
    }
  }
  return out;
}

export interface CohorteMois {
  /** Mois d'entrée du lead, au format AAAA-MM. */
  mois: string;
  inscrits: number;
  gagnes: number;
  /** Gagnés / TOUS les leads du mois — ouverts inclus, contrairement à tauxClosing. */
  tauxGagne: number;
}

/**
 * Cohortes mensuelles des leads venus du formulaire web. Le taux rapporte les
 * gagnés à TOUS les inscrits du mois (les ouverts comptent au dénominateur).
 */
export function cohorteFormulaire(deals: MockDeal[], stages: MockStage[]): CohorteMois[] {
  const kinds = kindParEtape(stages);
  const parMois = new Map<string, CohorteMois>();

  for (const deal of deals) {
    if (deal.source !== 'form_web') continue;
    const mois = deal.createdAt.slice(0, 7);
    let c = parMois.get(mois);
    if (!c) {
      c = { mois, inscrits: 0, gagnes: 0, tauxGagne: 0 };
      parMois.set(mois, c);
    }
    c.inscrits += 1;
    if (kinds.get(deal.stageId) === 'won') c.gagnes += 1;
  }

  const out = Array.from(parMois.values()).sort((a, b) => a.mois.localeCompare(b.mois));
  for (const c of out) c.tauxGagne = c.inscrits === 0 ? 0 : c.gagnes / c.inscrits;
  return out;
}
