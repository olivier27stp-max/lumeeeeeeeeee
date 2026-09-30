// @vitest-environment jsdom
//
// CRÉDITS LUMI — sur la VRAIE page Lumi (2026-09-30).
//
// L'usage IA passe de dollars à crédits. Décision du propriétaire : AUCUN
// montant en dollars d'IA au client, nulle part. On monte la vraie page avec
// l'API mockée au contrat du serveur, et on vérifie ce qui est À L'ÉCRAN :
//   · le compteur « 742 / 1 000 crédits Lumi · renouvellement le 12 nov. »
//     et sa barre accessible, en français et en anglais ;
//   · l'avis à 80 % et à 100 %, avec la VRAIE date de renouvellement ;
//   · épuisé = saisie désactivée + message, mais les actions rapides restent ;
//   · aucun « $ » rendu, ni au compteur, ni sous une réponse, ni pour une
//     conversation rechargée (les comptes internes gardent modèle + tokens).

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type Credits = {
  inclus: boolean; total: number; utilises: number; restants: number; pourcentage: number;
  renouvellement_le: string; palier: 'normal' | 'econome' | 'restreint' | 'epuise'; avertissement: null | '80' | '100';
};

function credits(over: Partial<Credits> = {}): Credits {
  return {
    inclus: true, total: 1000, utilises: 258, restants: 742, pourcentage: 26,
    renouvellement_le: '2026-11-12', palier: 'normal', avertissement: null, ...over,
  };
}

let quotaServi: { configured: boolean; credits: Credits } = { configured: true, credits: credits() };
let emailCourant = 'proprio@exemple.ca';
let fluxChat: (onEvent: (e: any) => void) => Promise<void> = async () => {};
let conversationServie: any = { conversation: { id: 'c1' }, messages: [], usage: undefined };

vi.mock('../src/lib/supabase', () => {
  const auth = {
    getUser: vi.fn(async () => ({ data: { user: { email: emailCourant, user_metadata: {} } } })),
    getSession: vi.fn(async () => ({ data: { session: null } })),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
    updateUser: vi.fn(async () => ({})),
  };
  return { supabase: { auth } };
});

vi.mock('../src/lib/lumiApi', async () => {
  const vrai = await vi.importActual<typeof import('../src/lib/lumiApi')>('../src/lib/lumiApi');
  return {
    ErreurLumi: vrai.ErreurLumi,
    quotaLumi: vi.fn(async () => quotaServi),
    listerConversationsLumi: vi.fn(async () => [{ id: 'c1', title: 'Hier', created_at: '', updated_at: '' }]),
    listerAutorisationsLumi: vi.fn(async () => []),
    definirAutorisationLumi: vi.fn(async () => []),
    modeLumi: vi.fn(async () => 'argent'),
    definirModeLumi: vi.fn(async (m: string) => m),
    chargerConversationLumi: vi.fn(async () => conversationServie),
    supprimerConversationLumi: vi.fn(async () => undefined),
    deciderPropositionLumi: vi.fn(async () => undefined),
    executerActionLumi: vi.fn(async () => 'ok'),
    envoyerMessageLumi: vi.fn(async (_p: unknown, onEvent: (e: any) => void) => fluxChat(onEvent)),
  };
});

// Micro et synthèse vocale : sans objet ici (jsdom n'a ni MediaRecorder ni speechSynthesis).
vi.mock('../src/features/agent/hooks/useVoiceInput', () => ({
  MAX_SECONDS: 60,
  useVoiceInput: () => ({ state: 'idle', seconds: 0, supported: true, start: vi.fn(), stop: vi.fn(), cancel: vi.fn() }),
}));
vi.mock('../src/features/agent/hooks/useSpeakReplies', () => ({
  useSpeakReplies: () => ({ supported: false, speaking: false, enabled: false, setEnabled: vi.fn(), speak: vi.fn(), stopSpeaking: vi.fn() }),
}));
vi.mock('../src/hooks/usePermissions', () => ({
  usePermissions: () => ({ permissions: null, role: 'owner', scope: 'all', userId: 'u1', teamId: null, departmentId: null, managerId: null, loading: false }),
}));
vi.mock('../src/components/ui/ConfirmDialog', () => ({ confirmer: vi.fn(async () => true), default: () => null }));

