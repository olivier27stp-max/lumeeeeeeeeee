// @vitest-environment jsdom
/**
 * T13 — DÉFAUTS de l'écran actuel des automatisations. ROUGE ATTENDU.
 *
 * Trouvés en réécrivant T13 pour le nouvel écran (2026-09-30, voir
 * tests/automation/front-automations-ecran.test.tsx). Le produit n'est PAS
 * corrigé ici : ces tests restent en quarantaine jusqu'au correctif.
 *
 * ── D1 · ROUGE ATTENDU (régression F22) ─────────────────────────────────
 * Une variable écrite à la main qui n'existe pas (« [prenom] ») n'est PAS
 * signalée dans le panneau d'étape de l'éditeur plein écran — là où toutes
 * les nouvelles automatisations s'écrivent.
 *
 * Preuve :
 *   · le serveur remplace une variable inconnue par du vide
 *     (`resolveTemplate`, server/lib/actions) : le client reçoit
 *     « Bonjour , à demain. » ;
 *   · l'avertissement existait dans `src/components/automations/AutomationBuilder.tsx`
 *     (`variablesDouteuses`, « Ces variables n'existent pas et seront
 *     remplacées par du vide »). La refonte #523 (344b356a, 2026-09-24) a
 *     retiré son seul `import` — le fichier n'est plus monté nulle part ;
 *   · `variablesInconnues` (src/lib/emailBodyText.ts) n'est plus appelée,
 *     côté interface, que par MessageEditor (règles au format d'origine,
 *     dans la liste) — jamais par PanneauEtape / ChampAction ;
 *   · le commentaire de AutomationBuilderPage (« ça saute aux yeux ici
 *     [l'aperçu], jamais dans l'éditeur ») le reconnaît : l'aperçu montre
 *     « Bonjour , » mais ne NOMME pas la variable fautive, ce que
 *     MessageEditor juge lui-même nécessaire.
 *
 * ── D2 · ROUGE ATTENDU (écart avec la liste) ─────────────────────────────
 * Le panneau d'étape n'affiche pas le nombre de SMS facturés au-delà de
 * 160 caractères (il montre « 200 / 1600 », la limite de saisie). La liste
 * (MessageEditor) l'affiche — « Twilio facture par tranche de 160
 * caractères : sans compteur, un texte rallongé double la facture sans que
 * personne ne le voie » — mais seulement pour les anciennes règles.
 *
 * Le témoin vert prouve que le panneau est bien monté : les rouges ne
 * viennent pas d'un banc cassé.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../src/components/ui/ConfirmDialog', () => ({ confirmer: vi.fn(async () => true), default: () => null }));
vi.mock('../../../src/hooks/useModuleAccess', () => ({ useModuleAccess: () => ({ isEnabled: false, loading: false }) }));
vi.mock('../../../src/lib/supabase', () => {
  const chaine: any = new Proxy(function () {}, {
    get: (_t, prop) => {
      if (prop === 'then') return (res: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(res);
      return () => chaine;
    },
    apply: () => chaine,
  });
  return {
    supabase: {
      from: () => chaine,
      rpc: async () => ({ data: null, error: null }),
      auth: {
        getUser: async () => ({ data: { user: null } }),
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
  };
});

import PanneauEtape from '../../../src/components/automations/PanneauEtape';
import type { Etape } from '../../../src/lib/sequenceTypes';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLDivElement;
let racine: Root | null = null;

async function monterTexto(corps: string) {
  const etape: Etape = { id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: corps } }, suivant: null };
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    racine!.render(
      <QueryClientProvider client={qc}>
        <PanneauEtape
          etape={etape} fr declencheur="appointment.created" membres={[]} etiquettes={[]}
          onEnregistrer={() => {}} onSupprimer={() => {}} onFermer={() => {}}
        />
      </QueryClientProvider>,
    );
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const texte = () => conteneur.textContent || '';

afterEach(async () => {
  if (racine) { await act(async () => racine!.unmount()); racine = null; }
  conteneur?.remove();
});

describe('T13 — panneau d’étape de l’éditeur plein écran (texto)', () => {
  it('témoin vert : le panneau monte, avec le texte du message et les variables à insérer', async () => {
    await monterTexto('Bonjour [client_name], à demain.');
    expect((conteneur.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Bonjour [client_name], à demain.');
    expect(texte()).toContain('Insérer une information du client');
    expect(texte()).toContain('Texte du message');
  });

  it('ROUGE ATTENDU (D1, régression F22) : la variable inconnue « [prenom] » n’est pas signalée — le client recevra « Bonjour , à demain. »', async () => {
    await monterTexto('Bonjour [prenom], à demain.');
    expect(texte(), 'aucun avertissement ne nomme [prenom]').toMatch(/\[prenom\][^]*(inconnue|n’existe pas|n'existe pas|sera vide|seront remplacées par du vide)|(inconnue|n’existe pas|n'existe pas)[^]*\[prenom\]/i);
  });

  it('ROUGE ATTENDU (D2) : au-delà de 160 caractères, le nombre de SMS facturés n’est pas affiché', async () => {
    await monterTexto('x'.repeat(200));
    // Ce qui EST affiché : la limite de saisie, pas la facturation.
    expect(texte()).toContain('200 / 1600');
    expect(texte(), 'seul « 200 / 1600 » est affiché').toMatch(/2 SMS/);
  });
});
