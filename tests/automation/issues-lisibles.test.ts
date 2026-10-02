/**
 * Chaque issue d'une exécution a une raison LISIBLE, dans la langue de l'écran.
 *
 * Mission du 2026-10-01, point 5 : « chaque échec ou exécution ignorée a une raison
 * compréhensible ». Constats D-12 (dans l'interface anglaise, les raisons sortaient en
 * français : le moteur écrit ses phrases en français), D-22 (« Étape supprimée du parcours »
 * était traduit « l'automatisation a été supprimée ») et D-23 (une notification interne comptée
 * comme un « envoi »).
 *
 * Unitaire pur : aucune base, aucun réseau.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACTIONS_MESSAGE_CLIENT, CATEGORIES_PAR_CODE, FILTRES_STATUT, codeDeLaPhrase, groupeDeLIssue, libelleAction,
  libelleFait, libelleIssue, motifSaut, periodeValide, raisonLisible, resultatLisible,
} from '../../src/lib/automationIssues';
import { MOTIFS, motifDuCode } from '../../src/lib/automationMotifs';
import { ACTIONS } from '../../src/lib/automationCatalogue';

const lire = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');
/** Un texte a-t-il l'air français ? (accents, ou mots-outils) */
const francais = (t: string) => /[éèêàçùœ]|\b(le|la|les|une?|des|pas|est|été|envoi|aucune?)\b/i.test(t);

describe('les phrases de l’Historique', () => {
  it('« Envoyé », « Ignoré : … », « Reporté… », « Échec : … » — en français', () => {
    expect(resultatLisible({ issue: 'fait', categorie: 'envoyee', action_type: 'send_sms' }, true)).toBe('Texto envoyé');
    expect(resultatLisible({ issue: 'fait', categorie: 'envoyee', action_type: 'send_email' }, true)).toBe('Courriel envoyé');
    expect(resultatLisible({ issue: 'fait', categorie: 'action', action_type: 'create_task' }, true)).toBe('Tâche créée');
    expect(resultatLisible({ issue: 'desabonne', categorie: 'ignoree', action_type: 'send_sms' }, true)).toBe('Ignoré : client désabonné');
    expect(resultatLisible({ issue: 'sans_telephone', categorie: 'ignoree', action_type: 'send_sms', detail: 'Aucun numéro de téléphone pour ce client' }, true))
      .toBe('Ignoré : aucun numéro de téléphone pour ce client');
    expect(resultatLisible({ issue: 'hors_heures', categorie: 'reportee', action_type: 'send_sms' }, true)).toBe('Reporté au prochain créneau d’envoi');
    expect(resultatLisible({ issue: 'echec', categorie: 'echouee', action_type: 'send_sms', detail: 'No recipient phone' }, true))
      .toBe('Échec : ce client n’a pas de numéro de téléphone');
    expect(resultatLisible({ issue: 'etape_retiree', categorie: 'annulee', action_type: 'send_sms' }, true)).toBe('Annulé : l’étape a été retirée du parcours');
    expect(resultatLisible({ issue: 'en_reprise', categorie: 'en_cours' }, true)).toBe('Échec passager : nouvelle tentative prévue');
  });

  it('les mêmes, en anglais — sans un mot de français', () => {
    const phrases = [
      resultatLisible({ issue: 'fait', categorie: 'envoyee', action_type: 'send_sms' }, false),
      resultatLisible({ issue: 'desabonne', categorie: 'ignoree', action_type: 'send_sms', detail: 'Client désabonné (texto)' }, false),
      resultatLisible({ issue: 'sans_telephone', categorie: 'ignoree', detail: 'Aucun numéro de téléphone pour ce client' }, false),
      resultatLisible({ issue: 'conditions', categorie: 'ignoree', detail: 'Conditions non remplies : source' }, false),
      resultatLisible({ issue: 'hors_heures', categorie: 'reportee' }, false),
      resultatLisible({ issue: 'annulee', categorie: 'annulee', detail: 'Annulée : le client a répondu.' }, false),
      resultatLisible({ issue: 'echec', categorie: 'echouee', detail: 'Lecture du carnet de clients impossible (erreur technique) — envoi suspendu' }, false),
      resultatLisible({ issue: 'un_code_de_demain', categorie: 'ignoree', detail: 'Une phrase française du moteur' }, false),
    ];
    expect(phrases[0]).toBe('Text sent');
    expect(phrases[1]).toBe('Skipped: client unsubscribed');
    expect(phrases[4]).toBe('Postponed to the next sending window');
    expect(phrases[5]).toBe('Cancelled: the client replied');
    expect(phrases.filter(francais), phrases.join('\n')).toEqual([]);
  });

  it('un échec dont le texte est inconnu : tel quel en français, une phrase neutre en anglais (le texte exact reste dans les Journaux)', () => {
    expect(raisonLisible('Client introuvable.', true)).toBe('Client introuvable.');
    expect(raisonLisible('Le calendrier du client est verrouillé.', false)).toBe('the step could not be completed (exact text in the logs)');
    // Un texte anglais du fournisseur reste lisible dans les deux langues.
    expect(raisonLisible('Twilio 30007: carrier violation', false)).toBe('Twilio 30007: carrier violation');
  });
});

