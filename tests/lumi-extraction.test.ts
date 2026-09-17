/**
 * Extraction par le routeur (Haiku, 0,15 ¢) → carte bâtie par le code.
 * Schéma, mapping vers les actions directes, prompt.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validerVerdict, PROMPT_ROUTEUR, GENRES_EXTRACTION } from '../server/lib/lumi/routeur';
import { actionDepuisExtraction } from '../server/lib/lumi/actions-directes';

const base = { topic: 'planification', action: null, params: {}, confidence: 0.9 };

describe('schéma', () => {
  it('accepte une extraction bien formée, refuse un genre inconnu ou un champ inventé', () => {
    expect(validerVerdict({ ...base, extraction: { genre: 'job_chez', client: 'Linda Tremblay', quand: 'jeudi', heure: '9', titre: 'vitres' } })?.extraction?.genre).toBe('job_chez');
    expect(validerVerdict({ ...base, extraction: null })).not.toBeNull();
    expect(validerVerdict({ ...base })).not.toBeNull();
    expect(validerVerdict({ ...base, extraction: { genre: 'facture' } })).toBeNull();
    expect(validerVerdict({ ...base, extraction: { genre: 'tache', titre: 'x', prix: '12' } })).toBeNull();
    expect(GENRES_EXTRACTION).toContain('report_job');
  });
});

describe('extraction → action', () => {
  it('chaque genre donne la même action que le motif strict, ou null si un champ obligatoire manque', () => {
    expect(actionDepuisExtraction({ genre: 'job_chez', client: 'Linda Tremblay', quand: 'jeudi', heure: '13', titre: 'vitres' })).toMatchObject({ id: 'job-chez', tool: 'create_job', args: { title: 'vitres' }, cible: { nom: 'Linda Tremblay', quand: 'jeudi', heure: '13' } });
    expect(actionDepuisExtraction({ genre: 'job_chez' })).toBeNull();
    expect(actionDepuisExtraction({ genre: 'client', prenom: 'Linda', nom: 'Tremblay', telephone: '514-555-0199' })).toMatchObject({ id: 'client-cree', tool: 'create_client', args: { first_name: 'Linda', last_name: 'Tremblay', phone: '514-555-0199' } });
    expect(actionDepuisExtraction({ genre: 'prospect', prenom: 'Julie' })).toBeNull();
    expect(actionDepuisExtraction({ genre: 'texto', client: 'Linda', texte: 'on arrive' })).toMatchObject({ id: 'sms-dicte', args: { message_text: 'on arrive' } });
    expect(actionDepuisExtraction({ genre: 'texto', client: 'Linda' })).toBeNull();
    expect(actionDepuisExtraction({ genre: 'courriel', client: 'Linda', sujet: 'Visite', texte: 'On passe demain.' })).toMatchObject({ id: 'courriel-dicte', args: { subject: 'Visite', message: 'On passe demain.' } });
    expect(actionDepuisExtraction({ genre: 'note_client', client: 'Linda', texte: 'préfère le matin' })).toMatchObject({ id: 'client-note', args: { entity_type: 'client' } });
    expect(actionDepuisExtraction({ genre: 'tache', titre: 'commander du sel', quand: 'demain' })).toMatchObject({ id: 'tache-cree', args: { title: 'Commander du sel' }, cible: { texte: 'demain' } });
    expect(actionDepuisExtraction({ genre: 'report_job', numero: '34', quand: 'lundi', heure: '13' })).toMatchObject({ id: 'job-report', tool: 'reschedule_job', cible: { numero: '34' } });
    expect(actionDepuisExtraction({ genre: 'report_job', numero: '34' })).toBeNull();
  });
});

describe('prompt et branchement', () => {
  it('le prompt explique l extraction et ses refus ; la route ne l applique que sous le seuil de confiance et sans action', () => {
    expect(PROMPT_ROUTEUR).toContain('Extraction (champ « extraction », sinon null)');
    expect(PROMPT_ROUTEUR).toContain('« texte à Linda qu\'on arrive » demande de rédiger → pas d\'extraction');
    const r = readFileSync(resolve(__dirname, '..', 'server', 'routes', 'lumi.ts'), 'utf8');
    expect(r).toContain("if (routeur?.verdict?.extraction && routeur.decision === 'modele' && routeur.verdict.confidence >= SEUIL_CONFIANCE)");
    expect(r).toContain('raccourci: `extraction:${a.id}`');
  });
});
