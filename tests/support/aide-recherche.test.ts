/**
 * Recherche d'aide (search_help) « hors pair » (2026-09-17) : 37 questions
 * naturelles de clients, en joual et sans accents, doivent trouver le bon
 * écran dans le top 3 — hors ligne, 0 ¢. Radical français, synonymes de la
 * question, sous-puces rattachées à leur écran, bonus sur le titre.
 */
import { describe, it, expect } from 'vitest';
import { chercherAide, passagesCarteApp, radical } from '../../server/lib/agent/tools-aide';

const CAS: Array<[string, RegExp]> = [
  ['comment je supprime une tache', /\/tasks/],
  ['je veux effacer une job', /\/jobs/],
  ['comment changer la date d’une job', /\/calendar|\/jobs/],
  ['archiver un client qui a fermé', /\/clients/],
  ['ou je vois les demandes du formulaire', /\/requests/],
  ['comment envoyer un devis par courriel', /\/quotes/],
  ['transformer une soumission en facture', /\/quotes/],
  ['envoyer un texto a un client', /\/messages/],
  ['comment créer une facture', /\/invoices\/new|\/finances/],
  ['exporter mes factures en csv', /\/finances/],
  ['activer les paiements en ligne', /\/settings\/payments|\/finances/],
  ['ajouter la tps tvq', /\/settings\/taxes/],
  ['changer mon forfait', /\/settings\/billing/],
  ['annuler mon abonnement', /\/settings\/billing/],
  ['ajouter un employé', /\/settings\/team/],
  ['donner des permissions a un technicien', /\/settings\/roles/],
  ['voir les heures travaillées de mon équipe', /\/timesheets/],
  ['suivre mes gars par gps', /\/settings\/location|\/dispatch/],
  ['créer une formation pour mes employés', /\/courses/],
  ['ajouter un pin sur la map porte a porte', /\/field-sales/],
  ['mon pipeline de ventes', /\/pipeline/],
  ['changer mon mot de passe', /\/auth|\/settings\/profile/],
  ['changer le logo de l’entreprise', /\/settings\/company/],
  ['ajouter un service avec un prix', /\/settings\/products/],
  ['créer une automatisation de rappel', /\/automations/],
  ['demander des avis google', /\/settings\/reviews/],
  ['importer mes clients', /import|\/clients|\/migration/],
  ['ou je vois mes versements stripe', /\/finances/],
  ['comment marquer une facture payée', /\/finances|\/invoices/],
  ['je veux un deuxième bureau', /\/settings\/offices/],
  ['comment fonctionne les commissions', /\/commissions/],
  ['remettre un client archivé', /\/settings\/archive|\/clients/],
  ['changer la langue en anglais', /\/settings\/profile/],
  ['ajouter une signature au devis', /\/quotes|\/settings/],
  ['le client peut payer en ligne ?', /\/settings\/payments|\/fonctions/],
  ['créer un geofence', /\/dispatch/],
  ['ou est le formulaire de demande public', /\/requests|\/settings\/form/],
];

describe('search_help : questions naturelles', () => {
  it.each(CAS)('%s', (q, attendu) => {
    const r = chercherAide(q, 3);
    expect(r.map((p) => p.page).join(' | '), q).toMatch(attendu);
  });
  it('les onglets de Finances (sous-puces) portent la route de Finances, pas la page Support', () => {
    const p = passagesCarteApp();
    const facturation = p.find((x) => /Finances — Facturation/.test(x.titre));
    expect(facturation?.page).toBe('/finances');
    expect(p.filter((x) => /^Finances — /.test(x.titre)).map((x) => x.page)).toEqual(['/finances', '/finances', '/finances']);
  });
  it('radical : pluriel, -ation, -e', () => {
    expect(radical('factures')).toBe('factur');
    expect(radical('facturation')).toBe('factur');
    expect(radical('geofences')).toBe('geofenc');
    expect(radical('equipe')).toBe('equip');
    expect(radical('devis')).toBe('devi');
    expect(radical('job')).toBe('job');
  });
});
