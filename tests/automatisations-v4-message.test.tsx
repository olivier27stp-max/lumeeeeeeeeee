// @vitest-environment jsdom
//
// VAGUE 4 — A-06 : vider le texto d'une automatisation depuis la liste.
//
// L'audit (s10 S1) a vidé le texto d'une règle PUBLIÉE : « Enregistrer »
// restait actif, la base a reçu `body = ""`, toast « Message enregistré ».
// L'écriture passe par PostgREST (le PATCH serveur refuserait les actions
// internes des modèles, `log_activity`) : la garde vit donc dans l'écran ET
// dans `updateRuleMessage`, que partagent la liste et les Réglages.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const ecritures: unknown[] = [];
vi.mock('../src/lib/supabase', () => {
  const chaine: Record<string, unknown> = {};
  Object.assign(chaine, {
    select: () => chaine,
    eq: () => chaine,
    single: async () => ({ data: { actions: [{ type: 'send_sms', config: { body: 'Bonjour' } }] }, error: null }),
    update: (p: unknown) => { ecritures.push(p); return chaine; },
    then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: [{ id: 'r1' }], error: null }).then(ok),
  });
  return { supabase: { from: () => chaine } };
});
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() }) }));

import { updateRuleMessage } from '../src/lib/automationRulesApi';
import MessageEditor from '../src/components/automations/MessageEditor';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  ecritures.length = 0;
  localStorage.setItem('lume-language', 'fr');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function saisir(el: Element | null, v: string) {
  if (!el) throw new Error('champ introuvable');
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(el, v);
  act(() => { el.dispatchEvent(new Event('input', { bubbles: true })); });
}

describe('A-06 — un texto vide ne s’enregistre pas', () => {
  it('l’écran grise « Enregistrer » quand le texte est vide (ou que des espaces)', async () => {
    await act(async () => {
      root.render(<MessageEditor ruleId="r1" ruleName="Relance" actionType="send_sms" body="Bonjour" fr onSaved={() => {}} />);
    });
    saisir(container.querySelector('textarea'), '   ');
    const enregistrer = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Enregistrer'));
    expect(enregistrer?.disabled).toBe(true);
    expect(container.textContent).toContain('Le message ne peut pas être vide');
  });

  it('la fonction partagée refuse aussi, sans rien écrire', async () => {
    await expect(updateRuleMessage('r1', 'send_sms', '  ')).rejects.toThrow(/vide/);
    await expect(updateRuleMessage('r1', 'send_email', '<p> </p>', 'Objet')).rejects.toThrow(/vide/);
    await expect(updateRuleMessage('r1', 'send_email', '<p>Bonjour</p>', ' ')).rejects.toThrow(/objet/i);
    expect(ecritures).toHaveLength(0);
  });

  it('un vrai texte part toujours', async () => {
    await updateRuleMessage('r1', 'send_sms', 'Bonjour [client_first_name]');
    expect(ecritures).toHaveLength(1);
  });
});
