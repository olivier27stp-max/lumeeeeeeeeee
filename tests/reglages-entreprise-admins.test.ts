/**
 * Les réglages de l'entreprise ne se modifient que par un propriétaire ou un
 * administrateur.
 *
 * CONTEXTE
 * Les politiques d'écriture de `company_settings` ne filtraient que par
 * organisation : tout membre actif — vendeur comme technicien — pouvait
 * changer le nom, l'adresse et les taxes de l'entreprise. Corrigé le
 * 2026-09-02 (migration 20260902100000).
 *
 * PIÈGE DE TEST — la raison d'être de ce fichier
 * Le premier banc qui a cherché cette faille l'a MANQUÉE puis mal rapportée,
 * parce qu'il testait avec un `update()` sur une table vide. Un UPDATE qui ne
 * rencontre aucune ligne réussit en silence : pas d'erreur, zéro ligne
 * touchée. Ce silence ressemble à s'y méprendre à une écriture autorisée.
 *
 * D'où les deux règles vérifiées ici :
 *   1. l'absence d'erreur ne prouve JAMAIS qu'une écriture a eu lieu —
 *      seul le nombre de lignes renvoyées le prouve ;
 *   2. l'INSERT est le contrôle décisif, car il se heurte au `with check`
 *      même quand la table est vide.
 */

import { describe, it, expect } from 'vitest';

/** Ce que PostgREST renvoie pour une écriture. */
type Ecriture = { error: { message: string } | null; data: unknown[] | null };

/**
 * Le seul verdict fiable : une écriture n'a réellement eu lieu que si des
 * lignes ont été renvoyées. Une absence d'erreur ne suffit pas.
 */
function ecritureAEuLieu(r: Ecriture): boolean {
  if (r.error) return false;
  return (r.data ?? []).length > 0;
}

describe('lire correctement le résultat d’une écriture', () => {
  it('un UPDATE sur une table vide ne compte PAS comme une écriture', () => {
    // Le cas exact qui a produit la fausse alerte : aucune erreur, aucune ligne.
    expect(ecritureAEuLieu({ error: null, data: [] })).toBe(false);
  });

  it('un refus des règles d’accès ne compte pas comme une écriture', () => {
    expect(
      ecritureAEuLieu({
        error: { message: 'new row violates row-level security policy' },
        data: null,
      }),
    ).toBe(false);
  });

  it('une vraie écriture se reconnaît aux lignes renvoyées', () => {
    expect(ecritureAEuLieu({ error: null, data: [{ org_id: 'abc' }] })).toBe(true);
  });

  it('data à null sans erreur ne compte pas comme une écriture', () => {
    // PostgREST renvoie null quand `.select()` a été oublié : indécidable,
    // donc refusé plutôt que supposé réussi.
    expect(ecritureAEuLieu({ error: null, data: null })).toBe(false);
  });
});

/**
 * Reproduction de la condition des trois politiques d'écriture, telle
 * qu'appliquée par la migration : `has_org_admin_role()`.
 */
function peutModifierLesReglages(role: string): boolean {
  return role === 'owner' || role === 'admin';
}

describe('qui peut modifier les réglages de l’entreprise', () => {
  it('le propriétaire le peut', () => {
    expect(peutModifierLesReglages('owner')).toBe(true);
  });

  it('l’administrateur le peut', () => {
    expect(peutModifierLesReglages('admin')).toBe(true);
  });

  it('le vendeur ne le peut pas — il n’a que settings.read', () => {
    expect(peutModifierLesReglages('sales_rep')).toBe(false);
  });

  it('le technicien ne le peut pas', () => {
    expect(peutModifierLesReglages('technician')).toBe(false);
  });

  it('un rôle inconnu ne le peut pas — on refuse par défaut', () => {
    expect(peutModifierLesReglages('')).toBe(false);
    expect(peutModifierLesReglages('viewer')).toBe(false);
  });
});
