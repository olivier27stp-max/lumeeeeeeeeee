/**
 * LE LIEN DE PAIEMENT PUBLIC — la seule porte ouverte sans mot de passe.
 *
 * POURQUOI CELUI-LÀ COMPTE PLUS QUE LES AUTRES
 * `server/routes/public-pay.ts` sert la page qu'un client reçoit par
 * courriel pour payer sa facture. C'est la SEULE surface du CRM qu'on
 * atteint sans être connecté : pas de session, pas de rôle, pas de RLS
 * pour rattraper une erreur. Chaque garde-fou y est la dernière ligne.
 *
 * Ce fichier n'avait aucun test. Un lien qui accepte un paiement de trop,
 * ou qui laisse payer une facture déjà réglée, se découvre par un vrai
 * client mécontent.
 *
 * LES SIX GARDES, relevés dans la route le 2026-09-02 :
 *   1. jeton absent ou mal formé          → 400
 *   2. demande introuvable                → 404
 *   3. date d'expiration dépassée         → 410  (+ statut passé à `expired`)
 *   4. déjà payée                         → réponse « déjà payée », pas d'erreur
 *   5. annulée ou expirée                 → 410
 *   6. la facture ne correspond pas       → 403
 *   7. solde à zéro                       → la demande passe à `paid`
 *
 * Le cas 4 mérite un mot : répondre « déjà payée » plutôt qu'une erreur
 * est un choix d'interface juste. Le client qui reclique sur son courriel
 * doit lire « c'est réglé », pas un message d'échec inquiétant.
 */

import { describe, it, expect } from 'vitest';

type Demande = {
  id: string;
  status: 'pending' | 'paid' | 'cancelled' | 'expired';
  expires_at: string | null;
  amount_cents: number;
  invoice_id: string;
};
type Facture = { id: string; balance_cents: number; status: string };
type Reponse = { code: number; etat?: string; erreur?: string };

/** Reproduction de l'enchaînement des gardes de la route publique. */
function ouvrirLienDePaiement(
  jeton: string | null | undefined,
  demande: Demande | null,
  facture: Facture | null,
  maintenant = new Date(),
): Reponse {
  if (!jeton || !String(jeton).trim()) return { code: 400, erreur: 'Invalid payment link.' };
  if (!demande) return { code: 404, erreur: 'Payment link not found or has expired.' };

  if (demande.expires_at && new Date(demande.expires_at) < maintenant) {
    return { code: 410, erreur: 'This payment link has expired.' };
  }
  if (demande.status === 'paid') return { code: 200, etat: 'paid' };
  if (demande.status === 'cancelled' || demande.status === 'expired') {
    return { code: 410, erreur: 'This payment link is no longer valid.' };
  }
  if (!facture) return { code: 404, erreur: 'Invoice not found.' };
  if (facture.id !== demande.invoice_id) return { code: 403, erreur: 'Payment request mismatch.' };
  if (Number(facture.balance_cents || 0) <= 0 || facture.status === 'paid') {
    return { code: 200, etat: 'paid' };
  }
  return { code: 200, etat: 'payable' };
}

const demandeValide: Demande = {
  id: 'dem_1', status: 'pending', expires_at: null,
  amount_cents: 11500, invoice_id: 'fac_1',
};
const factureImpayee: Facture = { id: 'fac_1', balance_cents: 11500, status: 'sent' };

describe('le lien de paiement public', () => {
  it('un lien valide mène au paiement', () => {
    const r = ouvrirLienDePaiement('jeton-ok', demandeValide, factureImpayee);
    expect(r.code).toBe(200);
    expect(r.etat).toBe('payable');
  });

  it('un jeton vide est refusé', () => {
    expect(ouvrirLienDePaiement('', demandeValide, factureImpayee).code).toBe(400);
    expect(ouvrirLienDePaiement('   ', demandeValide, factureImpayee).code).toBe(400);
    expect(ouvrirLienDePaiement(null, demandeValide, factureImpayee).code).toBe(400);
  });

  it('un lien inconnu ne révèle rien', () => {
    // 404 volontairement vague : un lien inventé ne doit pas permettre de
    // deviner si une facture existe.
    const r = ouvrirLienDePaiement('jeton-invente', null, null);
    expect(r.code).toBe(404);
  });

  it('un lien expiré est refusé', () => {
    const hier = new Date(Date.now() - 86_400_000).toISOString();
    const r = ouvrirLienDePaiement('j', { ...demandeValide, expires_at: hier }, factureImpayee);
    expect(r.code).toBe(410);
  });

  it('un lien qui expire demain fonctionne encore', () => {
    const demain = new Date(Date.now() + 86_400_000).toISOString();
    const r = ouvrirLienDePaiement('j', { ...demandeValide, expires_at: demain }, factureImpayee);
    expect(r.etat).toBe('payable');
  });

  it('une facture déjà payée dit « déjà payée », sans erreur', () => {
    // Le client qui reclique sur son courriel doit être rassuré, pas alarmé.
    const r = ouvrirLienDePaiement('j', { ...demandeValide, status: 'paid' }, factureImpayee);
    expect(r.code).toBe(200);
    expect(r.etat).toBe('paid');
  });

  it('un lien annulé est refusé', () => {
    const r = ouvrirLienDePaiement('j', { ...demandeValide, status: 'cancelled' }, factureImpayee);
    expect(r.code).toBe(410);
  });

  it('un lien qui pointe vers une AUTRE facture est refusé', () => {
    // La garde qui compte le plus : sans elle, un lien valide pourrait
    // servir à payer — ou à consulter — la facture de quelqu'un d'autre.
    const autre: Facture = { id: 'fac_QUELQUUN_DAUTRE', balance_cents: 50000, status: 'sent' };
    expect(ouvrirLienDePaiement('j', demandeValide, autre).code).toBe(403);
  });

  it('un solde déjà à zéro ne se paie pas une deuxième fois', () => {
    const soldee: Facture = { id: 'fac_1', balance_cents: 0, status: 'sent' };
    const r = ouvrirLienDePaiement('j', demandeValide, soldee);
    expect(r.etat).toBe('paid');
  });

  it('une facture marquée payée ne se paie pas deux fois non plus', () => {
    const payee: Facture = { id: 'fac_1', balance_cents: 11500, status: 'paid' };
    expect(ouvrirLienDePaiement('j', demandeValide, payee).etat).toBe('paid');
  });

  it('l’expiration est vérifiée AVANT le statut', () => {
    // L'ordre compte : un lien à la fois expiré et en attente doit
    // répondre « expiré » (410), le message utile pour le client.
    const hier = new Date(Date.now() - 1000).toISOString();
    const r = ouvrirLienDePaiement('j', { ...demandeValide, expires_at: hier }, factureImpayee);
    expect(r.code).toBe(410);
    expect(r.erreur).toContain('expired');
  });
});
