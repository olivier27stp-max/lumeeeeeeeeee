// @vitest-environment jsdom
/**
 * Agent E — point 8 de la mission : « Insérer un champ » dans l'éditeur d'une étape.
 *
 * Ce que le propriétaire a vu (et que le relevé au vrai navigateur confirme,
 * D:/lume-final/sorties/e/releve-inserer-champ.json) : sous « Insérer un champ »,
 * une ligne repliée « ▸ Champs de base », puis — au même niveau, sans titre — les
 * champs PERSONNALISÉS de l'entreprise (Client · Référé par, Code d'accès, Aucune
 * demande d'avis (noreview)…). L'œil lit ces boutons comme le contenu de « Champs
 * de base ». Les vrais champs de base (90 entrées, les mêmes pour tous les
 * déclencheurs) sont cachés dans la ligne repliée.
 *
 * TÉMOIN = vert aujourd'hui (l'état constaté). Les autres tests sont ROUGES
 * aujourd'hui : ils décrivent la cible de la mission et passeront au vert une fois
 * la palette refaite (voir notes/E-conception.md, « Conception 3 »).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../../src/components/ui/ConfirmDialog', () => ({ confirmer: vi.fn(async () => true), default: () => null }));
vi.mock('../../../../src/hooks/useModuleAccess', () => ({ useModuleAccess: () => ({ isEnabled: false, loading: false }) }));
vi.mock('../../../../src/lib/supabase', () => {
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

import PanneauEtape from '../../../../src/components/automations/PanneauEtape';
import type { Etape } from '../../../../src/lib/sequenceTypes';
import type { ChampPerso, ObjetChamp, TypeChamp } from '../../../../src/lib/champs/types';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** Les champs personnalisés posés d'office dans TOUTE nouvelle entreprise (relevés dans mon bureau local). */
const champ = (objet: ObjetChamp, key: string, label: string, type: TypeChamp): ChampPerso => ({
  id: `id-${objet}-${key}`, object_type: objet, folder_id: null, key, label, placeholder: null, help_text: null,
  field_type: type, config: {}, is_required: false, is_searchable: false, is_unique: false, position: 0,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', archived_at: null, options: [],
});
const CHAMPS_SEMES: ChampPerso[] = [
  champ('client', 'refere_par', 'Référé par', 'single_line'),
  champ('client', 'code_acces', 'Code d\'accès', 'single_line'),
  champ('client', 'courriel_facturation', 'Courriel de facturation', 'email'),
  champ('client', 'instructions_acces', 'Instructions d\'accès', 'multi_line'),
  champ('client', 'noreview', 'Aucune demande d\'avis (noreview)', 'checkbox'),
  champ('job', 'depense_carburant', 'Carburant', 'monetary'),
  champ('job', 'instructions_speciales', 'Instructions spéciales', 'multi_line'),
  champ('job', 'depense_sous_traitance', 'Sous-traitance', 'monetary'),
  champ('job', 'depense_autres', 'Autres dépenses', 'monetary'),
  champ('quote', 'motif_refus', 'Motif de refus', 'dropdown_single'),
];

let conteneur: HTMLDivElement;
let racine: Root | null = null;

