/**
 * Agent D — point 5 : « chaque échec ou exécution ignorée a une raison compréhensible »,
 * en français ET en anglais.
 *
 * Sans réseau : on passe à la fonction de l'écran (`raisonLisible`, celle des onglets Journaux
 * et Historique) les textes que le moteur écrit vraiment. Les textes viennent du code du
 * moteur et du relevé de prod du 2026-10-01 (motifs d'échec des 60 derniers jours, masqués).
 */
import { describe, it, expect } from 'vitest';
import { raisonLisible, motifSaut } from '../../../../src/lib/automationJournauxApi';

/** Écrits en FRANÇAIS par le moteur : `result_error` d'un journal ou `last_error` d'une tâche. */
const MOTIFS_FRANCAIS = [
  // server/lib/actions/index.ts
  'Aucune étiquette à ajouter.',
  'Aucun client rattaché à cette entité.',
  'Automatisation introuvable.',
  'Adresse refusée : adresse IP non publique.',
  'Lecture du carnet de clients impossible (erreur technique) — envoi suspendu',
  'Vérification « déjà envoyé » impossible — envoi reporté',
  'Envoyer dans Slack n’est pas encore disponible : la connexion à votre Slack n’existe pas. Rien n’a été publié.',
  // server/lib/automationEngine.ts — annulations et reports (last_error)
  'Automatisation en brouillon : envoi annulé.',
  'Annulée : le client a répondu.',
  'Annulée : le client a été supprimé.',
  'Annulée : la condition d’arrêt de la règle est remplie.',
  'rappel périmé : la fenêtre d\'envoi tombe après le rendez-vous',
  'Rafale de textos (> 30/min) : reporté d\'une minute',
  'send_sms n\'a pas répondu en 5 s — reprise 1/4 dans 5 min',
];

const aLAirFrancais = (t: string) => /[éèêàçù]|\b(le|la|les|une?|des|pas|est|été|envoi)\b/i.test(t);

describe('D — les raisons affichées dans les onglets Journaux et Historique', () => {
  it('[D-12b] en anglais, aucun motif écrit en français par le moteur ne sort tel quel', () => {
    const restes = MOTIFS_FRANCAIS.filter((m) => aLAirFrancais(String(raisonLisible(m, false))));
    expect(restes, `motifs affichés en français dans l'interface anglaise (${restes.length}/${MOTIFS_FRANCAIS.length}) :\n${restes.join('\n')}`).toEqual([]);
  });

  it('[D-12c] en anglais, le motif d’un envoi sauté (result_data.saute) est rendu en anglais', () => {
    const ligne = { result_success: true, result_data: { saute: 'Aucun numéro de téléphone pour ce client', saute_code: 'sans_telephone' } };
    // Aujourd'hui `motifSaut` n'a pas de langue : il rend la phrase française du moteur.
    const rendu = (motifSaut as unknown as (l: typeof ligne, fr?: boolean) => string | null)(ligne, false);
    expect(aLAirFrancais(String(rendu)), `rendu : « ${rendu} »`).toBe(false);
  });

  it('[D-22] « Étape supprimée du parcours » n’est pas traduit par « l’automatisation a été supprimée »', () => {
    // Le mot « supprimée » suffit aujourd'hui à déclencher la mauvaise raison.
    const rendu = raisonLisible('Étape supprimée du parcours : envoi annulé.', true);
    expect(rendu).not.toBe('l’automatisation a été supprimée');
    expect(String(rendu)).toMatch(/étape/i);
  });

  it('[D-EL-25] témoin : les motifs anglais les plus fréquents en prod sont traduits en français', () => {
    const anglais = [
      'Twilio not configured',
      'No recipient email',
      'No recipient phone',
      'A review request was already sent to this client in the last 7 days.',
      'Review request could not be sent',
      'Review requests are disabled in Settings → Customer reviews.',
      'Organization has no SMS number provisioned (sms_not_provisioned)',
      'Table not allowed for update_status: memberships',
      'Frequency cap reached for +15145550101 (max 3 commercial messages / 24h) — skipped to avoid spamming',
    ];
    const bruts = anglais.filter((m) => raisonLisible(m, true) === m);
    expect(bruts, bruts.join('\n')).toEqual([]);
  });
});
