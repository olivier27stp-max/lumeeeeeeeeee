/**
 * CLIQUET — la plateforme ne se nomme pas sur les pages qu'un client d'une
 * entreprise voit.
 *
 * Les courriels ont été nettoyés (PR #536), puis trois pages (PR #544). Le
 * contrat, lui, a été trouvé en cliquant les boutons en prod : il affichait
 * encore « Coquin lavage — Powered by Lume » sous la signature du client.
 *
 * Quand Coquin lavage facture Sophie, Sophie doit voir Coquin lavage. La seule
 * marque permise est la pastille, sans texte ni lien (PastilleLume).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

/** Les pages qu'un client ouvre depuis un courriel ou un texto. */
const PAGES_CLIENT = [
  'src/pages/InvoiceView.tsx',
  'src/pages/QuoteView.tsx',
  'src/pages/ContractView.tsx',
  'src/pages/PublicPayment.tsx',
  'src/components/agreements/AgreementDocument.tsx',
];

describe('pages publiques — la plateforme ne se nomme pas', () => {
  it.each(PAGES_CLIENT)('%s n’écrit ni « Powered by Lume » ni équivalent', (fichier) => {
    const src = lire(fichier);
    // On ignore les commentaires : ils expliquent justement pourquoi la règle existe.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/Powered by Lume/i);
    expect(code).not.toMatch(/Propuls. par Lume/i);
    expect(code).not.toMatch(/g.n.r..? avec Lume/i);
  });

  it.each(PAGES_CLIENT)('%s ne replie pas sur « Lume » comme nom d’entreprise', (fichier) => {
    const code = lire(fichier).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // `|| 'Lume'` ferait passer une facture de Coquin lavage pour une facture
    // de la plateforme quand le nom d'entreprise manque.
    expect(code).not.toMatch(/\|\|\s*'Lume'/);
    expect(code).not.toMatch(/\|\|\s*"Lume"/);
  });

  it('la pastille ne porte ni texte, ni lien, ni annonce vocale', () => {
    const src = lire('src/components/PastilleLume.tsx');
    expect(src).toContain('alt=""');
    expect(src).toContain('aria-hidden');
    // Une pastille cliquable serait un lien vers la plateforme dans un
    // document d'entreprise : c'est exactement ce qu'on a retiré.
    const rendu = src.slice(src.indexOf('return ('));
    expect(rendu).not.toContain('<a ');
    expect(rendu).not.toContain('href');
  });
});
