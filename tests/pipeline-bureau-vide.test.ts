// Un board vide dans un bureau doit DIRE que les deals sont peut-être dans
// l'autre bureau.
//
// CE QUE CE TEST PROTÈGE. Chaque bureau ne voit que ses propres deals —
// l'isolation est voulue et doit le rester : c'est elle qui empêche les
// clients d'un bureau d'apparaître dans l'autre. Mais rien ne le DISAIT.
//
// En production : « Coquin lavage » porte 22 deals, « Vision Lavage » zéro.
// Depuis Vision Lavage on voyait « 0 deals · 0 en cours », un board vide, et
// on en concluait que l'app était cassée. Le pipeline `xdthdcg` de la capture
// appartenait d'ailleurs à Coquin lavage — donc invisible de l'autre côté.
//
// Le message du bureau passe AVANT celui du pipeline : changer de pipeline
// dans un bureau sans aucun deal ne montrera jamais rien, et on tournerait en
// rond entre des pipelines tous vides.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

/** La règle telle qu'elle est écrite dans le board. */
const bureauVide = (deals: unknown[], chargement: boolean, autres: unknown[]) =>
  deals.length === 0 && !chargement && autres.length > 0;

const AUTRE = [{ orgId: 'o2', companyName: 'Coquin lavage' }];

describe('board vide — on nomme le bureau', () => {
  it('aucun deal ici et un autre bureau existe → on le dit', () => {
    expect(bureauVide([], false, AUTRE)).toBe(true);
  });

  it("un seul bureau → pas ce message, ce serait un cul-de-sac", () => {
    // Proposer de « basculer » sans destination laisserait l'utilisateur
    // devant un bouton qui ne mène nulle part.
    expect(bureauVide([], false, [])).toBe(false);
  });

  it('pendant le chargement, on ne conclut rien', () => {
    // Le board part toujours vide : annoncer « aucun deal » avant la réponse
    // ferait clignoter un message faux à chaque ouverture.
    expect(bureauVide([], true, AUTRE)).toBe(false);
  });

  it('des deals présents → aucun message', () => {
    expect(bureauVide([{ id: 'd1' }], false, AUTRE)).toBe(false);
  });
});

// ── Les gardes qui lisent le VRAI fichier ───────────────────
describe('le board porte bien le correctif', () => {
  const src = () => fs.readFileSync('src/components/pipeline/PipelineBoard.tsx', 'utf8');

  it('le board connaît les bureaux de l utilisateur', () => {
    const t = src();
    expect(t).toContain('useCompany');
    expect(t).toContain('autresBureaux');
    expect(t).toContain('switchCompany');
  });

  it('le message du BUREAU passe avant celui du PIPELINE', () => {
    // L'ordre est le cœur du correctif : inversé, on renverrait l'utilisateur
    // vers d'autres pipelines du même bureau vide.
    const t = src();
    expect(t.indexOf('bureauVide ?')).toBeGreaterThan(-1);
    expect(t.indexOf('bureauVide ?')).toBeLessThan(t.indexOf('pipelineVide ?'));
  });

  it('on n annonce AUCUN nombre de deals de l autre bureau', () => {
    // La RLS ne laisse pas lire les deals d'un autre bureau depuis le
    // navigateur — vérifié en base : un membre de 2 bureaux n'en voit qu'un.
    // Afficher « 22 deals ailleurs » supposerait une lecture cross-tenant,
    // exactement ce que l'isolation interdit.
    const t = src();
    const bloc = t.slice(t.indexOf('bureauVide ?'), t.indexOf('pipelineVide ?'));
    expect(bloc).not.toMatch(/\bdeals\.length\b.*autre/i);
    expect(bloc).toContain('companyName');
  });
});
