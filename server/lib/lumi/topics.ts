/**
 * Topics de Lumi (item 11, AGENTFORCE_GAP.md B1) — scopes bornés.
 * ───────────────────────────────────────────────────────────
 * Un topic = une description de classification (pour le routeur), les outils
 * qu'il autorise, et ce qu'il refuse. Aujourd'hui les topics servent au
 * routeur en mode observation (item 10) : ils ne restreignent PAS encore les
 * outils chargés par le modèle — ça viendra quand la trace aura montré que
 * le routeur classe juste (AGENTFORCE_GAP.md, ordre d'implémentation 10 → 11).
 *
 * Le test tests/lumi-routeur.test.ts vérifie que chaque outil de TOOLS_BY_NAME
 * appartient à exactement un topic (sauf la mémoire et les rapports,
 * transverses) et que chaque outil cité existe.
 */
import { TOPICS_DOMAINES } from '../agent/outils-domaines';

export type IdTopic = 'planification' | 'devis' | 'facturation' | 'clients' | 'communications' | 'equipe' | 'terrain' | 'rapports' | 'memoire' | 'hors_scope' | 'multi';

export interface Topic {
  id: IdTopic;
  /** Pour le routeur : ce que couvre le topic, en une phrase. */
  description: string;
  /** Outils (lecture + écriture) que ce topic autorise. */
  outils: string[];
  /**
   * Noyau du topic : les outils du quotidien, CHARGÉS d'office par le
   * sous-agent (bloc d'outils court, en cache). Les autres outils du topic
   * (couverture 100 %) restent différés, découverts par tool_search.
   * Rempli à l'initialisation = la liste d'origine, avant l'ajout des domaines.
   */
  noyau?: string[];
  /** Ce que le topic refuse, redirigé ailleurs. */
  refuse: string;
}

export const TOPICS: readonly Topic[] = [
  {
    id: 'planification',
    description: 'Jobs, visites, calendrier, horaire, trajets, disponibilités, assignation, statuts de job, dépenses de job, météo (travail extérieur).',
    outils: ['query_schedule', 'list_jobs', 'get_job', 'get_day_route', 'find_free_slot', 'find_dates_in_location', 'optimize_route', 'get_team_locations', 'get_weather',
      'create_job', 'update_job', 'update_job_status', 'assign_job', 'archive_job', 'add_visit', 'reschedule_job', 'cancel_visit', 'set_job_expenses'],
    refuse: 'Argent (devis, factures, paiements) → facturation ; textos et courriels → communications.',
  },
  {
    // Mesuré le 2026-09-17 : « facturation » à 70 outils pesait 17 000 tokens relus à chaque étape ;
    // devis et factures sont deux moments différents de la vente → deux sujets, deux blocs deux fois plus légers.
    id: 'devis',
    description: 'Devis (soumissions, estimés) : en faire un, l’envoyer, le modifier, le dupliquer, l’annuler, le convertir en job ou en facture ; préréglages et modèles de devis ; devis en attente.',
    outils: ['list_quotes', 'list_services', 'create_quote', 'send_quote', 'cancel_quote', 'convert_quote_to_job'],
    refuse: 'Factures, paiements, retards, revenus → facturation ; planifier une visite → planification ; fiche d’un client → clients.',
  },
  {
    id: 'facturation',
    description: 'Factures, paiements, retards, relances, factures récurrentes, modèles de facture, taxes, catalogue de services, revenus, rentabilité, comparaisons de périodes.',
    outils: ['list_invoices', 'get_overdue_payments', 'get_revenue_summary', 'get_financial_overview', 'compare_revenue', 'get_job_profitability', 'get_top_services',
      'create_invoice', 'create_invoice_from_job', 'send_invoice', 'mark_invoice_paid', 'send_payment_reminders'],
    refuse: 'Un devis (soumission) → devis ; planifier une visite → planification ; fiche d’un client → clients.',
  },
  {
    id: 'clients',
    description: 'Clients, prospects (leads), fiches, coordonnées, historique d’un client, doublons, notes, demandes web entrantes, meilleurs clients, risque de perte.',
    outils: ['search_clients', 'search_leads', 'get_client_profile', 'get_top_clients', 'get_churn_risk', 'list_request_submissions',
      'create_client', 'update_client', 'convert_lead_to_client', 'merge_clients', 'add_note'],
    refuse: 'Envoyer un message → communications ; créer un devis → facturation.',
  },
  {
    id: 'communications',
    description: 'Textos (SMS) et courriels : lire les conversations, envoyer un message à un client.',
    outils: ['get_conversations', 'get_conversation_messages', 'send_sms', 'send_email'],
    refuse: 'Relancer des factures → facturation (relances) ; envoyer un devis ou une facture → facturation.',
  },
  {
    id: 'equipe',
    description: 'Membres de l’équipe, invitations, rôles et permissions, équipes nommées, feuilles de temps, pointage, paie, tâches internes (à faire).',
    outils: ['get_team', 'get_timesheets', 'get_payroll_summary', 'list_tasks',
      'create_task', 'update_task', 'update_task_status', 'delete_task'],
    refuse: 'Porte-à-porte, territoires, formations → terrain ; où est l’équipe en ce moment (positions) → planification ; assigner une job → planification.',
  },
  {
    id: 'terrain',
    description: 'Porte-à-porte et vente terrain : maisons cognées, territoires, représentants, sessions terrain, pipeline terrain, badges, défis, batailles, formations (cours, modules, leçons).',
    outils: ['get_d2d_stats', 'list_courses'],
    refuse: 'Membres, rôles, paie, pointage → equipe ; prospects et pipeline de ventes classique → clients.',
  },
  {
    id: 'rapports',
    description: 'Rapports et documents (PDF financier, retards, jobs, client), survol du jour, automatisations, réglages de l’entreprise.',
    outils: ['build_report', 'get_morning_briefing', 'list_automations', 'get_automation_health', 'get_company_info'],
    refuse: 'Un chiffre précis sans document → le topic du chiffre (facturation, planification).',
  },
  {
    id: 'memoire',
    description: 'Ce que Lumi doit retenir ou oublier ; ce qu’il a fait récemment.',
    outils: ['recall_notes', 'remember_this', 'forget_note', 'get_recent_agent_actions'],
    refuse: 'Tout le reste.',
  },
  {
    id: 'hors_scope',
    description: 'Rien à voir avec l’entreprise ni avec Lume : actualités, code, blagues, sujets personnels, demandes d’accès à d’autres entreprises ou à la mécanique interne.',
    outils: [],
    refuse: 'Répondre en une phrase que Lumi s’occupe de Lume, sans improviser.',
  },
  {
    id: 'multi',
    description: 'Plusieurs sujets ou plusieurs actions dans la même phrase (créer une job ET texter le client ; horaire d’hier ET factures en retard).',
    outils: [],
    refuse: 'Rien : l’agent complet répond, sans restriction d’outils.',
  },
];

// Les outils des domaines (couverture 100 %) rejoignent leur topic ; un outil dans deux topics ou sans topic fait échouer les tests.
for (const t of TOPICS) {
  t.noyau = [...t.outils];
  for (const o of TOPICS_DOMAINES[t.id] ?? []) if (!t.outils.includes(o)) t.outils.push(o);
}

export const TOPICS_PAR_ID: ReadonlyMap<IdTopic, Topic> = new Map(TOPICS.map((t) => [t.id, t]));

/** Le topic qui possède cet outil (le premier), ou null (outil transverse ou inconnu). */
export function topicDeLOutil(outil: string): IdTopic | null {
  for (const t of TOPICS) if (t.outils.includes(outil)) return t.id;
  return null;
}
