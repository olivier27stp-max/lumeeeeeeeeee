// @vitest-environment jsdom
/**
 * Agent P — la palette « Insérer un champ » (src/components/automations/PaletteChamps.tsx).
 * Le VRAI composant, monté à côté de vrais champs de texte CONTRÔLÉS (comme ceux du
 * panneau d'étape), piloté comme un utilisateur.
 *
 *   npx vitest run --maxWorkers=2 tests/automations-finale/p/palette-champs.test.tsx
 *
 * Les cibles des tests [E-30] à [E-35] de l'agent E (qui montent `PanneauEtape`, donc
 * attendent la phase 2) sont éprouvées ici sur la palette seule.
 */
import { describe, it, expect, afterEach } from 'vitest';
import React, { act, useRef, useState } from 'react';
import PaletteChamps, { insererAuCurseur, remplacementPropre } from '../../../src/components/automations/PaletteChamps';
import type { ChampPerso, ObjetChamp, TypeChamp } from '../../../src/lib/champs/types';
import { monter, demonter, cliquer, saisir, bouton, boutonPresent, boutons, champ as champNomme } from '../t/banc-composants';

const champ = (objet: ObjetChamp, key: string, label: string, type: TypeChamp, config: Record<string, unknown> = {}): ChampPerso => ({
  id: `id-${objet}-${key}`, object_type: objet, folder_id: null, key, label, placeholder: null, help_text: null, field_type: type, config,
  is_required: false, is_searchable: false, is_unique: false, position: 0, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
  archived_at: null, options: [],
});
/** Les champs posés d'office dans toute nouvelle entreprise — ceux que le propriétaire a vus sous « Champs de base ». */
const CHAMPS_SEMES: ChampPerso[] = [
  champ('client', 'refere_par', 'Référé par', 'single_line'),
  champ('client', 'code_acces', 'Code d’accès', 'single_line'),
  champ('client', 'courriel_facturation', 'Courriel de facturation', 'email'),
  champ('client', 'instructions_acces', 'Instructions d’accès', 'multi_line'),
  champ('client', 'noreview', 'Aucune demande d’avis (noreview)', 'checkbox'),
  champ('job', 'depense_carburant', 'Carburant', 'monetary'),
  champ('job', 'instructions_speciales', 'Instructions spéciales', 'multi_line'),
  champ('job', 'depense_sous_traitance', 'Sous-traitance', 'monetary'),
  champ('job', 'depense_autres', 'Autres dépenses', 'monetary'),
  champ('quote', 'motif_refus', 'Motif de refus', 'dropdown_single'),
];

/** Un panneau comme celui d'une étape de courriel : objet, message — tous deux CONTRÔLÉS — et la palette. */
function Panneau(props: { declencheur: string; fr?: boolean; objetMax?: number; onInserer?: (e: string) => void; sansRemplacement?: boolean }) {
  const [objet, setObjet] = useState('');
  const [message, setMessage] = useState('');
  const portee = useRef<HTMLDivElement>(null);
  return (
    <div>
      <div ref={portee}>
        <input type="text" aria-label="Objet" value={objet} maxLength={props.objetMax} onChange={(e) => setObjet(e.target.value)} />
        <textarea aria-label="Message" value={message} onChange={(e) => setMessage(e.target.value)} />
        <PaletteChamps
          declencheur={props.declencheur} fr={props.fr ?? true} champsPerso={CHAMPS_SEMES} portee={portee}
          onInserer={props.onInserer} avecRemplacement={!props.sansRemplacement}
        />
      </div>
      <textarea aria-label="Hors du panneau" defaultValue="" />
    </div>
  );
}

afterEach(async () => { await demonter(); });

const message = () => champNomme<HTMLTextAreaElement>('Message');
const objet = () => champNomme<HTMLInputElement>('Objet');
const titres = () => Array.from(document.querySelectorAll('h4, summary')).map((x) => (x.textContent ?? '').trim());
const offerts = () => boutons().filter((b) => b.hasAttribute('title')).map((b) => (b.textContent ?? '').trim());
const jetons = () => boutons().filter((b) => b.hasAttribute('title')).map((b) => b.getAttribute('title'));
/** Place le curseur comme un utilisateur : le champ reçoit le curseur, puis la sélection. */
async function curseur(el: HTMLInputElement | HTMLTextAreaElement, debut: number, fin = debut) {
  await act(async () => { el.focus(); el.setSelectionRange(debut, fin); });
}
const recherche = () => document.querySelector<HTMLInputElement>('input[type="search"]')!;

