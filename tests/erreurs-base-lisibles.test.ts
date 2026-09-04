/**
 * UN REFUS DE LA BASE DOIT SE LIRE SANS DICTIONNAIRE.
 *
 * Les bornes de longueur (migration 20260904170000) font refuser une
 * écriture par Postgres avec un message du genre :
 *
 *     new row for relation "clients" violates check constraint "clients_notes_len"
 *
 * Les pages affichent `err.message` dans un toast. Sans traduction, c'est
 * ça que verrait le client. Ces tests figent le traducteur : il reconnaît
 * ce cas précis, et laisse tout le reste intact.
 */

import { describe, it, expect } from 'vitest';
import { erreurLisible } from '../src/lib/erreursBase';

const refus = (contrainte: string) => ({
  code: '23514',
  message: `new row for relation "x" violates check constraint "${contrainte}"`,
});

describe('un refus de longueur devient une phrase', () => {
  it('nomme le champ en français', () => {
    const e = erreurLisible(refus('clients_first_name_len')) as Error;
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('Le prénom est trop long.');
  });

  it('reconnaît la colonne même quand la table contient des tirets bas', () => {
    // team_members_first_name_len : couper au premier « _ » donnerait
    // « members_first_name », inconnu.
    const e = erreurLisible(refus('team_members_first_name_len')) as Error;
    expect(e.message).toBe('Le prénom est trop long.');
    const f = erreurLisible(refus('company_settings_company_name_len')) as Error;
    expect(f.message).toBe("Le nom d'entreprise est trop long.");
  });

  it('préfère le libellé le plus précis', () => {
    // `billing_address` se termine aussi par `address` : c'est le plus
    // long qui doit gagner.
    const e = erreurLisible(refus('clients_billing_address_len')) as Error;
    expect(e.message).toBe("L'adresse de facturation est trop long.");
    const f = erreurLisible(refus('invoices_internal_notes_len')) as Error;
    expect(f.message).toBe('La note interne est trop long.');
  });

  it('a un repli quand la colonne n a pas de libellé', () => {
    const e = erreurLisible(refus('clients_place_id_len')) as Error;
    expect(e.message).toBe('Un des champs est trop long.');
  });
});

describe('tout le reste passe sans être touché', () => {
  it('une autre contrainte CHECK repart telle quelle', () => {
    // Le statut a sa propre contrainte : ce n'est pas un problème de longueur.
    const orig = refus('clients_status_check');
    expect(erreurLisible(orig)).toBe(orig);
  });

  it('un autre code d erreur repart tel quel', () => {
    const orig = { code: '23505', message: 'duplicate key value violates unique constraint "clients_email_len"' };
    expect(erreurLisible(orig)).toBe(orig);
  });

  it('null et undefined ne plantent pas', () => {
    expect(erreurLisible(null)).toBeNull();
    expect(erreurLisible(undefined)).toBeUndefined();
  });

  it('une Error ordinaire repart telle quelle', () => {
    const orig = new Error('réseau');
    expect(erreurLisible(orig)).toBe(orig);
  });
});