describe('aucun texte brut du moteur dans la phrase lue par le propriétaire', () => {
  it('un échec reconnu est traduit ; une phrase française du moteur est gardée', () => {
    expect(resultatLisible({ issue: 'echec', categorie: 'echouee', detail: 'SMTP not configured' }, true)).toBe('Échec : l’envoi n’est pas configuré dans les réglages');
    expect(resultatLisible({ issue: 'echec', categorie: 'echouee', detail: 'Client introuvable.' }, true)).toBe('Échec : Client introuvable');
  });

  it('le texte brut d’un fournisseur devient une phrase neutre (le texte exact reste dans les Journaux)', () => {
    expect(resultatLisible({ issue: 'echec', categorie: 'echouee', detail: 'ECONNRESET socket hang up' }, true)).toBe('Échec : erreur technique (texte exact dans les Journaux)');
    expect(resultatLisible({ issue: 'echec', categorie: 'echouee', detail: 'ECONNRESET socket hang up' }, false)).toBe('Failed: technical error (exact text in the logs)');
    expect(resultatLisible({ issue: 'echec', categorie: 'echouee', detail: null }, true)).toBe('Échec');
  });

  it('jamais le numéro ni l’adresse d’un client dans une raison (constat D-03b)', () => {
    const avecNumero = [
      resultatLisible({ issue: 'echec', categorie: 'echouee', detail: 'Le numéro +15145550101 est refusé par l’opérateur' }, true),
      resultatLisible({ issue: 'echec', categorie: 'echouee', detail: 'Twilio 21211: invalid To number +15145550101' }, false),
      resultatLisible({ issue: 'plafond_frequence', categorie: 'ignoree', detail: 'Frequency cap reached for +15145550101 (max 3 commercial messages / 24h) — skipped to avoid spamming' }, true),
      resultatLisible({ issue: 'desabonne', categorie: 'ignoree', detail: 'Client désabonné : marie@exemple.ca' }, true),
      libelleIssue('plafond_frequence', true, 'Frequency cap reached for marie@exemple.ca'),
    ];
    for (const phrase of avecNumero) expect(phrase).not.toMatch(/\+1\d{10}|@|Frequency cap/i);
    expect(avecNumero[2]).toBe('Ignoré : ce client a déjà reçu le maximum de messages commerciaux sur 24 h');
    expect(avecNumero[3]).toBe('Ignoré : client désabonné');
  });
});

