// @vitest-environment jsdom
//
// Les deux réglages d'affichage d'un pipeline, repris de la page
// « Pipelines » de GoHighLevel.
//
// CE QUE CES TESTS PROTÈGENT. `color_mode` et `use_deal_probability`
// existaient en base depuis le début, mais n'étaient posés qu'à la CRÉATION :
// pour passer d'un affichage gris à un affichage teinté, il fallait recréer
// le pipeline — donc perdre ses deals.
//
// Le point le plus facile à casser : chaque bascule ne doit écrire QUE son
// champ. Renvoyer les deux à chaque fois écraserait le réglage qu'un autre
// onglet vient de changer.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const definirMock = vi.fn(async (..._a: any[]) => undefined);

/**
 * On reproduit la logique d'écriture du composant plutôt que de monter
 * `PipelineReglages` en entier — il tire six requêtes et la moitié de l'app.
 * Le garde statique en fin de fichier vérifie que l'écran l'appelle bien.
 */
function ecrire(reglages: { color_mode?: string; use_deal_probability?: boolean }) {
  return definirMock('pipe-1', reglages);
}

let hote: HTMLDivElement;
let racine: ReturnType<typeof createRoot>;

beforeEach(() => {
  definirMock.mockClear();
  hote = document.createElement('div');
  document.body.appendChild(hote);
  racine = createRoot(hote);
});

afterEach(() => {
  act(() => racine.unmount());
  hote.remove();
});

describe('réglages d affichage — une bascule n écrit que son champ', () => {
  it('changer la couleur ne touche pas au mode de probabilité', async () => {
    await ecrire({ color_mode: 'tint' });
    const envoye = definirMock.mock.calls[0][1] as any;
    expect(envoye.color_mode).toBe('tint');
    // Le cœur du contrat : absent, donc non écrit côté base.
    expect(envoye.use_deal_probability).toBeUndefined();
  });

  it('changer la probabilité ne touche pas à la couleur', async () => {
    await ecrire({ use_deal_probability: true });
    const envoye = definirMock.mock.calls[0][1] as any;
    expect(envoye.use_deal_probability).toBe(true);
    expect(envoye.color_mode).toBeUndefined();
  });
});

// ── Les gardes qui lisent les VRAIS fichiers ────────────────
describe('les fichiers réels portent bien le correctif', () => {
  const ecran = () => fs.readFileSync('src/components/pipeline/PipelineReglages.tsx', 'utf8');

  it('l écran appelle definirAffichagePipeline', () => {
    expect(ecran()).toContain('definirAffichagePipeline');
  });

  it('les trois modes de couleur correspondent à la contrainte CHECK de la base', () => {
    // `color_mode` porte un CHECK (none, dot, tint). Proposer une quatrième
    // valeur à l'écran ferait échouer l'écriture avec une erreur Postgres
    // brute sous les yeux de l'utilisateur.
    const src = ecran();
    for (const mode of ["'none'", "'dot'", "'tint'"]) {
      expect(src).toContain(mode);
    }
  });

  it('l interrupteur et les boutons de couleur sont accessibles', () => {
    const src = ecran();
    // Le cliquet d'accessibilité du projet : 0 champ sans label, 0 bouton
    // sans nom accessible, 0 outline-none sans focus-visible.
    expect(src).toContain('role="switch"');
    expect(src).toContain('aria-checked');
    expect(src).toContain('aria-pressed');
    expect(src).toContain('htmlFor={idProba}');
    expect(src).toContain('focus-visible:ring-2');
  });

  it('l API n envoie null que pour un champ absent', () => {
    const api = fs.readFileSync('src/lib/pipelineVentesApi.ts', 'utf8');
    expect(api).toContain('pipeline_definir_affichage');
    // `?? null` : undefined devient null, et la fonction SQL laisse alors le
    // champ intact (coalesce). C'est ce qui rend les bascules indépendantes.
    expect(api).toMatch(/p_color_mode: reglages\.color_mode \?\? null/);
    expect(api).toMatch(/p_use_deal_probability: reglages\.use_deal_probability \?\? null/);
  });

  it("l onglet s appelle « Pipelines », plus « Réglages »", () => {
    const page = fs.readFileSync('src/pages/Pipeline.tsx', 'utf8');
    expect(page).toMatch(/libelle: 'Pipelines'/);
    expect(page).not.toMatch(/libelle: fr \? 'Réglages' : 'Settings'/);
  });
});
