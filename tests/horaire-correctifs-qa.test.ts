/**
 * Correctifs du module Horaire — QA du 2026-09-25.
 *
 * Trois défauts avaient en commun d'être invisibles à la lecture du code :
 * une règle métier dupliquée qui dérive de la base, un champ lu mais absent
 * de son interface, et une adresse recomposée à partir d'une chaîne qui la
 * contenait déjà. Ces tests les figent.
 */
import { describe, it, expect } from 'vitest';
import { visiteEnRetard } from '../src/lib/visiteEnRetard';
import { composerAdresse } from '../src/components/NewJobModal';

const MAINTENANT = new Date('2026-09-25T12:00:00Z');
const ilYA = (h: number) => new Date(MAINTENANT.getTime() - h * 3600_000).toISOString();
const dans = (h: number) => new Date(MAINTENANT.getTime() + h * 3600_000).toISOString();

describe('P1-1 — une visite en retard se voit sur les tuiles', () => {
  it('une visite passée, ni terminée ni annulée, est en retard', () => {
    expect(visiteEnRetard({ start_at: ilYA(3), status: 'scheduled' }, MAINTENANT)).toBe(true);
  });

  it('une visite à venir ne l’est pas', () => {
    expect(visiteEnRetard({ start_at: dans(3), status: 'scheduled' }, MAINTENANT)).toBe(false);
  });

  it('terminée ou annulée : plus de retard', () => {
    // La règle vient de la base (migration 20260752000000_job_tags.sql) :
    // `not in ('completed', 'cancelled')`. La reproduire ailleurs n'a de sens
    // que si elle reste identique.
    for (const status of ['completed', 'cancelled', 'COMPLETED', ' Cancelled ']) {
      expect(visiteEnRetard({ start_at: ilYA(3), status }, MAINTENANT), status).toBe(false);
    }
  });

  it('un autre statut passé reste en retard', () => {
    for (const status of ['scheduled', 'in_progress', '', null, undefined]) {
      expect(visiteEnRetard({ start_at: ilYA(1), status }, MAINTENANT), String(status)).toBe(true);
    }
  });

  it('sans date, ni retard ni plantage', () => {
    expect(visiteEnRetard({ start_at: null }, MAINTENANT)).toBe(false);
    expect(visiteEnRetard(null, MAINTENANT)).toBe(false);
    expect(visiteEnRetard({ start_at: 'pas-une-date' }, MAINTENANT)).toBe(false);
  });

  it('une visite qui commence à l’instant n’est pas encore en retard', () => {
    expect(visiteEnRetard({ start_at: MAINTENANT.toISOString(), status: 'scheduled' }, MAINTENANT)).toBe(false);
  });
});

describe('P1-6 — l’adresse ne se répète plus', () => {
  it('le cas du rapport : ville, province et code postal déjà présents', () => {
    // Observé : « … Montréal, Québec, H8S 2K9, Montréal, Québec, H8S 2K9 ».
    // L'autocomplétion Google met parfois l'adresse COMPLÈTE dans la première
    // ligne, et le code y recollait les champs séparés.
    const r = composerAdresse(
      '123 Boulevard Montréal Toronto, Montréal, Québec, H8S 2K9',
      'Montréal', 'Québec', 'H8S 2K9',
    );
    expect(r).toBe('123 Boulevard Montréal Toronto, Montréal, Québec, H8S 2K9');
  });

  it('assemble normalement quand les champs manquent dans la ligne', () => {
    expect(composerAdresse('123 rue Principale', 'Laval', 'Québec', 'H7N 1A1'))
      .toBe('123 rue Principale, Laval, Québec, H7N 1A1');
  });

  it('reconnaît « Quebec » comme « Québec »', () => {
    // Sans le repli des accents, la ville repartirait en double.
    const r = composerAdresse('45 av. du Parc, Quebec', 'Québec', 'Québec', 'G1R 2B5');
    expect(r).toBe('45 av. du Parc, Quebec, G1R 2B5');
  });

  it('ignore la casse', () => {
    expect(composerAdresse('12 rue Verte, MONTRÉAL', 'Montréal', '', '')).toBe('12 rue Verte, MONTRÉAL');
  });

  it('rend null sur une adresse vide', () => {
    expect(composerAdresse('', '', '', '')).toBeNull();
  });

  it('garde les champs fournis même sans première ligne', () => {
    expect(composerAdresse('', 'Laval', 'Québec', 'H7N 1A1')).toBe('Laval, Québec, H7N 1A1');
  });
});
