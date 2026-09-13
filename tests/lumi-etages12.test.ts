/**
 * Étages 1 et 2 de la couche zéro-appel + repli (item 6, AGENTFORCE_GAP.md B3).
 * - étage 1 : énoncé exact normalisé → action (≤ 30 entrées, jamais plus) ;
 * - étage 2 : motifs bornés (job numéro N, tâches, équipe, devis en attente, où est l'équipe) ;
 * - repli : « pas ça » / Réessayer ne repasse jamais par un étage sans modèle.
 * Pur et statique : aucune base.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { detecterRaccourci, rendreRaccourci, raccourciDepuisAction, ENONCES_EXACTS, IDS_RACCOURCIS } from '../server/lib/lumi/raccourcis';

const lu = (p: string) => readFileSync(resolve(__dirname, '..', ...p.split('/')), 'utf8');
const opts = { fr: true, fuseau: 'America/Toronto', prenom: 'Raf', maintenant: new Date('2026-09-13T14:00:00Z') };

describe('étage 1 : énoncés exacts', () => {
  it('reconnaît un énoncé connu à la ponctuation et aux accents près, et le marque étage 1', () => {
    expect(detecterRaccourci('Qui est dans mon équipe ?')).toMatchObject({ id: 'equipe', etage: 1 });
    expect(detecterRaccourci('QU’EST-CE QU’IL ME RESTE COMME TÂCHES À FAIRE')).toMatchObject({ id: 'taches', etage: 1 });
    expect(detecterRaccourci('Prépare ma journée de demain')).toMatchObject({ id: 'agenda', periode: 'demain', etage: 1 });
    expect(detecterRaccourci('Combien de devis attendent une réponse du client ?')).toMatchObject({ id: 'devis-attente', etage: 1 });
  });
  it('plafond de 30 énoncés, tous distincts, tous vers une action connue', () => {
    expect(ENONCES_EXACTS.length).toBeLessThanOrEqual(30);
    expect(new Set(ENONCES_EXACTS.map(([e]) => e)).size).toBe(ENONCES_EXACTS.length);
    for (const [e, a] of ENONCES_EXACTS) {
      expect(IDS_RACCOURCIS).toContain(a.id);
      expect(e).toBe(e.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ''));
    }
  });
});

describe('étage 2 : motifs bornés', () => {
  it('job numéro N sous ses formes courtes, et rien d autre dans la phrase', () => {
    expect(detecterRaccourci('Montre-moi le job numéro 33.')).toMatchObject({ id: 'job-numero', numero: '33', etage: 2, args: { query: '33' } });
    expect(detecterRaccourci('job #33')).toMatchObject({ id: 'job-numero', numero: '33' });
    expect(detecterRaccourci('ouvre la job 12')).toMatchObject({ id: 'job-numero', numero: '12' });
    expect(detecterRaccourci('déplace le job 33 à demain')).toBeNull();
    expect(detecterRaccourci('le job 33 chez Luc')).toBeNull();
  });
  it('tâches, équipe, devis en attente, où est l équipe — et les négatifs', () => {
    expect(detecterRaccourci('mes tâches ouvertes')?.id).toBe('taches');
    expect(detecterRaccourci('ajoute une tâche')).toBeNull();
    expect(detecterRaccourci('c’est qui dans mon équipe')?.id).toBe('equipe');
    expect(detecterRaccourci('où est mon équipe en ce moment ?')?.id).toBe('ou-equipe');
    expect(detecterRaccourci('combien d’heures mon équipe a rentrées')).toBeNull();
    expect(detecterRaccourci('mes devis en attente de réponse')?.id).toBe('devis-attente');
    expect(detecterRaccourci('prépare un devis pour Luc')).toBeNull();
  });
  it('raccourciDepuisAction couvre les 11 actions et refuse un numéro de job non numérique', () => {
    for (const id of IDS_RACCOURCIS) expect(raccourciDepuisAction(id, id === 'job-numero' ? { numero: '7' } : {}), id).not.toBeNull();
    expect(raccourciDepuisAction('job-numero', { numero: 'abc' })).toBeNull();
  });
});

describe('gabarits des nouveaux raccourcis (vocabulaire d affichage, jamais un statut brut)', () => {
  it('tâches', () => {
    const t = rendreRaccourci({ id: 'taches', tool: 'list_tasks', args: {} }, { total_matching: 2, tasks: [{ title: 'Rappeler Marie', statut: 'à faire', due_date: '2026-09-15' }, { title: 'Commander du sel', statut: 'à faire' }] }, opts);
    expect(t).toBe('2 tâches à faire :\n• Rappeler Marie — Mardi 15 septembre\n• Commander du sel');
    expect(rendreRaccourci({ id: 'taches', tool: 'list_tasks', args: {} }, { total_matching: 0, tasks: [] }, opts)).toBe('Aucune tâche à faire. Tout est réglé.');
  });
  it('équipe (actifs seulement) et positions', () => {
    const e = rendreRaccourci({ id: 'equipe', tool: 'get_team', args: {} }, { members: [{ name: 'Julie Tremblay', role: 'propriétaire', statut: 'actif' }, { name: 'Ex Employé', role: 'technicien', statut: 'inactif' }] }, opts);
    expect(e).toBe('1 personne dans l’équipe :\n• Julie Tremblay · propriétaire');
    const p = rendreRaccourci({ id: 'ou-equipe', tool: 'get_team_locations', args: {} }, { members: [{ name: 'Marc', is_moving: true, updated_at: '2026-09-13T13:55:00Z' }] }, opts);
    expect(p).toBe('1 membre localisé :\n• Marc · en déplacement · il y a 5 min');
  });
  it('devis en attente et job par numéro', () => {
    const d = rendreRaccourci({ id: 'devis-attente', tool: 'list_quotes', args: {} }, { total_matching: 1, quotes: [{ quote_number: 'Q-0043', title: 'Gouttières', total_cents: 50000, statut: 'envoyé' }] }, opts);
    expect(d).toBe('1 devis en attente de réponse, 500,00 $ au total :\n• Q-0043 · Gouttières · 500,00 $');
    const j = rendreRaccourci({ id: 'job-numero', tool: 'list_jobs', args: {}, numero: '33' }, { jobs: [{ job_number: 33, title: 'Lavage de vitres', client: 'Luc Lavoie', date: '2026-09-15T13:00:00Z', display_status: 'planifiée', address: '12 rue des Pins', total_cents: 27500 }, { job_number: 330, title: 'Autre' }] }, opts);
    expect(j).toBe('Job #33 · Lavage de vitres\nClient : Luc Lavoie\nQuand : Mardi 15 septembre 9 h\nStatut : planifiée\nAdresse : 12 rue des Pins\nTotal : 275,00 $');
    expect(rendreRaccourci({ id: 'job-numero', tool: 'list_jobs', args: {}, numero: '99' }, { jobs: [] }, opts)).toBe('Je ne trouve pas de job numéro 99.');
  });
});

describe('repli', () => {
  it('« pas ça » ou Réessayer court-circuitent les étages 0-2 et tracent le candidat à retirer', () => {
    const r = lu('server/routes/lumi.ts');
    expect(r).toContain("const repli = origine === 'repli' || estUnRepli(message);");
    expect(r).toContain('const raccourci = enAttente.length || repli ? null : detecterRaccourci(message);');
    expect(r).toContain("action: 'repli', params: { candidat_retrait: normaliserEnonce(enoncePrecedent) }");
    expect(r).toContain("'pas ca', 'non pas ca', 'c est pas ca'");
    // L'étage reconnu (1 ou 2) est celui qui part dans la trace.
    expect(r).toContain('etage: raccourci.etage ?? ETAGE.raccourci');
  });
});