import Lumi from '../src/pages/Lumi';
import { LanguageProvider } from '../src/i18n';
import { ErreurLumi } from '../src/lib/lumiApi';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  quotaServi = { configured: true, credits: credits() };
  emailCourant = 'proprio@exemple.ca';
  fluxChat = async () => {};
  conversationServie = { conversation: { id: 'c1' }, messages: [], usage: undefined };
  localStorage.setItem('lume-language', 'fr');
  Element.prototype.scrollTo = function scrollTo() {} as any;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function rendre(url = '/lumi') {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[url]}>
        <LanguageProvider>
          <Lumi />
        </LanguageProvider>
      </MemoryRouter>,
    );
  });
  await act(async () => {});
  await act(async () => {});
}

/** Le texte de la page, espaces insécables normalisés (fr-CA écrit « 1 000 » avec U+00A0). */
const texte = () => (container.textContent ?? '').replace(/[  ]/g, ' ');
const barre = () => container.querySelector('[role="progressbar"]') as HTMLElement | null;
const saisie = () => container.querySelector('textarea') as HTMLTextAreaElement;

async function envoyer(message: string) {
  const zone = saisie();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(zone, message);
    zone.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const envoi = container.querySelector('button[aria-label="Envoyer"]') as HTMLButtonElement;
  await act(async () => { envoi.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await act(async () => {});
}

describe('compteur de crédits Lumi', () => {
  it('FR : « 742 / 1 000 crédits Lumi · renouvellement le 12 nov. » et une barre accessible', async () => {
    await rendre();
    expect(texte()).toContain('742 / 1 000 crédits Lumi');
    expect(texte()).toContain('renouvellement le 12 nov.');
    const b = barre();
    expect(b, 'la barre de progression porte role="progressbar"').not.toBeNull();
    expect(b!.getAttribute('aria-valuenow')).toBe('742');
    expect(b!.getAttribute('aria-valuemin')).toBe('0');
    expect(b!.getAttribute('aria-valuemax')).toBe('1000');
    expect(b!.getAttribute('aria-label')).toMatch(/crédits Lumi/i);
    // Sous 80 % : aucun avis.
    expect(texte()).not.toContain('Il te reste');
    expect(saisie().disabled).toBe(false);
  });

  it('EN : « 742 / 1,000 Lumi credits · renews Nov 12 »', async () => {
    localStorage.setItem('lume-language', 'en');
    await rendre();
    expect(texte()).toContain('742 / 1,000 Lumi credits');
    expect(texte()).toContain('renews Nov 12');
    expect(barre()!.getAttribute('aria-label')).toMatch(/Lumi credits/);
  });

  it('aucun « $ » ni « budget » sur la page (client)', async () => {
    await rendre();
    // Le compteur est bien là : c'est LUI qui ne doit pas parler en dollars.
    expect(barre()).not.toBeNull();
    expect(texte()).not.toContain('$');
    expect(texte()).not.toMatch(/budget/i);
  });

  it('forfait sans Lumi : pas de compteur, le forfait Autopilot est proposé', async () => {
    quotaServi = { configured: true, credits: credits({ inclus: false, total: 0, restants: 0, utilises: 0, pourcentage: 0 }) };
    await rendre();
    expect(barre()).toBeNull();
    expect(texte()).toContain('Lumi est inclus dans le forfait Autopilot.');
    expect(saisie().disabled).toBe(true);
  });
});

describe('avertissements', () => {
  it('à 80 % : « Il te reste X crédits Lumi jusqu’au 12 nov. », la saisie reste ouverte', async () => {
    quotaServi = { configured: true, credits: credits({ utilises: 850, restants: 150, pourcentage: 85, palier: 'econome', avertissement: '80' }) };
    await rendre();
    expect(texte()).toContain('Il te reste 150 crédits Lumi jusqu’au 12 nov.');
    expect(saisie().disabled).toBe(false);
    expect(texte()).not.toContain('$');
  });

  it('à 100 % : message épuisé avec la vraie date, saisie désactivée, actions rapides toujours là', async () => {
    quotaServi = { configured: true, credits: credits({ utilises: 1000, restants: 0, pourcentage: 100, palier: 'epuise', avertissement: '100' }) };
    await rendre();
    expect(texte()).toContain('Tes crédits Lumi sont épuisés jusqu’au 12 nov. Les actions rapides et tout le reste de Lume fonctionnent toujours.');
    expect(texte()).not.toContain('1er');
    expect(saisie().disabled).toBe(true);
    expect(saisie().placeholder).toContain('épuisés jusqu’au 12 nov.');
    // Les suggestions (étage 0, sans modèle) restent offertes.
    const suggestion = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Quel est mon chiffre du mois ?'));
    expect(suggestion, 'les actions rapides restent offertes quand les crédits sont épuisés').toBeTruthy();
    expect(barre()!.getAttribute('aria-valuenow')).toBe('0');
  });

  it('refus quota_epuise du serveur : crédits + vraie date, jamais « le 1er »', async () => {
    fluxChat = async () => { throw new ErreurLumi('quota_epuise', 'x', credits({ utilises: 1000, restants: 0, pourcentage: 100, palier: 'epuise', avertissement: '100' }) as any); };
    await rendre();
    await envoyer('Mes factures en retard ?');
    expect(texte()).toContain('Tes crédits Lumi sont épuisés jusqu’au 12 nov.');
    expect(texte()).not.toMatch(/1er|budget/);
    // Un seul message, pas deux (l'avis ne double pas le refus).
    expect(texte().split('sont épuisés').length - 1).toBe(1);
    expect(saisie().disabled).toBe(true);
  });

  it('ralenti : la date de renouvellement de l’entreprise, pas « le 1er »', async () => {
    fluxChat = async () => { throw new ErreurLumi('ralenti', 'x'); };
    await rendre();
    await envoyer('Bonjour');
    expect(texte()).toContain('jusqu’au 12 nov.');
    expect(texte()).not.toContain('1er');
  });
});

describe('le flux SSE met les crédits à jour, sans jamais afficher de dollars', () => {
  const tour = async (onEvent: (e: any) => void) => {
    onEvent({ type: 'tool', name: 'get_overdue_payments', statut: 'debut' });
    onEvent({ type: 'tool', name: 'get_overdue_payments', statut: 'fin' });
    onEvent({ type: 'text', delta: 'Tu as 3 factures en retard.' });
    onEvent({ type: 'usage', model: 'claude-sonnet-5', usage: { input_tokens: 1240, output_tokens: 312 } });
    onEvent({ type: 'done', conversation_id: 'c9', proposal: null, credits: credits({ utilises: 300, restants: 700, pourcentage: 30 }) });
  };

  it('client : le compteur suit `done.credits` ; ni coût, ni tokens sous la réponse', async () => {
    fluxChat = tour;
    await rendre();
    await envoyer('Mes factures en retard ?');
    expect(texte()).toContain('Tu as 3 factures en retard.');
    expect(texte()).toContain('700 / 1 000 crédits Lumi');
    expect(barre()!.getAttribute('aria-valuenow')).toBe('700');
    expect(texte()).not.toContain('$');
    expect(texte()).not.toContain('tokens');
  });

  it('compte interne (@lume-test.ca) : modèle et tokens, toujours sans dollars', async () => {
    emailCourant = 'bot@lume-test.ca';
    fluxChat = tour;
    await rendre();
    await envoyer('Mes factures en retard ?');
    expect(texte()).toContain('Sonnet 5');
    expect(texte()).toMatch(/1 240 → 312 tokens/);
    expect(texte()).not.toContain('$');
  });

  it('conversation rechargée : aucun coût de conversation affiché', async () => {
    conversationServie = {
      conversation: { id: 'c1' },
      messages: [{ role: 'assistant', text: 'Réponse d’hier', tools: [], usage: { model: 'claude-sonnet-5', input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, appels: 1 } }],
      usage: { model: null, input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, appels: 1 },
    };
    await rendre('/lumi?c=11111111-1111-1111-1111-111111111111');
    expect(texte()).toContain('Réponse d’hier');
    // Le compteur est affiché à côté de la conversation rechargée, sans coût.
    expect(texte()).toContain('742 / 1 000 crédits Lumi');
    expect(texte()).not.toContain('$');
    expect(texte()).not.toMatch(/cette conversation/i);
  });
});
