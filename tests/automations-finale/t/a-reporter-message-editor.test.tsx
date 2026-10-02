// @vitest-environment jsdom
/**
 * À REPORTER — `src/components/automations/MessageEditor.tsx` (et son appelant
 * `src/pages/Automations.tsx`), hors de la zone de l'agent T.
 *
 * Ces tests sont ROUGES tant que le changement décrit dans
 * `D:/lume-final/notes/T-corrections.md` (blocs « À REPORTER ») n'est pas
 * appliqué par l'agent qui possède ces fichiers. L'API (zone T) offre déjà tout
 * ce qu'il faut : `updateRuleMessage(…, cible)`, `LONGUEUR_MAX_TEXTO`,
 * `texteQuiPart`. Chaque test fait le geste de la spec Playwright citée.
 *
 * Le VRAI `MessageEditor`, monté comme la liste le monte, et la VRAIE API des
 * messages sur une fausse base.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const toasts = vi.hoisted(() => ({ succes: [] as string[], erreurs: [] as string[] }));
vi.mock('../../../src/lib/supabase', async () => (await import('./faux-supabase')).moduleSupabase());
vi.mock('../../../src/lib/orgApi', () => ({ getCurrentOrgId: async () => 'org-1', getCurrentOrgIdOrThrow: async () => 'org-1' }));
vi.mock('../../../src/components/ui/ConfirmDialog', () => ({ confirmer: async () => true, default: () => null }));
vi.mock('sonner', () => ({
  toast: Object.assign(() => {}, {
    success: (m: string) => { toasts.succes.push(m); },
    error: (m: string) => { toasts.erreurs.push(m); },
  }),
}));

import { remettre, ligne } from './faux-supabase';
import { monter, demonter, bouton, champs, cliquer, saisir, jusqua } from './banc-composants';
import MessageEditor from '../../../src/components/automations/MessageEditor';

type Action = { type: string; config: Record<string, unknown> };
type Regle = { id: string; actions: Action[]; steps: unknown[] | null };

function poser(actions: Action[], plus: Record<string, unknown> = {}): void {
  remettre({ automation_rules: [{ id: 'r1', org_id: 'org-1', actions, steps: null, deleted_at: null, ...plus }] });
}
const corpsSms = () => ligne<Regle>('automation_rules', 'r1').actions.filter((a) => a.type === 'send_sms').map((a) => a.config.body);
const zones = () => champs('Texto envoyé au client');

/** La ligne dépliée, comme `Automations.tsx` la rend aujourd'hui. Les propriétés ajoutées par le report passent par `plus`. */
async function deplier(actions: Action[], plus: Record<string, unknown> = {}) {
  const Editeur = MessageEditor as unknown as React.ComponentType<Record<string, unknown>>;
  let rang = -1;
  await monter(
    <div>
      {actions.filter((a) => a.type === 'send_sms' || a.type === 'send_email').map((a, i) => {
        if (a.type === 'send_sms') rang += 1;
        return (
          <Editeur
            key={`r1-${a.type}-${i}`} ruleId="r1" ruleName="Rappel" actionType={a.type}
            body={String(a.config.body ?? '')} subject={a.config.subject ? String(a.config.subject) : undefined}
            fr onSaved={() => {}} declencheur="appointment.created"
            rang={a.type === 'send_sms' ? rang : undefined}
            {...plus}
          />
        );
      })}
    </div>,
  );
}

beforeEach(() => { localStorage.setItem('lume-language', 'fr'); toasts.succes.length = 0; toasts.erreurs.length = 0; });
afterEach(async () => { await demonter(); });

describe('03-texto:172 [MSG-010] — modifier un texto ne touche pas à l’autre texto de la même automatisation', () => {
  it('corriger le premier de deux textos, « Enregistrer » : « Message enregistré », et seul le premier a changé', async () => {
    const actions = [
      { type: 'send_sms', config: { body: 'Premier texto : confirmation.' } },
      { type: 'send_sms', config: { body: 'Second texto : rappel la veille.' } },
    ];
    poser(actions);
    await deplier(actions);
    await saisir(zones()[0], 'Premier texto, corrigé.');
    await cliquer(bouton('Enregistrer', 0));
    await jusqua(() => toasts.erreurs.length + toasts.succes.length > 0);
    expect(toasts.erreurs).toEqual([]);
    expect(toasts.succes).toContain('Message enregistré');
    expect(corpsSms()).toEqual(['Premier texto, corrigé.', 'Second texto : rappel la veille.']);
  });
});
