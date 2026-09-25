/**
 * Plusieurs questions produit collées dans un seul message (2026-09-22).
 *
 * Cas réel mesuré en prod : quatre questions dont chacune a une réponse
 * écrite à la main, envoyées d'un coup, ont coûté 2,65 ¢ et 5,5 s. Prises
 * une par une, elles sont gratuites et instantanées.
 */
import { describe, it, expect } from 'vitest';
import { reponseAideMulti, decouperEnQuestions, MAX_LIGNES } from '../../server/lib/support/aide-multi';

/** Le message exact collé par l'utilisateur en production. */
const BLOC_REEL = [
  'mon paiement a échoué je fais quoi',
  'comment je parle à un humain',
  'comment supprimer une tâche',
  'comment activer la double authentification',
].join('\n');

describe('le cas réel de production', () => {
  it('répond aux quatre questions sans modèle', () => {
    const r = reponseAideMulti(BLOC_REEL, 'fr');
    expect(r, 'ce bloc coûtait 2,65 ¢ — il doit être gratuit').not.toBeNull();
    expect(r!.ids).toHaveLength(4);
    // Chaque question est rappelée avant sa réponse : sinon on ne sait plus
    // laquelle est laquelle.
    expect(r!.texte).toContain('mon paiement a échoué je fais quoi');
    expect(r!.texte).toContain('comment activer la double authentification');
  });
});

describe('découpage', () => {
  it('coupe sur les sauts de ligne, pas sur les « ? »', () => {
    // Couper sur « ? » produirait des fragments vides de sens.
    const l = decouperEnQuestions('est-ce que je peux changer mon forfait ? et ensuite annuler ?');
    expect(l).toHaveLength(1);
  });

  it('retire les puces et les numéros', () => {
    const l = decouperEnQuestions('- comment je change de plan\n2) comment supprimer une tâche');
    expect(l[0]).toBe('comment je change de plan');
    expect(l[1]).toBe('comment supprimer une tâche');
  });

  it('écarte les fragments trop courts', () => {
    expect(decouperEnQuestions('oui\nok\nbon')).toHaveLength(0);
  });
});

describe('tout ou rien', () => {
  it('une seule ligne sans réponse toute faite → tout part au modèle', () => {
    const melange = 'comment je change de plan\nquel est mon chiffre du mois';
    expect(
      reponseAideMulti(melange, 'fr'),
      'la 2e question lit les DONNÉES : le modèle doit traiter le message entier',
    ).toBeNull();
  });

  it('une action au milieu bloque tout le lot', () => {
    const melange = 'comment je change de plan\nsupprime la facture INV-0004';
    expect(reponseAideMulti(melange, 'fr')).toBeNull();
  });
});

describe('bornes', () => {
  it('une seule question n\'est pas du multi (le chemin normal s\'en charge)', () => {
    expect(reponseAideMulti('comment je change de plan', 'fr')).toBeNull();
  });

  it('un long copier-coller n\'est pas une liste de questions', () => {
    const long = Array.from({ length: MAX_LIGNES + 2 }, () => 'comment je change de plan').join('\n');
    expect(reponseAideMulti(long, 'fr')).toBeNull();
  });

  it('les doublons ne sont pas répondus deux fois, et ne font pas échouer le lot', () => {
    const r = reponseAideMulti('comment je change de plan\ncomment je change de plan\ncomment supprimer une tâche', 'fr');
    expect(r).not.toBeNull();
    expect(r!.ids).toHaveLength(2);
  });

  it('fonctionne en anglais', () => {
    const r = reponseAideMulti('How do I change or cancel my plan?\nHow do I talk to a human on the team?', 'en');
    expect(r).not.toBeNull();
    expect(r!.ids).toHaveLength(2);
  });
});