describe('D-12 — aucun motif français dans l’interface anglaise', () => {
  /** Écrits en FRANÇAIS par le moteur : `result_error` d'un journal ou `last_error` d'une tâche. */
  const MOTIFS_FRANCAIS = [
    'Aucune étiquette à ajouter.',
    'Aucun client rattaché à cette entité.',
    'Automatisation introuvable.',
    'Adresse refusée : adresse IP non publique.',
    'Lecture du carnet de clients impossible (erreur technique) — envoi suspendu',
    'Vérification « déjà envoyé » impossible — envoi reporté',
    'Envoyer dans Slack n’est pas encore disponible : la connexion à votre Slack n’existe pas. Rien n’a été publié.',
    'Automatisation en brouillon : envoi annulé.',
    'Annulée : le client a répondu.',
    'Annulée : le client a été supprimé.',
    'Annulée : la condition d’arrêt de la règle est remplie.',
    'rappel périmé : la fenêtre d\'envoi tombe après le rendez-vous',
    'Rafale de textos (> 30/min) : reporté d\'une minute',
    'send_sms n\'a pas répondu en 5 s — reprise 1/4 dans 5 min',
    'Fournisseur simulé en panne (bac à sable) — reprise 2/4 dans 30 min',
    'Étape supprimée du parcours : envoi annulé.',
    'Hors des heures d’envoi : reporté à la prochaine fenêtre',
  ];

  it.each(MOTIFS_FRANCAIS)('« %s » est rendu en anglais', (motif) => {
    const rendu = String(raisonLisible(motif, false));
    expect(francais(rendu), `rendu : « ${rendu} »`).toBe(false);
    expect(rendu).not.toBe(motif);
  });

  it('le motif d’un envoi ignoré (result_data.saute) suit la langue de l’écran', () => {
    const ligne = { result_success: true, result_data: { saute: 'Aucun numéro de téléphone pour ce client', saute_code: 'sans_telephone' } };
    expect(motifSaut(ligne, true)).toBe('Aucun numéro de téléphone pour ce client');
    expect(motifSaut(ligne, false)).toBe('No phone number for this client');
    // Sans langue donnée : le français, comme avant.
    expect(motifSaut(ligne)).toBe('Aucun numéro de téléphone pour ce client');
    // Une ancienne ligne sans code (2026-09-28) : un désabonnement.
    expect(motifSaut({ result_success: true, result_data: { saute: 'Client désabonné (texto)' } }, false)).toBe('Client unsubscribed');
    // Un envoi parti, ou un échec : pas un saut.
    expect(motifSaut({ result_success: true, result_data: { to: '+15145550101' } }, true)).toBeNull();
    expect(motifSaut({ result_success: false, result_data: null }, true)).toBeNull();
  });

  it('en français, la phrase du moteur garde son détail (« Conditions non remplies : source »)', () => {
    expect(libelleIssue('conditions', true, 'Conditions non remplies : source')).toBe('Conditions non remplies : source');
    expect(libelleIssue('conditions', false, 'Conditions non remplies : source')).toBe('Conditions not met');
  });

  it('chaque code de la liste a un libellé dans les deux langues, et l’anglais n’est pas du français', () => {
    for (const m of MOTIFS) {
      expect(libelleIssue(m.code, true), m.code).toBeTruthy();
      expect(francais(libelleIssue(m.code, false, m.fr)), `${m.code} : « ${libelleIssue(m.code, false, m.fr)} »`).toBe(false);
    }
  });
});

describe('D-22 — une étape retirée n’est pas « l’automatisation a été supprimée »', () => {
  it('les annulations écrites en phrases par l’ancien moteur retrouvent leur code', () => {
    expect(codeDeLaPhrase('Étape supprimée du parcours : envoi annulé.')).toBe('etape_retiree');
    expect(codeDeLaPhrase('Automatisation en brouillon : envoi annulé.')).toBe('regle_inactive');
    expect(codeDeLaPhrase('Annulée : le client a répondu.')).toBe('client_a_repondu');
    expect(codeDeLaPhrase('Annulée : le client a été supprimé.')).toBe('entite_supprimee');
    expect(codeDeLaPhrase('Annulée : la condition d’arrêt de la règle est remplie.')).toBe('condition_plus_valide');
    expect(codeDeLaPhrase('rappel périmé : la fenêtre d\'envoi tombe après le rendez-vous')).toBe('rappel_perime');
    expect(codeDeLaPhrase('Rafale de textos (> 30/min) : reporté d\'une minute')).toBe('rafale');
    expect(codeDeLaPhrase('Twilio 30007')).toBeNull();
  });

  it('et leur phrase dit la bonne chose', () => {
    const rendu = raisonLisible('Étape supprimée du parcours : envoi annulé.', true);
    expect(rendu).not.toBe('l’automatisation a été supprimée');
    expect(String(rendu)).toMatch(/étape/i);
    expect(libelleIssue('annulee', true, 'Étape supprimée du parcours : envoi annulé.')).toBe('L’étape a été retirée du parcours');
    expect(libelleIssue('annulee', false, 'Automatisation en brouillon : envoi annulé.')).toBe('The automation was unpublished or deleted');
    // Une annulation sans motif connu : une phrase, jamais un blanc.
    expect(libelleIssue('annulee', false, null)).toBe('The scheduled send was cancelled');
  });

  it('une tâche annulée sans code est rangée « condition plus valide »', () => {
    expect(groupeDeLIssue('annulee')).toBe('condition_plus_valide');
    expect(groupeDeLIssue('plafond_frequence')).toBe('plafond');
    expect(groupeDeLIssue('conditions')).toBe('hors_ciblage');
    expect(groupeDeLIssue('un_code_de_demain')).toBe('autre');
  });
});

