/**
 * Lume Agent est masqué — la fonctionnalité n'est pas encore ouverte.
 *
 * Masqué, pas supprimé : `MrLumePage` et `LumeAgentIcon` restent dans le
 * fichier pour qu'un simple retour en arrière suffise à la remettre en service.
 *
 * Le point délicat n'était pas de retirer l'entrée de menu, mais les deux
 * chemins qui y menaient sans passer par elle : le bouton « ? » de l'en-tête,
 * et surtout la route `/dashboard` qui redirigeait vers `/lume-agent`. Sans les
 * traiter, masquer la page aurait cassé le tableau de bord.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const app = readFileSync(resolve(__dirname, '..', 'src', 'App.tsx'), 'utf8');

describe('aucun chemin ne mène plus à Lume Agent', () => {
  it('l’entrée de menu a disparu', () => {
    expect(app).not.toContain("id: 'ai-helper'");
    expect(app).not.toContain("label: 'Lume Agent'");
  });

  it('le bouton « ? » de l’en-tête ne navigue plus vers la page', () => {
    expect(app).not.toContain("navigate('/lume-agent')");
  });

  it('/dashboard ne redirige plus vers une page masquée', () => {
    // C'était le piège : /dashboard pointait sur /lume-agent. Masquer la page
    // sans corriger ça envoyait le tableau de bord dans le vide.
    expect(app).not.toContain('<Navigate to="/lume-agent"');
    expect(app).toContain('<Route path="/dashboard" element={<Navigate to="/day" replace />} />');
  });
});

describe('la route reste, mais redirige', () => {
  it('/lume-agent renvoie vers /day', () => {
    // Redirigée plutôt que supprimée : un favori ou un lien déjà partagé ne
    // doit pas tomber sur une page blanche.
    expect(app).toContain('<Route path="/lume-agent" element={<Navigate to="/day" replace />} />');
  });

  it('la page n’est plus montée', () => {
    expect(app).not.toContain('<MrLumePage />');
  });

  it('/day existe réellement', () => {
    // Rediriger vers une route inexistante remplacerait un trou par un autre.
    expect(app).toMatch(/<Route path="\/day" element=/);
  });
});

describe('la remise en service reste simple', () => {
  it('le composant et l’icône sont conservés', () => {
    // Les supprimer obligerait à les réécrire pour rouvrir la fonctionnalité.
    expect(app).toContain("import MrLumePage from './features/agent/components/MrLumeChat'");
    expect(app).toContain('const LumeAgentIcon');
  });

  it('leur conservation est expliquée dans le code', () => {
    // Sans cette note, quelqu'un les supprimera comme du code mort.
    // On cherche l'intention, pas une mise en forme exacte : un simple
    // reformatage ne doit pas faire échouer le test.
    expect(app).toMatch(/Conserves volontairement[\s\S]{0,200}Lume Agent en service/);
  });
});