describe('P — palette : ce qu’elle montre', () => {
  it('[cible de E-30] « Champs de base » visibles d’emblée, puis « Champs personnalisés » dans LEUR section titrée', async () => {
    await monter(<Panneau declencheur="invoice.overdue" />);
    expect(titres()).toEqual(['Champs de base', 'Plus de champs', 'Champs personnalisés']);
    const perso = document.querySelector('section[aria-labelledby$="-perso"]')!;
    expect(Array.from(perso.querySelectorAll('button')).map((b) => b.textContent)).toEqual([
      'Client · Référé par', 'Client · Courriel de facturation', 'Job · Carburant', 'Job · Sous-traitance', 'Job · Autres dépenses',
    ]);
    const base = document.querySelector('section[aria-labelledby$="-base"]')!;
    expect(Array.from(base.querySelectorAll('button')).map((b) => b.textContent)).toEqual([
      'Prénom du client', 'Nom de famille du client', 'Nom complet du client', 'Nom de l’entreprise', 'Téléphone de l’entreprise',
      'Numéro de facture', 'Montant de la facture', 'Date d’échéance', 'Lien de paiement',
    ]);
    // « Plus de champs » est replié : les champs de base, eux, ne sont cachés derrière rien.
    expect(document.querySelector('details')?.open).toBe(false);
    expect(base.closest('details')).toBeNull();
  });

  it('[cible de E-31] la liste suit le déclencheur : « Nouveau prospect » n’offre rien d’une facture, d’un devis, d’un job ni du pipeline', async () => {
    await monter(<Panneau declencheur="lead.created" />);
    // Deux champs du CLIENT portent le mot « facturation » (son adresse et son courriel de facturation) : ils restent.
    expect(offerts().filter((l) => /factur|devis|rendez-vous|job|pipeline|opportunité/i.test(l))).toEqual(['Adresse de facturation', 'Client · Courriel de facturation']);
    expect(jetons().filter((j) => /invoice|quote|appointment|\{\{(job|deal)\./.test(String(j)))).toEqual([]);
    await demonter();
    await monter(<Panneau declencheur="quote.sent" />);
    expect(offerts()).toEqual(expect.arrayContaining(['Numéro du devis', 'Montant du devis', 'Lien du devis']));
    expect(offerts()).not.toContain('Numéro de facture');
  });

  it('[cible de E-33] ni case à cocher, ni note interne, ni code ou instruction d’accès', async () => {
    await monter(<Panneau declencheur="invoice.overdue" />);
    const interdits = ['{{invoice.internal_notes}}', '{{client.display_as_company}}', '{{client.billing_same_as_service}}', '{{job.show_on_leaderboard}}',
      '{{client.noreview}}', '{{client.code_acces}}', '{{client.instructions_acces}}', '{{job.instructions_speciales}}'];
    expect(jetons().filter((j) => interdits.includes(String(j)))).toEqual([]);
  });

  it('un déclencheur sans client (appel reçu de l’extérieur) : l’entreprise, et pas de section « Champs personnalisés »', async () => {
    await monter(<Panneau declencheur="webhook.received" />);
    expect(titres()).toEqual(['Champs de base', 'Plus de champs']);
    expect(Array.from(document.querySelector('section[aria-labelledby$="-base"]')!.querySelectorAll('button')).map((b) => b.textContent))
      .toEqual(['Nom de l’entreprise', 'Téléphone de l’entreprise']);
  });

  it('en anglais : titres et libellés anglais, aucun mot français', async () => {
    await monter(<Panneau declencheur="invoice.overdue" fr={false} />);
    expect(titres()).toEqual(['Base fields', 'More fields', 'Custom fields']);
    expect(offerts()).toEqual(expect.arrayContaining(['Client first name', 'Company name', 'Invoice number', 'Due date', 'Payment link']));
    expect(document.body.textContent).not.toMatch(/Champs de base|Chercher|Si vide/);
  });
});

describe('P — palette : la recherche', () => {
  it('[cible de E-34] un champ de recherche filtre les trois sections, sans accents ni casse', async () => {
    await monter(<Panneau declencheur="invoice.overdue" />);
    expect(recherche()).not.toBeNull();
    await saisir(recherche(), 'ECHEANCE');
    expect(offerts()).toEqual(['Date d’échéance']);
    await saisir(recherche(), 'carbu');
    expect(offerts()).toEqual(['Job · Carburant']);
    expect(titres()).toEqual(['Champs personnalisés']);
    // Ce qui était replié sous « Plus de champs » se trouve aussi, sans rien déplier.
    await saisir(recherche(), 'avis google');
    expect(offerts()).toEqual(['Lien d’avis Google']);
    await saisir(recherche(), 'zzzz');
    expect(offerts()).toEqual([]);
    expect(document.body.textContent).toContain('Aucun champ ne correspond à cette recherche.');
    await saisir(recherche(), '');
    expect(offerts().length).toBeGreaterThan(10);
  });
});

describe('P — palette : l’insertion', () => {
  it('[cible de E-35] la variable s’insère À L’ENDROIT DU CURSEUR, et le curseur se place juste après', async () => {
    await monter(<Panneau declencheur="lead.created" />);
    await saisir(message(), 'DEBUT FIN');
    await curseur(message(), 6);
    await cliquer(bouton('Nom complet du client'));
    expect(message().value).toBe('DEBUT [client_name]FIN');
    expect([message().selectionStart, message().selectionEnd]).toEqual([19, 19]);
    expect(document.activeElement).toBe(message());
    // Deux insertions de suite se suivent, sans recliquer dans le texte.
    await cliquer(bouton('Nom de l’entreprise'));
    expect(message().value).toBe('DEBUT [client_name][company_name]FIN');
  });

  it('une sélection est REMPLACÉE par la variable', async () => {
    await monter(<Panneau declencheur="lead.created" />);
    await saisir(message(), 'Bonjour PRENOM, merci.');
    await curseur(message(), 8, 14);
    await cliquer(bouton('Prénom du client'));
    expect(message().value).toBe('Bonjour [client_first_name], merci.');
  });

  it('le DERNIER champ actif reçoit la variable : l’objet si c’est lui qui avait le curseur, pas toujours le message', async () => {
    await monter(<Panneau declencheur="invoice.overdue" />);
    await saisir(objet(), 'Facture  en retard');
    await saisir(message(), 'Bonjour,');
    await curseur(objet(), 8);
    await cliquer(bouton('Numéro de facture'));
    expect(objet().value).toBe('Facture [invoice_number] en retard');
    expect(message().value).toBe('Bonjour,');
    await curseur(message(), 7);
    await cliquer(bouton('Prénom du client'));
    expect(message().value).toBe('Bonjour[client_first_name],');
    expect(objet().value).toBe('Facture [invoice_number] en retard');
  });

  it('un champ de texte HORS du panneau n’est jamais pris pour cible ; le champ de recherche de la palette non plus', async () => {
    await monter(<Panneau declencheur="lead.created" />);
    await saisir(message(), 'AB');
    await curseur(message(), 1);
    const dehors = champNomme<HTMLTextAreaElement>('Hors du panneau');
    await act(async () => { dehors.focus(); });
    await saisir(recherche(), 'prenom');
    await cliquer(bouton('Prénom du client'));
    expect(message().value).toBe('A[client_first_name]B');
    expect(dehors.value).toBe('');
    expect(recherche().value).toBe('prenom');
  });

  it('sans aucun champ encore cliqué : à la fin du message (pas de l’objet)', async () => {
    await monter(<Panneau declencheur="lead.created" />);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(message(), 'Bonjour '); message().dispatchEvent(new Event('input', { bubbles: true })); });
    await cliquer(bouton('Prénom du client'));
    expect(message().value).toBe('Bonjour [client_first_name]');
    expect(objet().value).toBe('');
  });

  it('un champ personnalisé s’insère sous sa forme {{objet.cle}}', async () => {
    await monter(<Panneau declencheur="lead.created" />);
    await curseur(message(), 0);
    await cliquer(bouton('Client · Référé par'));
    expect(message().value).toBe('{{client.refere_par}}');
  });

  it('si l’insertion dépassait la longueur permise du champ : rien n’est écrit, et la palette dit pourquoi', async () => {
    await monter(<Panneau declencheur="lead.created" objetMax={20} />);
    await saisir(objet(), 'Bonjour à vous');
    await curseur(objet(), 14);
    await cliquer(bouton('Nom complet du client'));
    expect(objet().value).toBe('Bonjour à vous');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('dépasserait la longueur permise');
  });

  it('`onInserer` remplace l’insertion au curseur : le parent reçoit ce qu’il faut écrire', async () => {
    const recus: string[] = [];
    await monter(<Panneau declencheur="lead.created" onInserer={(e) => recus.push(e)} />);
    await saisir(message(), 'intact');
    await cliquer(bouton('Nom complet du client'));
    expect(recus).toEqual(['[client_name]']);
    expect(message().value).toBe('intact');
  });
});