describe('D-23 — ce qui est un « envoi », et ce qui n’en est pas', () => {
  it('les actions qui envoient un message au client sont celles du moteur (ACTIONS_MESSAGE)', () => {
    const source = lire('server/lib/automationEngine.ts');
    const liste = /const ACTIONS_MESSAGE = new Set\(\[([^\]]+)\]\)/.exec(source)?.[1] ?? '';
    const duMoteur = [...liste.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(duMoteur.length).toBeGreaterThan(3);
    expect([...ACTIONS_MESSAGE_CLIENT].sort()).toEqual(duMoteur);
  });

  it('une notification interne, une tâche, une étiquette ne sont jamais des envois', () => {
    for (const interne of ['create_notification', 'create_task', 'ajouter_etiquette', 'webhook', 'move_deal_stage']) {
      expect(ACTIONS_MESSAGE_CLIENT, interne).not.toContain(interne);
    }
  });

  it('aucune action du catalogue n’arrive à l’écran sous sa clé technique', () => {
    for (const a of ACTIONS) {
      for (const fr of [true, false]) {
        expect(libelleAction(a.cle, fr), a.cle).not.toMatch(/_/);
        expect(libelleFait(a.cle, fr), a.cle).not.toMatch(/_/);
      }
    }
    expect(libelleAction('une_action_inconnue', true)).toBe('Action');
  });
});

describe('la base et le fichier des motifs restent d’accord', () => {
  it('la table code → catégorie envoyée à la base couvre tous les motifs', () => {
    for (const m of MOTIFS) expect(CATEGORIES_PAR_CODE[m.code], m.code).toBe(m.categorie);
  });

  it('les codes que le moteur écrit aujourd’hui sont tous dans la liste', () => {
    const codes = new Set<string>();
    for (const f of ['server/lib/actions/index.ts', 'server/lib/automationEngine.ts', 'server/lib/desabonnement/index.ts']) {
      const source = lire(f);
      for (const m of source.matchAll(/saute_code:\s*'([a-z_]+)'/g)) codes.add(m[1]);
      for (const m of source.matchAll(/saute\((?:[^()]|\([^()]*\))*?,\s*'([a-z_]+)'\)/g)) codes.add(m[1]);
    }
    expect(codes.size).toBeGreaterThan(5);
    const inconnus = [...codes].filter((c) => !motifDuCode(c));
    expect(inconnus, `codes du moteur absents de src/lib/automationMotifs.ts : ${inconnus.join(', ')}`).toEqual([]);
  });

  it('les codes annoncés pour le moteur corrigé sont déjà lisibles', () => {
    for (const code of ['plafond_frequence', 'hors_heures', 'rafale', 'condition_plus_valide', 'entite_supprimee', 'fiche_fusionnee',
      'etape_retiree', 'regle_inactive', 'une_fois_par_client', 'doublon', 'sans_cible', 'avis_desactives', 'sans_lien_avis']) {
      expect(motifDuCode(code), code).toBeTruthy();
    }
  });

  it('chaque filtre de statut vise des catégories que la base connaît', () => {
    const connues = new Set(['envoyee', 'action', 'echouee', 'ignoree', 'annulee', 'reportee', 'en_cours', 'tentative']);
    for (const [filtre, categories] of Object.entries(FILTRES_STATUT)) {
      for (const c of categories) expect(connues.has(c), `${filtre} → ${c}`).toBe(true);
    }
    // « Réussis » et « Ignorés » ne se recouvrent pas (D-10).
    expect(FILTRES_STATUT.reussis.filter((c) => (FILTRES_STATUT.ignores as readonly string[]).includes(c))).toEqual([]);
  });

  it('seules 7, 30 et 90 jours sont des périodes d’écran', () => {
    expect([7, 30, 90, '30', 60, 0, 'x', null].map((v) => periodeValide(v))).toEqual([7, 30, 90, 30, null, null, null, null]);
  });
});
