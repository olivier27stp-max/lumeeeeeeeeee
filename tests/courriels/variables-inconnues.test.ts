/**
 * L'avertissement des variables qui n'existent pas (2026-09-23).
 *
 * Deux façons de se tromper en écrivant un modèle, et aucune ne se voyait :
 *
 *   [invoice_numbr]  une lettre en moins → `applyTemplate` remplace par du
 *                    VIDE. Le client reçoit « Facture  » : un trou, pas un
 *                    crochet. C'est le pire des deux, parce qu'il est muet.
 *   [montant_dû]     un accent, un tiret ou une espace → `applyTemplate`
 *                    utilise `\w` et ne reconnaît rien. Le crochet part tel
 *                    quel chez le client. Piège francophone : écrire
 *                    « [montant_dû] » est naturel.
 *
 * On ne peut pas effacer tous les crochets à l'envoi : « Rabais [50 %] » est
 * un texte légitime. La seule bonne place est l'éditeur, pendant la frappe.
 *
 * Le critère est la RESSEMBLANCE à une variable connue, pas la forme. Deux
 * tentatives par la forme ont échoué : « [ci-dessous] » ressemble à une clé,
 * « [client name] » n'y ressemble pas. Crier à tort apprendrait à ignorer
 * l'avertissement, ce qui le rendrait inutile le jour où il a raison.
 *
 * Cette fonction reproduit le `useMemo` de EmailPreviewEditor. Un test
 * statique vérifie en plus que les deux ne divergent pas.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { variablesPour, VARIABLES_PAR_TYPE } from '../../src/lib/variablesCourriel';

const TOUTES_LES_CLES = new Set(Object.values(VARIABLES_PAR_TYPE).flat().map((v) => v.cle));

/** La même logique que l'éditeur, pour la tester hors React. */
function inconnues(texte: string, type: string): string[] {
  const connues = new Set(variablesPour(type).map((v) => v.cle));
  const vues = new Set<string>();
  for (const m of texte.matchAll(/[[{]([^\]}]{1,40})[\]}]/g)) {
    const cle = m[1].trim();
    if (connues.has(cle)) continue;
    if (TOUTES_LES_CLES.has(cle)) { vues.add(cle); continue; }
    const nu = (x: string) => x.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
    const cleNue = nu(cle);
    const ressemble = [...connues].some((k) => {
      const kn = nu(k);
      if (kn === cleNue) return true;
      if (Math.abs(kn.length - cleNue.length) > 3) return false;
      let commun = 0;
      while (commun < kn.length && commun < cleNue.length && kn[commun] === cleNue[commun]) commun++;
      return commun >= Math.min(7, Math.ceil(Math.max(kn.length, cleNue.length) * 0.75));
    });
    if (!ressemble) continue;
    vues.add(cle);
  }
  return [...vues];
}

describe('variables qui n’existent pas', () => {
  it('signale la faute de frappe — le cas MUET, qui part en blanc chez le client', () => {
    expect(inconnues('Facture [invoice_numbr]', 'invoice_sent')).toEqual(['invoice_numbr']);
    expect(inconnues('Montant [invoice_amont]', 'invoice_sent')).toEqual(['invoice_amont']);
  });

  it('signale la clé mal écrite — le crochet partirait TEL QUEL', () => {
    // `applyTemplate` utilise `\w` : ni le tiret, ni l'espace, ni l'accent
    // ne sont reconnus, donc rien n'est remplacé.
    expect(inconnues('Bonjour [client-name]', 'invoice_sent')).toEqual(['client-name']);
    expect(inconnues('Bonjour [client name]', 'invoice_sent')).toEqual(['client name']);
    expect(inconnues('Bonjour [Client_Name]', 'invoice_sent')).toEqual(['Client_Name']);
  });

  it('se tait sur un texte entre crochets — sinon on apprend à l’ignorer', () => {
    for (const t of [
      'Rabais [50 %] appliqué',
      'Voir [ci-dessous] le détail',
      'Note [important] ici',
      'Merci [beaucoup]',
      'Réf. [A-1234]',
    ]) {
      expect(inconnues(t, 'invoice_sent'), t).toEqual([]);
    }
  });

  it('se tait quand tout est correct, dans les deux syntaxes', () => {
    expect(inconnues('Facture [invoice_number] — [invoice_amount]', 'invoice_sent')).toEqual([]);
    expect(inconnues('Facture {invoice_number} — {invoice_amount}', 'invoice_sent')).toEqual([]);
  });

  it('signale une variable d’un AUTRE poste', () => {
    // `quote_number` existe, mais pas pour une facture : le serveur la
    // remplacerait par du vide.
    expect(inconnues('Soumission [quote_number]', 'invoice_sent')).toEqual(['quote_number']);
  });

  it('l’éditeur porte bien cette logique, et l’avertissement', () => {
    const src = readFileSync(
      resolve(__dirname, '..', '..', 'src', 'components', 'automations', 'EmailPreviewEditor.tsx'),
      'utf8',
    );
    expect(src).toContain('const inconnues = useMemo(');
    expect(src).toContain('normalize(\'NFD\')');
    // L'avertissement est visible, et il n'empêche PAS d'enregistrer : une
    // entreprise peut avoir une raison d'écrire un crochet, et bloquer son
    // travail pour un avertissement serait pire que le défaut signalé.
    expect(src).toContain('inconnues.length > 0');
    expect(src).not.toMatch(/disabled=\{[^}]*inconnues/);
  });
});
