/**
 * Launch 2026-09-28 — bloc 4 : un appel extérieur ne pilote jamais le moteur.
 *
 * Le JSON reçu était étalé tel quel dans les métadonnées de l'événement : un
 * corps portant `chaine` ou `suppress_immediate` décidait de l'anti-boucle
 * ou supprimait des confirmations. Les champs utiles aux filtres restent au
 * premier niveau ; les champs de contrôle sont écartés ; le corps est aussi
 * rangé sous `webhook`.
 */
import { describe, it, expect } from 'vitest';
import { champsFiltrables } from '../../server/routes/webhooks-entrants';
import { readFileSync } from 'node:fs';

describe('corps d’un webhook entrant', () => {
  it('les champs de contrôle du moteur ne passent JAMAIS', () => {
    const m = champsFiltrables({ source: 'facebook', nom: 'Marie', chaine: ['r1', 'r2', 'r3'], suppress_immediate: true, evenement_base_id: '9', recu_le: '1999-01-01' });
    expect(m).toEqual({ source: 'facebook', nom: 'Marie' });
  });

  it('un corps qui n’est pas un objet ne pose rien', () => {
    expect(champsFiltrables(['a'])).toEqual({});
    expect(champsFiltrables('texte')).toEqual({});
    expect(champsFiltrables(null)).toEqual({});
  });

  it('la route passe par ce filtre et range le corps sous `webhook`', () => {
    const src = readFileSync('server/routes/webhooks-entrants.ts', 'utf8');
    expect(src).toContain('...champsFiltrables(corps)');
    expect(src).toContain('webhook: corps');
    expect(src).not.toMatch(/\.\.\.\(corps !== null && typeof corps === 'object'/);
  });
});
