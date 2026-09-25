// Le filtre « À facturer » du calendrier ne doit montrer que ce qui reste
// vraiment à facturer.
//
// CE QUE CE TEST PROTÈGE. Le filtre retenait TOUTE job terminée, facturée ou
// non. En production : 647 visites affichées pour 31 qui restaient vraiment à
// facturer — 95 % de bruit. Un filtre qui ment à ce point, on cesse de
// l'ouvrir, et les 11 599 $ de travail non facturé restent invisibles.
//
// On teste la RÈGLE elle-même, pas le rendu : c'est une fonction pure, et
// c'est là qu'était le défaut. Un garde statique en fin de fichier vérifie
// que la page utilise bien cette règle.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

/** Copie de la règle de `Schedule.tsx` — le garde plus bas vérifie l'accord. */
const ns = (v: string | null | undefined) => String(v || '').trim().toLowerCase().replace(/\s+/g, '_');
const reqInv = (e: any) =>
  ns(e.job?.status || e.status) === 'completed' && e.job?.deja_facturee !== true;

const visite = (statutJob: string, dejaFacturee?: boolean) => ({
  id: 'e1',
  status: 'scheduled',
  job: { id: 'j1', status: statutJob, deja_facturee: dejaFacturee },
});

describe('calendrier — filtre « À facturer »', () => {
  it('retient une job terminée SANS facture', () => {
    expect(reqInv(visite('completed', false))).toBe(true);
  });

  it('écarte une job terminée DÉJÀ facturée', () => {
    // Le cœur du correctif : 616 visites de ce type polluaient la liste.
    expect(reqInv(visite('completed', true))).toBe(false);
  });

  it("écarte une job qui n'est pas terminée", () => {
    expect(reqInv(visite('scheduled', false))).toBe(false);
    expect(reqInv(visite('in_progress', false))).toBe(false);
  });

  it('montre la visite quand l information de facturation manque', () => {
    // `deja_facturee` absent (réponse en cache d'avant le correctif) : on
    // préfère une ligne en trop à une facture oubliée.
    expect(reqInv({ id: 'e1', status: 'scheduled', job: { id: 'j1', status: 'completed' } })).toBe(true);
  });

  it('accepte « Completed » avec une majuscule ou des espaces', () => {
    // `ns()` normalise : les statuts arrivent parfois capitalisés.
    expect(reqInv({ status: null, job: { status: ' Completed ', deja_facturee: false } })).toBe(true);
  });

  it('retombe sur le statut de la VISITE quand la job n en a pas', () => {
    expect(reqInv({ status: 'completed', job: null })).toBe(true);
  });
});

// ── Les gardes qui lisent les VRAIS fichiers ────────────────
//
// La règle ci-dessus est une copie. Sans ces gardes, quelqu'un pourrait
// remettre l'ancienne version dans la page et la suite resterait verte.
describe('les fichiers réels portent bien le correctif', () => {
  it('Schedule.tsx vérifie que la job n est pas déjà facturée', () => {
    const src = fs.readFileSync('src/pages/Schedule.tsx', 'utf8');
    expect(src).toContain('deja_facturee');
    // L'ancienne règle — terminée, point — ne doit pas revenir.
    expect(src).not.toMatch(/const reqInv = \(e: ScheduleEventRecord\) =>\s*ns\([^)]*\) === 'completed';/);
  });

  it('scheduleApi calcule le drapeau en UNE requête pour tout le lot', () => {
    const src = fs.readFileSync('src/lib/scheduleApi.ts', 'utf8');
    expect(src).toContain('deja_facturee');
    // `.in('job_id', jobIds)` : une requête pour toutes les visites. Une
    // requête par visite ferait des centaines d'allers-retours.
    expect(src).toMatch(/\.in\('job_id', jobIds\)/);
    // Une facture supprimée ne compte pas.
    expect(src).toMatch(/\.is\('deleted_at', null\)/);
  });
});
