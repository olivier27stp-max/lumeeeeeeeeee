// @vitest-environment jsdom
/**
 * LE TEXTO DANS LA LISTE — triage « modèles » du 2026-10-01, fichier `03-texto`.
 *
 * Le VRAI `MessageEditor` (monté comme la liste le monte : un par message) et
 * la VRAIE API des messages, sur une fausse base. `MessageEditor.tsx` est hors
 * de la zone de l'agent T : ce fichier prouve ce que l'API garantit DÉJÀ sous
 * l'écran tel qu'il est ; ce qui demande un changement de `MessageEditor.tsx`
 * est dans `a-reporter-message-editor.test.tsx` (rouge jusqu'au report).
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

import { base, remettre, ligne } from './faux-supabase';
import { monter, demonter, bouton, champs, cliquer, saisir, jusqua } from './banc-composants';
import MessageEditor from '../../../src/components/automations/MessageEditor';

type Action = { type: string; config: Record<string, unknown> };
type Regle = { id: string; actions: Action[]; steps: unknown[] | null };

function poser(actions: Action[], plus: Record<string, unknown> = {}): void {
  remettre({ automation_rules: [{ id: 'r1', org_id: 'org-1', actions, steps: null, deleted_at: null, ...plus }] });
}
const corpsSms = () => ligne<Regle>('automation_rules', 'r1').actions.filter((a) => a.type === 'send_sms').map((a) => a.config.body);
const zones = () => champs('Texto envoyé au client');

/** La ligne dépliée, comme `Automations.tsx` la rend : un `MessageEditor` par texto ou courriel de `actions`. */
async function deplier(actions: Action[]) {
  await monter(
    <div>
      {actions.filter((a) => a.type === 'send_sms' || a.type === 'send_email').map((a, i) => (
        <MessageEditor
          key={`r1-${a.type}-${i}`} ruleId="r1" ruleName="Rappel" actionType={a.type as 'send_sms' | 'send_email'}
          body={String(a.config.body ?? '')} subject={a.config.subject ? String(a.config.subject) : undefined}
          fr onSaved={() => {}} declencheur="appointment.created"
        />
      ))}
    </div>,
  );
}

beforeEach(() => { localStorage.setItem('lume-language', 'fr'); toasts.succes.length = 0; toasts.erreurs.length = 0; });
afterEach(async () => { await demonter(); });

describe('03-texto:172 — deux textos dans la même automatisation', () => {
  it('avec l’écran tel qu’il est, corriger le premier ne recopie PLUS son texte dans le second : refus dit, rien n’est écrit', async () => {
    const actions = [
      { type: 'send_sms', config: { body: 'Premier texto : confirmation.' } },
      { type: 'send_sms', config: { body: 'Second texto : rappel la veille.' } },
    ];
    poser(actions);
    await deplier(actions);
    expect(zones()).toHaveLength(2);
    await saisir(zones()[0], 'Premier texto, corrigé.');
    await cliquer(bouton('Enregistrer', 0));
    await jusqua(() => toasts.erreurs.length + toasts.succes.length > 0);
    // Le second texto n'a pas été touché par l'utilisateur : il ne change pas.
    expect(corpsSms()[1]).toBe('Second texto : rappel la veille.');
    // Tant que l'écran ne dit pas LEQUEL il modifie, l'API refuse — et le dit.
    if (toasts.succes.length === 0) {
      expect(toasts.erreurs[0]).toMatch(/2 messages de ce type/);
      expect(base.ecritures).toHaveLength(0);
    } else {
      expect(corpsSms()).toEqual(['Premier texto, corrigé.', 'Second texto : rappel la veille.']);
    }
  });

  it('un seul texto : il s’enregistre comme avant, sans toucher au courriel ni aux autres actions', async () => {
    const courriel = { type: 'send_email', config: { subject: 'Objet', body: '<div><h2>Titre</h2><p>Corps</p></div>' } };
    const tache = { type: 'create_task', config: { title: 'Rappeler le client' } };
    const actions = [{ type: 'send_sms', config: { body: 'Bonjour', body_en: 'Hello' } }, courriel, tache];
    poser(actions);
    await deplier(actions);
    await saisir(zones()[0], 'Nouveau texto.');
    await cliquer(bouton('Enregistrer'));
    await jusqua(() => toasts.succes.includes('Message enregistré'));
    expect(ligne<Regle>('automation_rules', 'r1').actions).toEqual([
      { type: 'send_sms', config: { body: 'Nouveau texto.', body_en: 'Hello' } }, courriel, tache,
    ]);
  });
});
