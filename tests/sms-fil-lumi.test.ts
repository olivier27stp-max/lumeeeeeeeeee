/**
 * Le fil d'une conversation Lumi par texto.
 *
 * Deux règles tiennent tout : une écriture ne part jamais sans « oui », et un
 * « oui » isolé ne confirme rien s'il n'y a rien en attente — sinon le « oui »
 * d'opt-in LCAP que le webhook traite déjà déclencherait une action.
 */
import { describe, it, expect } from 'vitest';
import { marquerProposition, lireProposition, MESSAGES_RELUS } from '../server/lib/sms/fil-lumi';
import { pourSms, consignesSms, LONGUEUR_MAX_SMS } from '../server/lib/sms/lumi-sms';

const p = { tool: 'send_payment_reminders', args: { client_id: 'abc' }, tool_use_id: 'tu_1' };

describe('marqueur de proposition', () => {
  it('le texte lisible reste intact', () => {
    const marque = marquerProposition('Je relance Sophie ?', p);
    expect(lireProposition(marque).visible).toBe('Je relance Sophie ?');
  });

  it('relit exactement ce qui a été proposé', () => {
    expect(lireProposition(marquerProposition('x', p)).proposition).toEqual(p);
  });

  it('un message ordinaire ne porte aucune proposition', () => {
    const r = lireProposition('3 visites demain.');
    expect(r.proposition).toBeNull();
    expect(r.visible).toBe('3 visites demain.');
  });

  it('un marqueur abîmé ne fait pas exécuter n’importe quoi', () => {
    // Le texte vient de la base : il peut avoir été tronqué. Mieux vaut
    // perdre la proposition que d'exécuter une action mal relue.
    const abime = marquerProposition('Je relance ?', p).slice(0, -12);
    expect(lireProposition(abime).proposition).toBeNull();
    expect(lireProposition(abime).visible).toBe('Je relance ?');
  });

  it('résiste à un message vide ou absent', () => {
    expect(lireProposition('').proposition).toBeNull();
    expect(lireProposition(undefined as any).visible).toBe('');
  });

  it('le marqueur n’est pas visible dans le texte', () => {
    // Des caractères parasites dans un SMS, ça fait amateur.
    const marque = marquerProposition('Je relance Sophie ?', p);
    expect(marque.replace(/[​]/g, '')).toContain('Je relance Sophie ?');
    expect(lireProposition(marque).visible).not.toMatch(/[​]/);
  });

  it('relit une proposition dont les arguments contiennent du texte libre', () => {
    const avecTexte = { tool: 'send_sms', args: { body: 'Bonjour Sophie, petit rappel — 1 626,90 $' }, tool_use_id: 't2' };
    expect(lireProposition(marquerProposition('J’envoie ?', avecTexte)).proposition).toEqual(avecTexte);
  });
});

describe('pourSms', () => {
  it('laisse passer une réponse courte', () => {
    expect(pourSms('3 visites demain.')).toBe('3 visites demain.');
  });

  it('coupe à la phrase, jamais au milieu d’un montant', () => {
    const long = 'Sophie Bouchard doit 1 626,90 $. '.repeat(60);
    const r = pourSms(long);
    expect(r.length).toBeLessThanOrEqual(LONGUEUR_MAX_SMS + 1);
    expect(r.endsWith('…')).toBe(true);
    // La coupe tombe après un point, donc le dernier montant est entier.
    expect(r.slice(0, -1).trim().endsWith('$.') || r.slice(0, -1).trim().endsWith('.')).toBe(true);
  });

  it('resserre les sauts de ligne en trop', () => {
    expect(pourSms('a\n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('rend une chaîne vide sans lever', () => {
    expect(pourSms('')).toBe('');
    expect(pourSms(null as any)).toBe('');
  });
});

describe('consignesSms', () => {
  it('interdit la mise en forme : un téléphone n’affiche pas le gras', () => {
    const fr = consignesSms('fr');
    expect(fr).toMatch(/texto/i);
    expect(fr).toMatch(/puces|mise en forme/i);
  });

  it('existe dans les deux langues', () => {
    expect(consignesSms('en')).toMatch(/TEXT MESSAGE/);
    expect(consignesSms('en')).not.toEqual(consignesSms('fr'));
  });
});

describe('garde-fous du fil', () => {
  it('ne relit qu’un bout du fil : un texto n’est pas une archive', () => {
    expect(MESSAGES_RELUS).toBeGreaterThan(2);
    expect(MESSAGES_RELUS).toBeLessThanOrEqual(20);
  });
});
