// @vitest-environment jsdom
/**
 * Les textes du catalogue des automatisations — lot 2 de l'audit du 2026-10-01.
 *
 * Tous ces textes sont affichés tels quels à l'utilisateur (tiroirs, panneaux,
 * cartes). On les vérifie dans le catalogue ET rendus par le vrai composant.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../src/hooks/useModuleAccess', () => ({ useModuleAccess: () => ({ isEnabled: false, loading: false }) }));

import ChampActionUI from '../../src/components/automations/ChampAction';
import {
  ACTIONS, DECLENCHEURS, trouverAction, trouverDeclencheur, type ChampAction,
} from '../../src/lib/automationCatalogue';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLDivElement;
let racine: Root | null = null;

/** Les options du menu, telles que l'écran les montre. */
async function optionsAffichees(champ: ChampAction, fr = true): Promise<string[]> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => { racine!.render(<ChampActionUI champ={champ} valeur="" onChange={() => {}} fr={fr} />); });
  const options = Array.from(conteneur.querySelectorAll('select option')).map((o) => o.textContent ?? '');
  await act(async () => racine!.unmount());
  racine = null;
  conteneur.remove();
  return options;
}
const champDeclencheur = (declencheur: string, cle: string) => trouverDeclencheur(declencheur)!.champs!.find((c) => c.cle === cle)!;
const champAction = (action: string, cle: string) => trouverAction(action)!.champs.find((c) => c.cle === cle)!;

afterEach(async () => {
  if (racine) { await act(async () => racine!.unmount()); racine = null; }
  conteneur?.remove();
});

// ─── declencheurs-07 + actions-03 ───────────────────────────────

describe('declencheurs-07 / actions-03 — l’option vide d’un menu dit ce que « vide » veut dire', () => {
  it('« Quand déclencher » (Devis ouvert par le client) : pas « — Inchangé — », rien n’est inchangé sur un déclencheur', async () => {
    expect(await optionsAffichees(champDeclencheur('quote.viewed', 'ouverture'))).toEqual([
      '— Sans réglage (chaque ouverture) —', 'Première ouverture seulement', 'Chaque ouverture',
    ]);
    expect(await optionsAffichees(champDeclencheur('quote.viewed', 'ouverture'), false)).toEqual([
      '— Not set (every open) —', 'First open only', 'Every open',
    ]);
  });

  it('« Quand déclencher » (Facture consultée par le client) : pareil, dans ses mots', async () => {
    expect((await optionsAffichees(champDeclencheur('invoice.viewed', 'ouverture')))[0]).toBe('— Sans réglage (chaque consultation) —');
    expect((await optionsAffichees(champDeclencheur('invoice.viewed', 'ouverture'), false))[0]).toBe('— Not set (every view) —');
  });

  it('« Priorité » d’une tâche à CRÉER : l’option vide annonce la priorité que la tâche aura', async () => {
    // server/lib/actions : une priorité absente devient « medium ».
    expect(await optionsAffichees(champAction('create_task', 'priorite'))).toEqual([
      '— Par défaut (moyenne) —', 'Basse', 'Moyenne', 'Haute',
    ]);
    expect((await optionsAffichees(champAction('create_task', 'priorite'), false))[0]).toBe('— Default (medium) —');
  });

  it('« Pour qui » d’une notification : vide = toute l’équipe', async () => {
    expect((await optionsAffichees(champAction('create_notification', 'destinataire')))[0]).toBe('— Toute l’équipe —');
    expect((await optionsAffichees(champAction('create_notification', 'destinataire'), false))[0]).toBe('— The whole team —');
  });

  it('« Nouveau statut » du rendez-vous (obligatoire) : on invite à choisir', async () => {
    expect((await optionsAffichees(champAction('modifier_statut_rendezvous', 'statut')))[0]).toBe('— Choisir un statut —');
    expect((await optionsAffichees(champAction('modifier_statut_rendezvous', 'statut'), false))[0]).toBe('— Pick a status —');
  });

  it('« Vers » d’un déplacement d’opportunité et « Laquelle » d’un arrêt : le défaut est nommé', async () => {
    expect((await optionsAffichees(champAction('move_deal_stage', 'cible')))[0]).toBe('— Par défaut (une étape précise) —');
    expect((await optionsAffichees(champAction('move_deal_stage', 'cible'), false))[0]).toBe('— Default (a specific stage) —');
    expect((await optionsAffichees(champAction('arreter_automatisation', 'portee')))[0]).toBe('— Par défaut (celle-ci) —');
    expect((await optionsAffichees(champAction('arreter_automatisation', 'portee'), false))[0]).toBe('— Default (this one) —');
  });

  it('« — Inchangé — » reste là où il dit vrai : le statut d’un client qu’on MODIFIE', async () => {
    expect((await optionsAffichees(champAction('modifier_client', 'statut')))[0]).toBe('— Inchangé —');
    expect((await optionsAffichees(champAction('modifier_client', 'statut'), false))[0]).toBe('— Unchanged —');
  });

  it('tout le catalogue : « — Inchangé — » seulement sur un champ FACULTATIF d’une action « Modifier… »', () => {
    const fautifs: string[] = [];
    for (const d of DECLENCHEURS) {
      for (const c of d.champs ?? []) {
        if (c.type === 'choix' && !(c.vide_fr && c.vide_en)) fautifs.push(`déclencheur ${d.cle} › ${c.cle}`);
      }
    }
    for (const a of ACTIONS) {
      for (const c of a.champs) {
        if (c.type !== 'choix') continue;
        const modifieExistant = a.cle.startsWith('modifier_') && !c.obligatoire;
        if (!modifieExistant && !(c.vide_fr && c.vide_en)) fautifs.push(`action ${a.cle} › ${c.cle}`);
      }
    }
    expect(fautifs).toEqual([]);
  });

  it('une option vide a toujours ses DEUX langues', () => {
    const champs = [...DECLENCHEURS.flatMap((d) => d.champs ?? []), ...ACTIONS.flatMap((a) => a.champs)];
    for (const c of champs) expect(Boolean(c.vide_fr), `${c.cle} : vide_fr / vide_en`).toBe(Boolean(c.vide_en));
  });
});
