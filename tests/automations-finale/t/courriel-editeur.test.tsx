// @vitest-environment jsdom
/**
 * L'ÉDITEUR DE COURRIEL D'UNE AUTOMATISATION — triage « modèles » du 2026-10-01,
 * fichier `04-courriel`. Le VRAI `EmailPreviewEditor` et la VRAIE API des
 * messages, sur une fausse base en mémoire : on fait le geste de l'utilisateur
 * et on regarde ce qui est écrit. Un bloc `describe` par ligne du triage.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const toasts = vi.hoisted(() => ({ succes: [] as string[], erreurs: [] as string[] }));
const confirmerMock = vi.hoisted(() => vi.fn(async (_o: unknown) => true));
const apercu = vi.hoisted(() => ({ appels: [] as unknown[][], essais: [] as unknown[][] }));

vi.mock('../../../src/lib/supabase', async () => (await import('./faux-supabase')).moduleSupabase());
vi.mock('../../../src/lib/orgApi', () => ({ getCurrentOrgId: async () => 'org-1', getCurrentOrgIdOrThrow: async () => 'org-1' }));
vi.mock('../../../src/components/ui/ConfirmDialog', () => ({ confirmer: (o: unknown) => confirmerMock(o), default: () => null }));
vi.mock('../../../src/hooks/useChampsPersoActifs', () => ({ useChampsPersoActifs: () => ({ isEnabled: false, loading: false }) }));
vi.mock('../../../src/lib/champsPersoApi', () => ({ listerChamps: async () => ({ fields: [] }) }));
vi.mock('../../../src/lib/emailTemplatesApi', () => ({
  apercuCourriel: async (...a: unknown[]) => { apercu.appels.push(a); return '<p>aperçu</p>'; },
  envoyerEssaiCourriel: async (...a: unknown[]) => { apercu.essais.push(a); return 'proprio@lume-qa.test'; },
}));
vi.mock('sonner', () => {
  const toast = Object.assign((m: string) => { toasts.succes.push(m); }, {
    success: (m: string) => { toasts.succes.push(m); },
    error: (m: string) => { toasts.erreurs.push(m); },
    info: () => {},
  });
  return { toast };
});

import { remettre, ligne } from './faux-supabase';
import { monter, demonter, bouton, champ, cliquer, saisir, texteEcran, jusqua } from './banc-composants';
import EmailPreviewEditor from '../../../src/components/automations/EmailPreviewEditor';

type Action = { type: string; config: Record<string, unknown> };
type Regle = { id: string; actions: Action[]; steps: unknown[] | null };

const ENVELOPPE = '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">';
const P = (t: string) => `<p style="color:#333;line-height:1.6;">${t}</p>`;
const H2 = (t: string) => `<h2 style="color:#1a1a1a;font-size:18px;">${t}</h2>`;
const OBJET = 'Votre rendez-vous du [appointment_date]';
const CORPS = `${ENVELOPPE}${H2('Votre rendez-vous approche')}${P('Bonjour [client_first_name],')}${P('Merci, [company_name]')}</div>`;

function poser(actions: Action[], plus: Record<string, unknown> = {}): void {
  remettre({
    automation_rules: [{ id: 'r1', org_id: 'org-1', actions, steps: null, deleted_at: null, ...plus }],
    company_settings: [{ id: 'cs1', org_id: 'org-1', company_name: 'Nettoyage Test A', default_language: 'fr' }],
  });
}
const enBase = () => ligne<Regle>('automation_rules', 'r1');

/** Ouvre l'éditeur sur un courriel de la règle, comme « Modifier » dans la liste (qui passe le corps et l'objet français). */
async function ouvrir(config: Record<string, unknown>, props: Partial<React.ComponentProps<typeof EmailPreviewEditor>> = {}) {
  await monter(
    <EmailPreviewEditor
      ruleId="r1" ruleName="Rappel de rendez-vous" fr
      body={String(config.body ?? '')} subject={String(config.subject ?? '')}
      onClose={() => {}} onSaved={() => {}} declencheur="appointment.created"
      {...props}
    />,
  );
}
const objet = () => champ<HTMLInputElement>('Objet du courriel');

