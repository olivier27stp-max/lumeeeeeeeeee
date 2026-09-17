/**
 * Fidélité de l'extraction : rien d'inventé, rien de réécrit. Sinon, le modèle.
 */
import { describe, it, expect } from 'vitest';
import { extractionFidele, actionDepuisExtraction } from '../server/lib/lumi/actions-directes';

describe('extractionFidele', () => {
  it('refuse un placeholder ou un nom absent du message', () => {
    expect(extractionFidele({ genre: 'client', prenom: 'Linda', nom: '<UNKNOWN>' }, 'ajoute Linda comme cliente')).toBe(false);
    expect(extractionFidele({ genre: 'client', prenom: 'Linda', nom: 'Tremblay' }, 'ajoute Linda comme cliente')).toBe(false);
    expect(extractionFidele({ genre: 'client', prenom: 'Linda', nom: 'Tremblay', telephone: '514-555-0199' }, 'ajoute Linda Tremblay comme cliente, son cell c’est 514 555-0199')).toBe(true);
  });
  it('un texte dicté doit être mot pour mot ; une réécriture rend au modèle', () => {
    expect(extractionFidele({ genre: 'texto', client: 'Julie Fortin', texte: 'on arrive dans 10 minutes' }, 'texte à Julie Fortin qu’on arrive dans 10 minutes')).toBe(false); // « qu'on » ≠ « on »
    expect(extractionFidele({ genre: 'texto', client: 'Julie Fortin', texte: 'on arrive dans 10 minutes' }, 'texte à Julie Fortin mot pour mot : on arrive dans 10 minutes')).toBe(true);
    expect(extractionFidele({ genre: 'note_client', client: 'Julie Fortin', texte: 'préfère les rendez-vous le matin' }, 'mets une note sur la fiche de Julie Fortin, elle préfère les rendez-vous le matin')).toBe(true);
  });
  it('un titre peut être normalisé d un mot ; un client doit être dans la phrase', () => {
    expect(extractionFidele({ genre: 'tache', titre: 'Commander du sel', quand: 'demain' }, 'rappelle-moi de commander du sel demain')).toBe(true);
    expect(extractionFidele({ genre: 'job_chez', client: 'Linda Tremblay', quand: 'jeudi', titre: 'vitres' }, 'fais-moi une job chez Linda Tremblay jeudi matin pour les vitres')).toBe(true);
    expect(extractionFidele({ genre: 'job_chez', client: 'Linda Gagnon', quand: 'jeudi' }, 'fais-moi une job chez Linda Tremblay jeudi')).toBe(false);
  });
  it('actionDepuisExtraction applique la fidélité quand le message est fourni', () => {
    expect(actionDepuisExtraction({ genre: 'client', prenom: 'Linda', nom: '<UNKNOWN>' }, 'ajoute Linda comme cliente')).toBeNull();
    expect(actionDepuisExtraction({ genre: 'texto', client: 'Julie Fortin', texte: 'on arrive' }, 'texte à Julie Fortin qu’on arrive')).toBeNull();
    expect(actionDepuisExtraction({ genre: 'texto', client: 'Julie Fortin', texte: 'on arrive' }, 'texte à Julie Fortin : on arrive')).not.toBeNull();
    expect(actionDepuisExtraction({ genre: 'texto', client: 'Julie Fortin', texte: 'on arrive' }, 'texte à Julie Fortin « on arrive »')).not.toBeNull();
    expect(actionDepuisExtraction({ genre: 'texto', client: 'Julie Fortin', texte: 'on arrive' }, 'texte à Julie Fortin mot pour mot on arrive')).not.toBeNull();
  });
});
