// @vitest-environment jsdom
//
// Le clavardage de Lumi dans l'éditeur d'automatisations — rendu RÉEL.
//
// Demandé le 2026-09-28 : on écrit une fois dans l'encadré, puis le fil
// s'ouvre en panneau à gauche comme le support ; la conversation est gardée
// avec l'automatisation ; c'est offert.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ClavardageLumi from '../src/components/automations/ClavardageLumi';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let hote: HTMLDivElement | null = null;
afterEach(() => {
  act(() => racine?.unmount());
  hote?.remove();
  racine = null; hote = null;
});

function rendre(props: Partial<React.ComponentProps<typeof ClavardageLumi>> = {}) {
  const onEnvoyer = vi.fn();
  const onReduire = vi.fn();
  const complet: React.ComponentProps<typeof ClavardageLumi> = {
    fr: true, variante: 'carte', echanges: [], genere: false,
    prompt: '', onPrompt: vi.fn(), onEnvoyer, textareaId: 't-lumi', ...props,
    ...(props.variante === 'lateral' ? { onReduire } : {}),
  };
  hote = document.createElement('div');
  document.body.appendChild(hote);
  racine = createRoot(hote);
  act(() => racine!.render(<ClavardageLumi {...complet} />));
  return { hote, onEnvoyer: complet.onEnvoyer as ReturnType<typeof vi.fn>, onReduire };
}

const touche = (el: Element, key: string, shiftKey = false) =>
  act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true })); });

describe('avant le premier message : la carte au centre', () => {
  it('invite à décrire, sans panneau latéral, et dit que c’est déduit des crédits Lumi', () => {
    const { hote } = rendre();
    expect(hote.textContent).toContain('Décris ton automatisation à Lumi');
    expect(hote.querySelector('aside')).toBeNull();
    expect(hote.textContent).toContain('Déduit de tes crédits Lumi');
    // Crédits Lumi (2026-09-30) : plus de « budget », jamais de dollars.
    expect(hote.textContent).not.toMatch(/budget|\$/i);
  });

  it('Entrée envoie une demande assez longue ; Maj+Entrée non', () => {
    const { hote, onEnvoyer } = rendre({ prompt: 'relance le devis après 3 jours par texto' });
    const champ = hote.querySelector('textarea')!;
    touche(champ, 'Enter', true);
    expect(onEnvoyer).not.toHaveBeenCalled();
    touche(champ, 'Enter');
    expect(onEnvoyer).toHaveBeenCalledTimes(1);
  });

  it('une demande trop courte n’envoie rien', () => {
    const { hote, onEnvoyer } = rendre({ prompt: 'relance' });
    touche(hote.querySelector('textarea')!, 'Enter');
    expect(onEnvoyer).not.toHaveBeenCalled();
  });
});

describe('après : le panneau à gauche', () => {
  const echanges = [
    { role: 'user' as const, content: 'Relance le devis après 3 jours par texto.' },
    { role: 'assistant' as const, content: 'Devis envoyé → attendre 3 jours → texto de relance.' },
  ];

  it('le fil s’affiche dans un panneau latéral, les deux rôles visibles', () => {
    const { hote } = rendre({ variante: 'lateral', echanges });
    const panneau = hote.querySelector('aside[aria-label="Clavardage avec Lumi"]');
    expect(panneau).not.toBeNull();
    expect(panneau!.textContent).toContain('Relance le devis après 3 jours');
    expect(panneau!.textContent).toContain('attendre 3 jours');
    expect(panneau!.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  it('le tour en cours s’affiche pendant que Lumi travaille', () => {
    const { hote } = rendre({ variante: 'lateral', echanges, genere: true, prompt: 'ajoute un courriel après 2 jours' });
    expect(hote.textContent).toContain('ajoute un courriel après 2 jours');
    expect(hote.textContent).toContain('Lumi construit…');
  });

  it('le panneau se replie', () => {
    const { hote, onReduire } = rendre({ variante: 'lateral', echanges });
    const bouton = hote.querySelector('button[aria-label="Replier le clavardage"]') as HTMLButtonElement;
    act(() => bouton.click());
    expect(onReduire).toHaveBeenCalledTimes(1);
  });
});

describe('l’éditeur', () => {
  const editeur = readFileSync(resolve(__dirname, '../src/pages/AutomationBuilderPage.tsx'), 'utf8');

  it('ouvre le panneau dès le premier message (ou pendant qu’il part)', () => {
    expect(editeur).toMatch(/const lumiLateral = lumiDisponible && \(echangesLumi\.length > 0 \|\| genere\);/);
    expect(editeur).toMatch(/variante="lateral"/);
  });

  it('recharge la conversation gardée avec l’automatisation', () => {
    expect(editeur).toMatch(/setEchangesLumi\(Array\.isArray\(trouvee\?\.lumi_conversation\)/);
  });

  it('réserve Lumi aux forfaits qui l’incluent (Autopilot) et propose Autopilot aux autres', () => {
    expect(editeur).toMatch(/usePlanFeature\('includes_ai'\)/);
    expect(editeur).toMatch(/Construire avec Lumi — inclus dans Autopilot/);
  });

  it('lit ?lumi=1 et place le curseur dans le champ', () => {
    expect(editeur).toMatch(/parametres\.get\('lumi'\) === '1'/);
    expect(editeur).toMatch(/champLumi\.current\?\.focus\(\)/);
  });

  it('envoie l’id de l’automatisation pour que le serveur garde le fil', () => {
    // L'id RÉEL (un brouillon est créé juste avant le 1er envoi à Lumi).
    expect(editeur).toMatch(/ruleId: idReel\.current/);
    expect(readFileSync(resolve(__dirname, '../server/routes/automation-rules.ts'), 'utf8'))
      .toMatch(/update\(\{ lumi_conversation: conversation \}\)/);
  });
});
