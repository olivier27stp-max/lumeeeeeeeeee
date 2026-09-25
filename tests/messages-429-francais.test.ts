/**
 * Le message d'attente (429) parle français.
 *
 * Mandat d'audit 2026-09-25 : « ni "Too many requests" en anglais —
 * messages propres en français ». Les 95 clients API du navigateur
 * relaient le champ `error` du serveur tel quel : une phrase anglaise
 * écrite dans une route arrive sous les yeux d'un client québécois.
 */

import { describe, it, expect } from 'vitest';
import { messageTropDeDemandes, messageRafaleDetectee } from '../server/lib/message-429';

describe('le message d’attente', () => {
  it('donne le délai quand il est connu', () => {
    // « Réessayez plus tard » ne dit pas si c'est 5 secondes ou 10
    // minutes : l'utilisateur reclique, et reprend un blocage.
    expect(messageTropDeDemandes(30)).toMatch(/30 secondes/);
    expect(messageTropDeDemandes(120)).toMatch(/2 minutes/);
    expect(messageTropDeDemandes(60)).toMatch(/1 minute(?!s)/);
    expect(messageTropDeDemandes()).toMatch(/Patientez/);
  });

  it('n’est jamais en anglais, quel que soit le délai', () => {
    for (const v of [undefined, 0, 5, 59, 60, 3600]) {
      expect(messageTropDeDemandes(v)).not.toMatch(/try again|too many/i);
      expect(messageRafaleDetectee(v)).not.toMatch(/try again|burst/i);
    }
  });
});
