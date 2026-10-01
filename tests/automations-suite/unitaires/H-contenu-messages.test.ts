/**
 * H / A — Contenu des messages : fonctions pures.
 *
 *  · [H-020] `variablesPourMachine` : le webhook garde ses dates en AAAA-MM-JJ.
 *
 * Aucune base, aucun réseau.
 */
import { describe, it, expect } from 'vitest';
import { variablesPourMachine, DATES_TECHNIQUES } from '../../../server/lib/actions/index';

describe('H-020 — dates : lisibles pour le client, techniques pour une machine', () => {
  it('[H-020] variablesPourMachine remet AAAA-MM-JJ sous le nom d’origine et retire les clés `_iso`', () => {
    const vars = {
      client_name: 'Marie Tremblay',
      invoice_due_date: '15 octobre 2026', invoice_due_date_iso: '2026-10-15',
      quote_valid_until: '1 novembre 2026', quote_valid_until_iso: '2026-11-01',
      appointment_date: 'October 15, 2026', appointment_date_iso: '2026-10-15',
    };
    expect(variablesPourMachine(vars)).toEqual({
      client_name: 'Marie Tremblay', invoice_due_date: '2026-10-15', quote_valid_until: '2026-11-01', appointment_date: '2026-10-15',
    });
    // L'objet d'origine n'est pas modifié : les messages suivants gardent la date lisible.
    expect(vars.invoice_due_date).toBe('15 octobre 2026');
  });

  it('[H-020] sans forme technique (autre entité), les variables passent telles quelles', () => {
    expect(variablesPourMachine({ client_name: 'Marie', job_name: 'Vitres' })).toEqual({ client_name: 'Marie', job_name: 'Vitres' });
    expect([...DATES_TECHNIQUES]).toEqual(['invoice_due_date', 'quote_valid_until', 'appointment_date']);
  });
});
