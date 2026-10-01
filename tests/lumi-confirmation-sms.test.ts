/**
 * Confirmation par texto et reçus honnêtes (audit des outils de Lumi, 2026-09-30).
 * Le « oui » expire, appartient au membre qui l'a reçu, s'utilise une fois et
 * exécute toute la carte ; le texto montre ce que le serveur exécutera ; le
 * reçu ne dit « C'est fait » que si c'est vraiment fait.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifierProposition, ecrituresDe, EXPIRATION_CONFIRMATION_MIN } from '../server/lib/sms/confirmation';
import { apercuEnTexte } from '../server/lib/sms/lumi-sms';
import { texteRecus, lireContenuEcriture } from '../server/lib/lumi/recus';

const membre = { userId: 'u1', orgId: 'o1' };
const p = { tool: 'refund_payment', args: { payment_id: 'x' }, tool_use_id: 't1', user_id: 'u1', org_id: 'o1' };
const t0 = Date.parse('2026-09-30T12:00:00Z');

describe('verifierProposition', () => {
  it('un « oui » dans le délai, du bon membre : accepté', () => {
    expect(verifierProposition(p, '2026-09-30T11:50:00Z', membre, t0)).toEqual({ ok: true });
  });
  it(`après ${EXPIRATION_CONFIRMATION_MIN} min : expirée`, () => {
    expect(verifierProposition(p, '2026-09-30T11:44:00Z', membre, t0)).toEqual({ ok: false, raison: 'expiree' });
    expect(verifierProposition(p, null, membre, t0)).toEqual({ ok: false, raison: 'expiree' });
  });
  it('un autre membre, une autre entreprise ou une vieille proposition sans membre : refusée', () => {
    expect(verifierProposition(p, '2026-09-30T11:59:00Z', { userId: 'u2', orgId: 'o1' }, t0)).toMatchObject({ ok: false, raison: 'autre_membre' });
    expect(verifierProposition(p, '2026-09-30T11:59:00Z', { userId: 'u1', orgId: 'o2' }, t0)).toMatchObject({ ok: false, raison: 'autre_membre' });
    const { user_id: _u, ...sansMembre } = p;
    expect(verifierProposition(sansMembre, '2026-09-30T11:59:00Z', membre, t0)).toMatchObject({ ok: false });
  });
});

describe('ecrituresDe', () => {
  it('toute la carte, dans l’ordre (avant : la première seulement)', () => {
    const groupe = [
      { tool: 'create_job', args: {}, tool_use_id: 'a' },
      { tool: 'send_sms', args: {}, tool_use_id: 'b' },
    ];
    expect(ecrituresDe({ ...p, groupe }).map((e) => e.tool_use_id)).toEqual(['a', 'b']);
    expect(ecrituresDe(p).map((e) => e.tool)).toEqual(['refund_payment']);
  });
});

describe('apercuEnTexte : le texto dit ce que le serveur exécutera', () => {
  it('nomme la cible et les drapeaux', () => {
    const r = apercuEnTexte({
      genre: 'action',
      cibles: [{ libelle: { fr: 'Paiement', en: 'Payment' }, valeur: '120,00 $ · facture #42 · Marie Tremblay' }],
      details: [{ libelle: { fr: 'Montant', en: 'Amount' }, valeur: '50,00 $' }],
      drapeaux: { irreversible: true, vers_client: false, jamais_d_office: true },
    }, 'fr');
    expect(r.bloque).toBe(false);
    expect(r.texte).toContain('Paiement : 120,00 $ · facture #42 · Marie Tremblay');
    expect(r.texte).toContain('Montant : 50,00 $');
    expect(r.texte).toContain('Irréversible.');
  });
  it('une cible introuvable bloque la proposition', () => {
    const r = apercuEnTexte({ genre: 'action', cibles: [{ libelle: { fr: 'Client', en: 'Client' }, valeur: 'introuvable', alerte: true }], details: [] }, 'fr');
    expect(r.bloque).toBe(true);
  });
  it('un texto sans destinataire bloque ; avec destinataire, le texte exact est montré', () => {
    expect(apercuEnTexte({ genre: 'sms', to: null, subject: null, body: 'Salut' }, 'fr').bloque).toBe(true);
    const r = apercuEnTexte({ genre: 'sms', to: '+15145550000', subject: null, body: 'On passe demain 9 h' }, 'fr');
    expect(r.texte).toContain('+15145550000');
    expect(r.texte).toContain('On passe demain 9 h');
  });
  it('facture : total taxes incluses calculé par le serveur', () => {
    const r = apercuEnTexte({ genre: 'invoice', client: { name: 'Marie', company: null, email: null, phone: null, address: null }, title: 'Lavage', lignes: [], subtotal_cents: 10000, taxes: [], total_cents: 11498, valid_days: null, notes: null }, 'fr');
    expect(r.texte).toContain('114,98');
  });
});

describe('le fil texto consomme la proposition avant d’exécuter', () => {
  const src = readFileSync(resolve(__dirname, '..', 'server', 'lib', 'sms', 'fil-lumi.ts'), 'utf8');
  it('vérifie, consomme (écriture conditionnelle), puis exécute', () => {
    const verif = src.indexOf('verifierProposition(enAttente.proposition');
    const conso = src.indexOf('if (!(await consommer(admin, enAttente)))');
    const exec = src.indexOf('executerEcriture({', conso);
    expect(verif).toBeGreaterThan(0);
    expect(conso).toBeGreaterThan(verif);
    expect(exec).toBeGreaterThan(conso);
    expect(src).toContain(".eq('message_text', m.texte)");
  });
});

describe('reçus honnêtes', () => {
  const ok = { tool_use_id: 't', ok: true, fiche: null };
  it('incertain : jamais « C’est fait »', () => {
    const t = texteRecus([{ recu: ok, erreur: null, outil: 'send_invoice', resultat: { incertain: true, note: 'Il a peut-être été envoyé.' } }], 'confirm', true);
    expect(t).not.toContain("C'est fait");
    expect(t).toContain('peut-être');
  });
  it('fait à moitié, déjà fait, avertissement', () => {
    expect(texteRecus([{ recu: ok, erreur: null, outil: 'refund_payment', resultat: { incomplet: true, note: 'Vérifie la facture.' } }], 'confirm', true)).toMatch(/^Fait en partie seulement.*Vérifie la facture\./);
    expect(texteRecus([{ recu: ok, erreur: null, outil: 'mark_invoice_paid', resultat: { deja_fait: true } }], 'confirm', true)).toMatch(/^C'était déjà fait/);
    expect(texteRecus([{ recu: ok, erreur: null, outil: 'add_visit', resultat: { warning: '2 visite(s) se chevauchent.' } }], 'confirm', true)).toContain('Attention : 2 visite(s) se chevauchent.');
  });
  it('lireContenuEcriture lit l’erreur et le résultat', () => {
    expect(lireContenuEcriture(JSON.stringify({ error: 'Non.' }))).toEqual({ erreur: 'Non.', resultat: null });
    expect(lireContenuEcriture(JSON.stringify({ executed: true, result: { deja_fait: true } }))).toEqual({ erreur: null, resultat: { deja_fait: true } });
    expect(lireContenuEcriture('pas du json')).toEqual({ erreur: null, resultat: null });
  });
});