beforeEach(() => {
  localStorage.setItem('lume-language', 'fr');
  toasts.succes.length = 0; toasts.erreurs.length = 0;
  apercu.appels.length = 0; apercu.essais.length = 0;
  confirmerMock.mockClear();
});
afterEach(async () => { await demonter(); });

describe('04-courriel:816 — modifier un courriel ne touche pas à l’autre courriel de la même automatisation', () => {
  it('changer l’objet du premier : le second garde son objet ET son corps', async () => {
    const c1 = { subject: OBJET, body: CORPS };
    const c2 = { subject: 'Second objet', body: `${ENVELOPPE}${H2('Second courriel')}${P('Texte du second.')}</div>` };
    poser([{ type: 'send_email', config: c1 }, { type: 'send_email', config: c2 }]);
    await ouvrir(c1);
    await saisir(objet(), 'Premier objet corrigé');
    await cliquer(bouton('Enregistrer'));
    await jusqua(() => toasts.succes.includes('Courriel enregistré'));
    expect(enBase().actions[0].config.subject).toBe('Premier objet corrigé');
    expect(enBase().actions[1].config).toEqual(c2);
  });

  it('ouvert sur le SECOND : c’est lui qui change, pas le premier', async () => {
    const c1 = { subject: OBJET, body: CORPS };
    const c2 = { subject: 'Second objet', body: `${ENVELOPPE}${H2('Second courriel')}${P('Texte du second.')}</div>` };
    poser([{ type: 'send_email', config: c1 }, { type: 'send_email', config: c2 }]);
    await ouvrir(c2);
    await saisir(objet(), 'Second objet corrigé');
    await cliquer(bouton('Enregistrer'));
    await jusqua(() => toasts.succes.includes('Courriel enregistré'));
    expect(enBase().actions[0].config).toEqual(c1);
    expect(enBase().actions[1].config.subject).toBe('Second objet corrigé');
  });

  it('deux enregistrements de suite sans que la liste ait rechargé : le second vise toujours le même courriel', async () => {
    const c1 = { subject: OBJET, body: CORPS };
    const c2 = { subject: 'Second objet', body: `${ENVELOPPE}${H2('Second courriel')}</div>` };
    poser([{ type: 'send_email', config: c1 }, { type: 'send_email', config: c2 }]);
    await ouvrir(c1);
    await saisir(objet(), 'Objet, première correction');
    await cliquer(bouton('Enregistrer'));
    await jusqua(() => toasts.succes.length === 1);
    await saisir(objet(), 'Objet, seconde correction');
    await cliquer(bouton('Enregistrer'));
    await jusqua(() => toasts.succes.length === 2);
    expect(toasts.erreurs).toEqual([]);
    expect(enBase().actions[0].config.subject).toBe('Objet, seconde correction');
    expect(enBase().actions[1].config).toEqual(c2);
  });
});

describe('04-courriel:260 — après « Enregistrer », l’éditeur dit que c’est enregistré', () => {
  it('la fenêtre affiche « Aucune modification » et « Enregistrer » se grise, sans attendre le rechargement de la liste', async () => {
    const c1 = { subject: OBJET, body: CORPS };
    poser([{ type: 'send_email', config: c1 }]);
    const fermetures: number[] = [];
    await ouvrir(c1, { onClose: () => { fermetures.push(1); } });
    await saisir(objet(), 'Nouvel objet');
    expect(texteEcran()).toContain('Modifications non enregistrées');
    await cliquer(bouton('Enregistrer'));
    await jusqua(() => toasts.succes.includes('Courriel enregistré'));
    expect(enBase().actions[0].config.subject).toBe('Nouvel objet');
    // Personne n'a cliqué « Fermer » : l'éditeur ne se ferme pas de lui-même.
    expect(fermetures).toEqual([]);
    expect(texteEcran()).toContain('Aucune modification');
    expect(bouton('Enregistrer').disabled).toBe(true);
  });
});