async function monter(declencheur: string, type: 'send_sms' | 'send_email' = 'send_sms') {
  const etape: Etape = { id: 'e1', type: 'action', action: { type, config: { body: 'Bonjour,', ...(type === 'send_email' ? { subject: 'Objet' } : {}) } }, suivant: null };
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    racine!.render(
      <QueryClientProvider client={qc}>
        <PanneauEtape
          etape={etape} fr declencheur={declencheur} membres={[]} etiquettes={[]} champsPerso={CHAMPS_SEMES}
          objetChamps={declencheur.startsWith('invoice') ? 'invoice' : declencheur.startsWith('quote') ? 'quote' : 'client'}
          onEnregistrer={() => {}} onSupprimer={() => {}} onFermer={() => {}}
        />
      </QueryClientProvider>,
    );
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

afterEach(async () => {
  if (racine) { await act(async () => racine!.unmount()); racine = null; }
  conteneur?.remove();
});

const texteDe = (n: Element | null | undefined) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim();
/** Le bloc sous le titre « Insérer un champ ». */
function blocInsertion(): HTMLElement {
  const p = [...conteneur.querySelectorAll('p')].find((x) => texteDe(x) === 'Insérer un champ');
  if (!p?.nextElementSibling) throw new Error('bloc « Insérer un champ » introuvable');
  return p.nextElementSibling as HTMLElement;
}
/** Tous les libellés insérables du panneau (boutons d'insertion, repliés ou non). */
function libellesInserables(): string[] {
  const titres = ['Insérer une information du client', 'Insérer un champ'];
  const blocs = [...conteneur.querySelectorAll('p')].filter((x) => titres.includes(texteDe(x))).map((x) => x.nextElementSibling);
  return blocs.flatMap((b) => (b ? [...b.querySelectorAll('button')].map((x) => texteDe(x)) : []));
}
const jetons = () => [...conteneur.querySelectorAll('button[title]')].map((b) => b.getAttribute('title') ?? '');

describe('E — « Insérer un champ » : ce que l’éditeur montre aujourd’hui (témoins)', () => {
  it('[E-30 témoin] sous « Champs de base » replié, les boutons visibles sont les champs PERSONNALISÉS de l’entreprise, sans titre à eux', async () => {
    await monter('invoice.overdue');
    const bloc = blocInsertion();
    const details = bloc.querySelector('details')!;
    expect(texteDe(details.querySelector('summary'))).toBe('Champs de base');
    expect(details.open).toBe(false);
    const visibles = [...bloc.querySelectorAll(':scope > button')].map((b) => texteDe(b));
    expect(visibles).toEqual([
      'Client · Référé par', 'Client · Code d\'accès', 'Client · Courriel de facturation', 'Client · Instructions d\'accès',
      'Client · Aucune demande d\'avis (noreview)', 'Job · Carburant', 'Job · Instructions spéciales', 'Job · Sous-traitance',
      'Job · Autres dépenses', 'Devis · Motif de refus',
    ]);
    // Aucun titre « Champs personnalisés » ne les sépare de la ligne « Champs de base ».
    expect(conteneur.textContent).not.toMatch(/Champs personnalisés/);
  });

  it('[E-31 témoin] la liste est la MÊME pour tous les déclencheurs (90 champs de base, 6 raccourcis)', async () => {
    const releves: string[] = [];
    for (const d of ['invoice.overdue', 'quote.sent', 'appointment.created', 'lead.created']) {
      await monter(d);
      releves.push(libellesInserables().join('|'));
      await act(async () => racine!.unmount()); racine = null; conteneur.remove();
    }
    expect(new Set(releves).size).toBe(1);
    expect(releves[0].split('|').length).toBe(6 + 90 + 10);
  });
});

describe('E — « Insérer un champ » : la cible de la mission (ROUGE aujourd’hui)', () => {
  it('[E-30] les champs personnalisés ont leur propre section, titrée « Champs personnalisés »', async () => {
    await monter('invoice.overdue');
    const titres = [...conteneur.querySelectorAll('summary, h3, h4, p, legend')].map((x) => texteDe(x));
    expect(titres).toContain('Champs personnalisés');
  });

  it('[E-31] « Nouveau prospect » : aucune variable de facture, de devis, de job ni de rendez-vous n’est proposée', async () => {
    await monter('lead.created');
    const hors = libellesInserables().filter((l) => /^(Facture|Devis|Job|Pipeline) ·|Lien facture|Lien du devis|Date du rendez-vous|^Total$/.test(l));
    expect(hors).toEqual([]);
  });

  it('[E-32] « Facture en retard » : numéro, montant, solde dû, échéance, jours de retard et lien de paiement sont proposés en clair', async () => {
    await monter('invoice.overdue');
    const libelles = libellesInserables().join(' | ').toLowerCase();
    for (const attendu of ['numéro', 'montant', 'solde', 'échéance', 'jours de retard', 'lien de paiement']) {
      expect(libelles, `« ${attendu} » absent de la palette`).toContain(attendu);
    }
  });

  it('[E-32] l’entreprise (nom, téléphone, courriel) et le nom complet du client sont proposés', async () => {
    await monter('lead.created');
    const libelles = libellesInserables().join(' | ').toLowerCase();
    for (const attendu of ['prénom', 'nom complet', 'téléphone de l’entreprise', 'courriel de l’entreprise']) {
      expect(libelles, `« ${attendu} » absent de la palette`).toContain(attendu);
    }
  });

  it('[E-33] exclus par défaut : cases à cocher, champs internes et champs sensibles (codes et instructions d’accès)', async () => {
    await monter('invoice.overdue');
    const proposes = jetons();
    const interdits = [
      '{{invoice.internal_notes}}',            // notes INTERNES de la facture, dans un message au client
      '{{client.display_as_company}}',         // case à cocher
      '{{client.billing_same_as_service}}',    // case à cocher
      '{{job.show_on_leaderboard}}',           // case à cocher interne
      '{{client.noreview}}',                   // case à cocher (champ personnalisé)
      '{{client.code_acces}}',                 // sensible
      '{{client.instructions_acces}}',         // sensible
    ];
    expect(proposes.filter((j) => interdits.includes(j))).toEqual([]);
  });

  it('[E-34] une recherche filtre la palette (l’éditeur de courriel de la liste en a une, pas ce panneau)', async () => {
    await monter('invoice.overdue');
    expect(conteneur.querySelector('input[type="search"]')).not.toBeNull();
  });

  it('[E-35] la variable s’insère À L’ENDROIT DU CURSEUR, pas à la fin du texte', async () => {
    await monter('lead.created');
    const zone = conteneur.querySelector('textarea') as HTMLTextAreaElement;
    const poser = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => { poser.call(zone, 'DEBUT FIN'); zone.dispatchEvent(new Event('input', { bubbles: true })); });
    zone.focus();
    zone.setSelectionRange(6, 6);
    const bouton = [...conteneur.querySelectorAll('button')].find((b) => texteDe(b) === 'Nom du client')!;
    await act(async () => { bouton.click(); });
    expect((conteneur.querySelector('textarea') as HTMLTextAreaElement).value).toBe('DEBUT [client_name]FIN');
  });

  it('[E-36] un champ de fiche inexistant ({{client.champ_qui_nexiste_pas}}) est signalé comme inconnu', async () => {
    await monter('lead.created');
    const zone = conteneur.querySelector('textarea') as HTMLTextAreaElement;
    const poser = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => { poser.call(zone, 'Bonjour {{client.champ_qui_nexiste_pas}}'); zone.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(conteneur.querySelector('[role="alert"]')?.textContent ?? '').toContain('champ_qui_nexiste_pas');
  });
});
