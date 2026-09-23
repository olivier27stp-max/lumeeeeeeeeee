/**
 * Le destinataire d'un message automatique vient de l'ENTITÉ (2026-09-23).
 * ───────────────────────────────────────────────────────────────────────
 * Une action d'automatisation acceptait `config.to` : un courriel ou un
 * numéro écrit dans la règle, qui remplaçait le destinataire réel. Le message
 * partait ailleurs AVEC les données du client dedans — `[client_name]`,
 * `[invoice_total]`, l'adresse du chantier. Un chemin d'exfiltration ouvert à
 * quiconque peut modifier une règle.
 *
 * Mesuré avant de le retirer : aucun champ dans l'interface pour le saisir,
 * aucun preset qui l'utilise, ZÉRO usage sur 671 règles réelles (210 en
 * production, 461 en staging).
 *
 * Ce test est un CLIQUET : il échoue si quelqu'un réintroduit un destinataire
 * venu de la configuration. La tentation reviendra — « juste pour prévenir le
 * patron » — et c'est précisément le cas qui doit passer par une action
 * dédiée, avec sa propre garde, plutôt que par un champ libre.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '..', 'server/lib/actions/index.ts'), 'utf8');

describe('le destinataire ne vient jamais de la règle', () => {
  it('aucune action ne lit `config.to` pour choisir où envoyer', () => {
    // On cherche l'affectation, pas la simple mention : le commentaire qui
    // explique la décision contient légitimement « config.to ».
    const lectures = [...source.matchAll(/const\s+to\s*=\s*([^;]+);/g)].map((m) => m[1].replace(/\s+/g, ' ').trim());
    expect(lectures.length, 'aucune résolution de destinataire trouvée — le test ne prouve plus rien').toBeGreaterThan(0);
    for (const l of lectures) {
      expect(l, `destinataire résolu depuis la configuration : « ${l} »`).not.toContain('config.to');
    }
  });

  it('le courriel part à l\'adresse du client, le SMS à son numéro', () => {
    expect(source).toContain('const to = vars.client_email;');
    expect(source).toContain('const to = vars.client_phone;');
  });

  it('la décision est expliquée dans le code, pas seulement ici', () => {
    // Sans la note, la prochaine personne rétablira `config.to` en croyant
    // réparer une régression.
    expect(source).toContain('DESTINATAIRE_IMPOSE');
  });
});
