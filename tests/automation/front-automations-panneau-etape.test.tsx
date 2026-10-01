// @vitest-environment jsdom
/**
 * T13 — le panneau d'étape de l'éditeur plein écran, là où s'écrivent
 * toutes les nouvelles automatisations.
 *
 * Deux défauts trouvés en réécrivant T13 (2026-09-30), corrigés le
 * 2026-10-01. Ces tests étaient en quarantaine, rouges ; ils sont en CI.
 *
 * ── D1 · variable inconnue non signalée (régression F22) ────────────────
 * Le serveur remplace une variable qu'il ne connaît pas par du vide
 * (`resolveTemplate`, server/lib/actions) : « Bonjour [prenom], » part en
 * « Bonjour , ». L'avertissement vivait dans `AutomationBuilder.tsx`, que la
 * refonte #523 a cessé de monter : la liste avertissait, plus l'éditeur.
 *
 * Le corriger sans précaution aurait crié au loup : le détecteur prenait
 * les variables pointées du serveur ({{soumission.total}}…) pour des champs
 * personnalisés inconnus — neuf règles de base en prod (mesuré sur les 371
 * règles, lecture seule). D'où les tests de parité plus bas.
 *
 * ── D2 · nombre de SMS facturés absent ───────────────────────────────────
 * Le panneau montrait « 200 / 1600 », la limite de saisie, jamais la
 * facture. Et la liste, qui l'affichait, divisait par 160 : faux dès qu'un
 * « ê » ou un émoji fait passer le texto en tranches de 70.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../src/components/ui/ConfirmDialog', () => ({ confirmer: vi.fn(async () => true), default: () => null }));
vi.mock('../../src/hooks/useModuleAccess', () => ({ useModuleAccess: () => ({ isEnabled: false, loading: false }) }));
vi.mock('../../src/lib/supabase', () => {
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

import PanneauEtape from '../../src/components/automations/PanneauEtape';
import type { Etape } from '../../src/lib/sequenceTypes';
import { VARIABLES_POINTEES_CONNUES, variablesInconnues } from '../../src/lib/emailBodyText';
import { segmentsSms } from '../../src/lib/smsSegments';
import { segmentsSms as segmentsSmsServeur } from '../../server/lib/desabonnement/mention-sms';
import { AUTOMATION_PRESETS } from '../../server/lib/automationPresets.data';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLDivElement;
let racine: Root | null = null;

async function monter(type: string, config: Record<string, string>, fr = true) {
  const etape: Etape = { id: 'e1', type: 'action', action: { type, config }, suivant: null };
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    racine!.render(
      <QueryClientProvider client={qc}>
        <PanneauEtape
          etape={etape} fr={fr} declencheur="appointment.created" membres={[]} etiquettes={[]}
          onEnregistrer={() => {}} onSupprimer={() => {}} onFermer={() => {}}
        />
      </QueryClientProvider>,
    );
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const monterTexto = (corps: string, fr = true) => monter('send_sms', { body: corps }, fr);
const texte = () => conteneur.textContent || '';
const alerte = () => conteneur.querySelector('[role="alert"]')?.textContent ?? null;

afterEach(async () => {
  if (racine) { await act(async () => racine!.unmount()); racine = null; }
  conteneur?.remove();
});

describe('T13 — panneau d’étape : variable inconnue signalée (D1)', () => {
  it('témoin : le panneau monte, avec le texte du message et les variables à insérer', async () => {
    await monterTexto('Bonjour [client_name], à demain.');
    expect((conteneur.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Bonjour [client_name], à demain.');
    expect(texte()).toContain('Insérer une information du client');
    expect(texte()).toContain('Texte du message');
  });

  it('« [prenom] » est NOMMÉE : sinon le client reçoit « Bonjour , à demain. »', async () => {
    await monterTexto('Bonjour [prenom], à demain.');
    expect(alerte()).toBe('Variable inconnue : [prenom] — sera vide dans le message envoyé.');
  });

  it('en anglais aussi', async () => {
    await monterTexto('Hi [firstname] [lastname]', false);
    expect(alerte()).toBe('Unknown variables: [firstname], [lastname] — will be empty in the sent message.');
  });

  it('la syntaxe à accolades {prenom} est vue de la même façon', async () => {
    await monterTexto('Bonjour {prenom}');
    expect(alerte()).toContain('[prenom]');
  });

  it('une variable connue écrite à la main : aucun avertissement', async () => {
    await monterTexto('Bonjour [client_first_name], facture [invoice_link], avis {review_link}.');
    expect(alerte()).toBeNull();
  });

  it('les variables pointées du serveur ({{soumission.total}}…) ne sont PAS de fausses alertes', async () => {
    await monterTexto('Devis {{soumission.numero}} de {{soumission.total}}, vu {{soumission.nb_vues}} fois. {{facture.lien}} {{paiement.montant}} {{client.lien_reservation}}');
    expect(alerte()).toBeNull();
  });

  it('un champ de la fiche ({{client.superficie}}, {{job.salesperson}}) n’est pas signalé', async () => {
    await monterTexto('Superficie : {{client.superficie}} — vendeur {{job.salesperson}}');
    expect(alerte()).toBeNull();
  });

  it('une faute dans l’objet ({{soumision.total}}) est signalée, écrite comme l’utilisateur l’a tapée', async () => {
    await monterTexto('Total : {{soumision.total}}');
    expect(alerte()).toBe('Variable inconnue : {{soumision.total}} — sera vide dans le message envoyé.');
  });

  it('courriel : une variable inconnue dans l’OBJET est signalée aussi', async () => {
    await monter('send_email', { subject: 'Votre devis [numero_devis]', body: 'Bonjour [client_first_name]' });
    expect(alerte()).toBe('Variable inconnue : [numero_devis] — sera vide dans le message envoyé.');
  });

  it('tâche : « [URGENT] Rappeler » — le serveur viderait le crochet, on le dit', async () => {
    await monter('create_task', { title: '[URGENT] Rappeler le client' });
    expect(alerte()).toContain('[URGENT]');
  });
});

describe('T13 — panneau d’étape : nombre de SMS facturés (D2)', () => {
  it('200 caractères simples : « 200 / 1600 · 2 SMS »', async () => {
    await monterTexto('x'.repeat(200));
    expect(texte()).toMatch(/200 \/ 1600 · 2 SMS/);
  });

  it('un seul SMS : rien de plus que le compteur', async () => {
    await monterTexto('x'.repeat(160));
    expect(texte()).toContain('160 / 1600');
    expect(texte()).not.toMatch(/\d SMS/);
  });

  it('un « ê » suffit : 100 caractères partent en 2 SMS, et l’écran dit pourquoi', async () => {
    await monterTexto(`Votre fenêtre est prête. ${'x'.repeat(75)}`);
    expect(texte()).toMatch(/100 \/ 1600 · 2 SMS \(accent spécial ou émoji : 67 caractères par SMS\)/);
  });

  it('un courriel n’affiche jamais de compte de SMS', async () => {
    await monter('send_email', { subject: 'Bonjour', body: 'x'.repeat(400) });
    expect(texte()).not.toMatch(/\d SMS/);
  });
});

describe('parité avec le serveur — ce qui évite les fausses alertes', () => {
  const racineDepot = resolve(__dirname, '..', '..');

  it('toute variable pointée que le serveur pose (`vars[\'objet.cle\']`) est connue de l’éditeur', () => {
    const source = readFileSync(resolve(racineDepot, 'server/lib/actions/index.ts'), 'utf8');
    const posees = new Set([
      ...[...source.matchAll(/vars\['([a-z]+\.[a-z_]+)'\]\s*=/g)].map((m) => m[1]),
      ...[...source.matchAll(/'([a-z]+\.[a-z_]+)': lien/g)].map((m) => m[1]),
    ]);
    expect(posees.size).toBeGreaterThanOrEqual(17);
    expect([...posees].filter((v) => !VARIABLES_POINTEES_CONNUES.includes(v))).toEqual([]);
  });

  it('aucun préréglage livré ne déclenche l’avertissement', () => {
    const textes = (v: unknown, out: string[] = []): string[] => {
      if (typeof v === 'string') out.push(v);
      else if (Array.isArray(v)) v.forEach((x) => textes(x, out));
      else if (v && typeof v === 'object') Object.values(v).forEach((x) => textes(x, out));
      return out;
    };
    const fautes = AUTOMATION_PRESETS.flatMap((p) => {
      const inconnues = [...new Set(textes(p).flatMap((t) => variablesInconnues(t)))];
      return inconnues.length ? [`${(p as { key?: string }).key ?? '?'} → ${inconnues.join(', ')}`] : [];
    });
    expect(fautes).toEqual([]);
  });

  it('le compte de SMS du navigateur est celui du serveur', () => {
    const cas = [
      '', 'Bonjour', 'x'.repeat(160), 'x'.repeat(161), 'x'.repeat(306), 'x'.repeat(307),
      'é'.repeat(161), 'ê', 'ê'.repeat(70), 'ê'.repeat(71), 'ç'.repeat(135), '€'.repeat(80), '€'.repeat(81),
      'Bonjour, à bientôt 😀', `[client_first_name] {x} ~ ${'a'.repeat(150)}`, 'L’équipe vous attend',
    ];
    for (const c of cas) expect(segmentsSms(c), JSON.stringify(c.slice(0, 20))).toEqual(segmentsSmsServeur(c));
    expect(segmentsSms('x'.repeat(307)).segments).toBe(3);   // 160 annonçait 2
    expect(segmentsSms('ê'.repeat(71)).segments).toBe(2);    // 160 annonçait 1
  });
});
