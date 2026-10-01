/**
 * Le cache d'aide commun à toutes les entreprises ne reçoit rien qui vienne d'un compte.
 *
 * Inventaire S6 : la réponse d'aide de Lumi était mémorisée pour TOUTES les
 * entreprises dès que seul search_help avait servi et que le texte ne
 * contenait ni le nom complet de l'entreprise ni celui de la personne. Le
 * modèle de Lumi a pourtant sous les yeux les fiches repérées dans la demande
 * et les notes de mémoire de l'entreprise.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reponseAidePartageable } from '../server/lib/lumi/cache-aide-global';

const base = { outils: ['search_help'], companyName: 'Lavage Tremblay inc.', userName: 'Marc Tremblay', souvenirs: [], reperage: null };
const DOC = 'Pour transformer un devis en facture, ouvre le devis approuvé et utilise « Convertir en facture ». Les articles et les taxes sont repris.';

describe('reponseAidePartageable', () => {
  it('une réponse tirée de la doc, sans rien du compte, est partageable', () => {
    expect(reponseAidePartageable({ ...base, texte: DOC })).toBe(true);
  });

  it('jamais si un autre outil que la doc a servi, ni si aucun outil n’a servi', () => {
    expect(reponseAidePartageable({ ...base, texte: DOC, outils: ['search_help', 'list_invoices'] })).toBe(false);
    expect(reponseAidePartageable({ ...base, texte: DOC, outils: ['search_clients'] })).toBe(false);
    expect(reponseAidePartageable({ ...base, texte: DOC, outils: [] })).toBe(false);
  });

  it('jamais si des fiches du compte ont été données au modèle (repérage)', () => {
    expect(reponseAidePartageable({ ...base, texte: DOC, reperage: 'Fiches trouvées : client Nathalie Côté (ref3), facture 12 — 989,85 $' })).toBe(false);
  });

  it('jamais avec un chiffre : les chiffres viennent du dossier', () => {
    expect(reponseAidePartageable({ ...base, texte: `${DOC} Tu en es à 12 factures ce mois-ci.` })).toBe(false);
  });

  it('jamais avec un morceau du nom de la personne ou de l’entreprise — pas seulement le nom complet', () => {
    expect(reponseAidePartageable({ ...base, texte: `Marc, ${DOC}` })).toBe(false);
    expect(reponseAidePartageable({ ...base, texte: `${DOC} Chez Tremblay, c’est le même chemin.` })).toBe(false);
  });

  it('jamais si la réponse parle de l’état du compte, au « tu » comme au « vous »', () => {
    expect(reponseAidePartageable({ ...base, texte: `${DOC} Tu as déjà un devis approuvé.` })).toBe(false);
    expect(reponseAidePartageable({ ...base, texte: `${DOC} Dans ton compte, c’est activé.` })).toBe(false);
    expect(reponseAidePartageable({ ...base, texte: `${DOC} C’est inclus dans ton forfait.` })).toBe(false);
  });

  it('jamais si elle reprend un nom propre d’une note de mémoire de l’entreprise', () => {
    const souvenirs = [{ key: 'client important', value: 'Clinique Leblanc paie toujours par chèque' }];
    expect(reponseAidePartageable({ ...base, souvenirs, texte: `${DOC} Pour Leblanc, pense au chèque.` })).toBe(false);
    // La même note ne bloque pas une réponse qui n'en reprend rien.
    expect(reponseAidePartageable({ ...base, souvenirs, texte: DOC })).toBe(true);
  });
});

describe('la route n’écrit dans le cache global que par ce filtre', () => {
  const route = readFileSync(resolve(__dirname, '..', 'server', 'routes', 'lumi.ts'), 'utf8').replace(/\r\n/g, '\n');
  it('une seule écriture « global », gardée par reponseAidePartageable avec le repérage et les notes', () => {
    const ecritures = route.match(/memoriserSemantique\(\{ genre: 'global'/g) ?? [];
    expect(ecritures).toHaveLength(1);
    const i = route.indexOf("memoriserSemantique({ genre: 'global'");
    const avant = route.slice(route.lastIndexOf('if (vec', i), i);
    expect(avant).toContain('reponseAidePartageable({');
    expect(avant).toContain('souvenirs: ctx.promptCtx.souvenirs');
    expect(avant).toContain('reperage }');
  });
});