describe('P — palette : « Si vide : … » (valeur de remplacement)', () => {
  it('le bouton ouvre la saisie ; le champ inséré porte alors le remplacement', async () => {
    await monter(<Panneau declencheur="lead.created" />);
    expect(bouton('Si vide : …').getAttribute('aria-expanded')).toBe('false');
    await cliquer(bouton('Si vide : …'));
    expect(document.body.textContent).toContain('« Bonjour [client_first_name|là], » donne « Bonjour là, » quand le prénom manque.');
    const saisie = document.querySelector<HTMLInputElement>('input[id$="-sivide-texte"]')!;
    await saisir(saisie, 'là');
    await saisir(message(), 'Bonjour ,');
    await curseur(message(), 8);
    await cliquer(bouton('Prénom du client'));
    expect(message().value).toBe('Bonjour [client_first_name|là],');
    await curseur(message(), 0);
    await cliquer(bouton('Client · Référé par'));
    expect(message().value).toBe('{{client.refere_par|là}}Bonjour [client_first_name|là],');
  });

  it('crochets, accolades et barre sont retirés du remplacement, qui s’arrête à 60 caractères', () => {
    expect(remplacementPropre('cher [client] {x} | ami')).toBe('cher client x  ami');
    expect(remplacementPropre('a'.repeat(80))).toHaveLength(60);
  });

  it('refermé, « Si vide » ne s’applique plus ; non offert (`avecRemplacement = false`), il n’apparaît pas', async () => {
    await monter(<Panneau declencheur="lead.created" />);
    await cliquer(bouton('Si vide : …'));
    await saisir(document.querySelector<HTMLInputElement>('input[id$="-sivide-texte"]')!, 'là');
    await cliquer(bouton('Si vide : …'));
    await curseur(message(), 0);
    await cliquer(bouton('Prénom du client'));
    expect(message().value).toBe('[client_first_name]');
    await demonter();
    await monter(<Panneau declencheur="lead.created" sansRemplacement />);
    expect(boutonPresent('Si vide : …')).toBe(false);
  });
});

describe('P — palette : la fonction d’insertion', () => {
  it('au curseur, à la place d’une sélection, bornée au texte', () => {
    expect(insererAuCurseur('DEBUT FIN', '[x]', 6)).toEqual({ valeur: 'DEBUT [x]FIN', curseur: 9 });
    expect(insererAuCurseur('abcdef', '[x]', 2, 4)).toEqual({ valeur: 'ab[x]ef', curseur: 5 });
    expect(insererAuCurseur('abc', '[x]', 99)).toEqual({ valeur: 'abc[x]', curseur: 6 });
    expect(insererAuCurseur('abc', '[x]', -5, 1)).toEqual({ valeur: '[x]bc', curseur: 3 });
    expect(insererAuCurseur('', '[x]', 0)).toEqual({ valeur: '[x]', curseur: 3 });
  });
});
