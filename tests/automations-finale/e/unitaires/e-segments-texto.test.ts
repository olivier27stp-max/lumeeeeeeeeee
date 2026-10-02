/**
 * Agent E — point 16 de la mission : le compteur de caractères et de segments de
 * l'éditeur de texto (« les accents peuvent doubler le coût »).
 *
 * Le calcul lui-même (`segmentsSms`) est juste. Ce qui trompe, c'est CE QU'ON LUI
 * DONNE : l'éditeur compte le GABARIT (« [client_first_name] » = 19 caractères,
 * dont deux crochets qui valent double en GSM-7), jamais le texte que le client
 * recevra — variables remplies, plus la mention « Répondez STOP » que le serveur
 * ajoute à tout texto commercial.
 *
 * « témoin » = vert aujourd'hui ; les autres sont ROUGES aujourd'hui.
 */
import { describe, it, expect } from 'vitest';
import { segmentsSms, libelleSegments } from '../../../../src/lib/smsSegments';
import { avecMentionCommerciale } from '../../../../server/lib/desabonnement/mention-sms';
import { resolveTemplate } from '../../../../server/lib/actions/index';
import { ACTIONS } from '../../../../src/lib/automationCatalogue';

const VARS = { client_first_name: 'Marie', client_name: 'Marie Tremblay', company_name: 'Nettoyage Test A', invoice_number: 'F-0042', invoice_link: 'https://app.lumecrm.net/invoice/9f1c2d3e-4b5a-6978-8a9b-0c1d2e3f4a5b' };

describe('E — segments d’un texto : le calcul (témoins)', () => {
  it('[E-60 témoin] « é è à ù » restent en GSM-7 (160 par SMS) ; « ê ç ô ’ » et un émoji font passer à 70 par SMS', () => {
    expect(segmentsSms('é'.repeat(160))).toMatchObject({ encodage: 'GSM-7', segments: 1 });
    expect(segmentsSms('é'.repeat(161))).toMatchObject({ encodage: 'GSM-7', segments: 2 });
    for (const c of ['ê', 'ç', 'ô', '’', '🙂', '«']) {
      expect(segmentsSms(`${'a'.repeat(70)}${c}`), c).toMatchObject({ encodage: 'UCS-2', segments: 2 });
    }
  });

  it('[E-60 témoin] un texte de 100 caractères avec UN « ê » est facturé 2 SMS, et l’éditeur le dit', () => {
    const texte = `Bonjour, votre rendez-vous est confirmé. Vous êtes attendu demain matin à 9 h. À bientôt et merci !!`;
    expect(texte.length).toBe(100);
    expect(segmentsSms(texte).segments).toBe(2);
    expect(libelleSegments(texte, true)).toContain('2 SMS');
  });
});

describe('E — ce que l’éditeur annonce contre ce qui est facturé (ROUGE aujourd’hui)', () => {
  it('[E-61] le texte par défaut d’un nouveau texto contient « ’ » : il part en tranches de 70, et l’éditeur ne dit rien', () => {
    const defaut = ACTIONS.find((a) => a.cle === 'send_sms')!.champs.find((c) => c.cle === 'body')!.defaut_fr!;
    expect(defaut).toBe('Bonjour [client_name], c’est [company_name]. Merci !');
    // Ce que le client reçoit quand le texto est commercial (cas par défaut d'une relance) :
    const envoye = avecMentionCommerciale(resolveTemplate(defaut, VARS), VARS.company_name, 'fr');
    const reel = segmentsSms(envoye);
    expect(reel).toMatchObject({ encodage: 'UCS-2', segments: 2 }); // témoin : 2 SMS facturés
    // L'éditeur, lui, compte le gabarit : 1 segment, donc aucun libellé.
    const annonce = libelleSegments(defaut, true);
    expect(annonce, `l’éditeur n’annonce rien alors que ${reel.segments} SMS sont facturés`).not.toBeNull();
  });

  it('[E-62] le compteur tient compte de la mention « Répondez STOP » ajoutée par le serveur aux textos commerciaux', () => {
    const gabarit = 'Bonjour [client_first_name], votre facture [invoice_number] est en retard. Merci de la payer ici : [invoice_link]';
    const envoye = avecMentionCommerciale(resolveTemplate(gabarit, VARS), VARS.company_name, 'fr');
    const facture = segmentsSms(envoye).segments;
    const annonce = segmentsSms(gabarit).segments;
    expect(facture).toBe(2); // témoin : ce qui part
    expect(annonce, `annoncé ${annonce} SMS, facturé ${facture}`).toBe(facture);
  });

  it('[E-63] l’éditeur affiche le nombre de SMS même quand il n’y en a qu’un (« 1 SMS »), pas seulement à partir de 2', () => {
    expect(libelleSegments('Bonjour, à demain.', true)).toBe('1 SMS');
  });
});
