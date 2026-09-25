/**
 * Les relances automatiques doivent être suivies (2026-09-23).
 *
 * Elles sont les seuls courriels VRAIMENT commerciaux de Lume : rappels de
 * rendez-vous, factures en retard, demandes d'avis. Ce sont donc exactement
 * ceux dont l'ouverture intéresse le propriétaire — et ils partaient sans
 * `suivi`.
 *
 * La conséquence est silencieuse, ce qui la rend vicieuse : la ligne
 * `email_deliveries` s'écrit quand même, avec `entity_type` à null. La fonction
 * `email_deliveries_enregistrer_suivi` refuse alors la mise à jour
 * (`and d.entity_type is not null` — l'exclusion Loi 25 des courriels de
 * compte). Amazon envoie bien son évènement d'ouverture, le serveur le compte,
 * et `opened_at` reste vide. Aucune erreur, nulle part.
 *
 * Ce test est statique exprès : il ne demande ni base ni réseau, donc il ne
 * peut pas être mis en quarantaine le jour où il dérange.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const racine = resolve(__dirname, '..', '..');
const lire = (p: string) => readFileSync(resolve(racine, p), 'utf8');

describe('suivi des courriels d’automatisation', () => {
  it('l’action send_email passe orgId, entityType et entityId à sendEmail', () => {
    const src = lire('server/lib/actions/index.ts');

    // L'appel existe toujours (si le fichier est réorganisé, le test doit
    // échouer bruyamment plutôt que passer sur un fichier qui a changé de rôle).
    expect(src).toContain('await sendEmail({');

    // Et il porte le suivi, avec les trois valeurs du contexte.
    expect(src).toMatch(/suivi:\s*\{\s*orgId:\s*ctx\.orgId,\s*entityType:\s*ctx\.entityType,\s*entityId:\s*ctx\.entityId\s*\}/);
  });

  it('la règle qui exclut les courriels de compte reste explicite', () => {
    /* Le pendant de la règle ci-dessus : on veut suivre les relances
       commerciales, JAMAIS les courriels de compte. Si cette liste disparaît,
       le suivi déborderait sur les mots de passe et les alertes de sécurité —
       une faute Loi 25, et dans l'autre sens celle-là. */
    const src = lire('server/routes/webhooks-email.ts');
    expect(src).toContain('ENTITES_SANS_SUIVI');
    for (const type of ['account', 'user', 'invitation', 'security', 'support']) {
      expect(src).toContain(`'${type}'`);
    }
  });
});
