// @vitest-environment jsdom
//
// La carte de Lumi, rendue pour de vrai : le titre dit l'action.
// Avant : « Lumi veut la paie » pour marquer une paie payée ET pour annuler ce paiement.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CarteAutorisation } from '../src/components/lumi/CarteAutorisation';
import type { PropositionLumi } from '../src/lib/lumiApi';

vi.mock('../src/lib/invoicesApi', () => ({ getCompanySettings: async () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let hote: HTMLDivElement | null = null;
afterEach(() => {
  act(() => racine?.unmount());
  hote?.remove();
  racine = null; hote = null;
});

function titre(p: Partial<PropositionLumi> & { tool: string }, fr = true): string {
  const proposition: PropositionLumi = { tool_use_id: 't1', args: {}, capacite: 'la paie', statut: 'en_attente', apercu: null, ...p };
  hote = document.createElement('div');
  document.body.appendChild(hote);
  racine = createRoot(hote);
  act(() => {
    racine!.render(
      <MemoryRouter>
        <CarteAutorisation proposition={proposition} fr={fr} busy={false} onDecision={() => {}} autorise={false} onAutoriser={() => {}} />
      </MemoryRouter>,
    );
  });
  const texte = hote.textContent ?? '';
  act(() => racine?.unmount());
  hote.remove();
  racine = null; hote = null;
  return texte;
}

describe('titre de la carte de Lumi (rendu réel)', () => {
  it('deux actions contraires de la paie n’ont plus le même titre', () => {
    const payee = titre({ tool: 'mark_payroll_period_paid' });
    const annulee = titre({ tool: 'unmark_payroll_period_paid' });
    expect(payee).toContain('Lumi veut marquer une paie payée');
    expect(annulee).toContain('Lumi veut annuler le paiement d’une paie');
    expect(payee).not.toContain('Lumi veut la paie');
  });

  it('retirer la carte au dossier se lit sur la carte', () => {
    expect(titre({ tool: 'remove_card_on_file', capacite: 'la modification des clients (carte au dossier)' })).toContain('Lumi veut retirer la carte au dossier');
  });

  it('le titre suit l’argument : désarchiver, mettre en pause, rembourser au complet', () => {
    expect(titre({ tool: 'archive_job', args: { restore: true } })).toContain('Lumi veut désarchiver un job');
    expect(titre({ tool: 'toggle_automation_rule', args: { is_active: false } })).toContain('Lumi veut mettre une automatisation en pause');
    expect(titre({ tool: 'refund_payment', args: { payment_id: 'ref1' } })).toContain('Lumi veut rembourser un paiement au complet');
  });

  it('en anglais aussi', () => {
    expect(titre({ tool: 'send_quote_sms' }, false)).toContain('Lumi wants to text a quote');
    expect(titre({ tool: 'delete_team' }, false)).toContain('Lumi wants to delete a team');
  });

  it('un outil déjà connu garde son titre', () => {
    expect(titre({ tool: 'create_task', args: { title: 'Commander du savon' } })).toContain('Lumi veut créer une tâche');
  });
});
