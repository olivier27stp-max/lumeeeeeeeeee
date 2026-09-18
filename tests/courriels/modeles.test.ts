/**
 * Modèles de courriel de l'entreprise (server/lib/courriels/modeles.ts).
 *
 * Trois choses à prouver, et chacune correspond à une façon dont la
 * fonctionnalité peut nuire en silence :
 *
 *   1. LA RÉSOLUTION. Le bogue d'origine, c'est que personne ne lisait
 *      `is_default` : les modèles écrits par les entreprises étaient morts. Mais
 *      le sur-corriger est tout aussi grave — si `texteDuCourriel` renvoyait
 *      autre chose que `null` pour une org SANS modèle, on changerait le
 *      courriel de toutes les orgs qui n'ont rien demandé.
 *   2. L'ISOLATION ENTRE ORGS. La lecture passe par `getServiceClient()`, qui
 *      CONTOURNE la RLS. Le filtre `org_id` n'est donc pas une optimisation :
 *      c'est la seule chose qui empêche l'entreprise A d'envoyer le texte de
 *      l'entreprise B à ses clients.
 *   3. LA CHARPENTE SURVIT. Le HTML importé se pose DANS notre gabarit. Si une
 *      entreprise pouvait, avec un modèle bâclé ou hostile, faire disparaître le
 *      bouton de paiement ou les numéros de taxes, son client ne pourrait plus
 *      payer et elle serait en faute vis-à-vis de Revenu Québec.
 */
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { texteDuCourriel, assainirHtmlCourriel } from '../../server/lib/courriels/modeles';
import { rendreCourrielClient } from '../../server/lib/courriels/gabarit';

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';

interface Ligne { org_id: string; type: string; subject: string; body: string; source?: string; is_active?: boolean }

/**
 * Une fausse table `email_templates` qui applique les MÊMES filtres que
 * PostgREST. On ne simule pas « la requête a marché » : on rejoue les `.eq()`
 * réellement posés par le code, pour qu'un filtre `org_id` oublié fasse
 * échouer le test au lieu de passer inaperçu.
 */
function faussebase(lignes: Ligne[]): SupabaseClient {
  return {
    from(table: string) {
      if (table !== 'email_templates') throw new Error(`table inattendue : ${table}`);
      let restantes = lignes.slice();
      const chaine = {
        select: () => chaine,
        eq(colonne: string, valeur: unknown) {
          restantes = restantes.filter((l) => {
            const actuel = colonne === 'is_active' ? (l.is_active ?? true) : (l as unknown as Record<string, unknown>)[colonne];
            return actuel === valeur;
          });
          return chaine;
        },
        order: () => chaine,
        limit(n: number) {
          return Promise.resolve({ data: restantes.slice(0, n), error: null });
        },
      };
      return chaine;
    },
  } as unknown as SupabaseClient;
}

describe('texteDuCourriel — résolution', () => {
  it('rend le modèle de l’org, variables remplacées', async () => {
    const db = faussebase([{
      org_id: ORG_A, type: 'invoice_sent',
      subject: 'Facture {invoice_number} pour {client_name}',
      body: 'Bonjour {client_name},\nMerci de votre confiance.',
    }]);

    const r = await texteDuCourriel(ORG_A, 'invoice_sent', { client_name: 'Marie', invoice_number: '40' }, db);

    expect(r).not.toBeNull();
    expect(r?.sujet).toBe('Facture 40 pour Marie');
    expect(r?.corpsHtml).toContain('Bonjour Marie,');
    // Un saut de ligne d'un texte d'éditeur devient un <br/>, sinon le courriel
    // arriverait en un seul bloc illisible.
    expect(r?.corpsHtml).toContain('<br/>');
  });

  it('renvoie null quand l’org n’a AUCUN modèle — l’appelant garde son texte d’origine', async () => {
    // Le cas le plus fréquent, et le plus important : c'est lui qui garantit
    // que brancher la personnalisation ne change rien pour les orgs existantes.
    const r = await texteDuCourriel(ORG_A, 'invoice_sent', {}, faussebase([]));
    expect(r).toBeNull();
  });

  it('renvoie null pour un AUTRE type, même si l’org a des modèles', async () => {
    const db = faussebase([{ org_id: ORG_A, type: 'quote_sent', subject: 'S', body: 'B' }]);
    expect(await texteDuCourriel(ORG_A, 'invoice_sent', {}, db)).toBeNull();
  });

  it('ignore un modèle inactif : un brouillon ne part jamais chez un client', async () => {
    const db = faussebase([{ org_id: ORG_A, type: 'invoice_sent', subject: 'S', body: 'B', is_active: false }]);
    expect(await texteDuCourriel(ORG_A, 'invoice_sent', {}, db)).toBeNull();
  });

  it('renvoie null sur un modèle vide plutôt que d’envoyer un courriel vide', async () => {
    const db = faussebase([{ org_id: ORG_A, type: 'invoice_sent', subject: '  ', body: '' }]);
    expect(await texteDuCourriel(ORG_A, 'invoice_sent', {}, db)).toBeNull();
  });
});

describe('texteDuCourriel — isolation entre organisations', () => {
  it('ne lit JAMAIS le modèle d’une autre org', async () => {
    // getServiceClient() contourne la RLS : sans le filtre org_id, l'org A
    // enverrait le texte de l'org B à ses propres clients.
    const db = faussebase([{
      org_id: ORG_B, type: 'invoice_sent',
      subject: 'SECRET DE L’ORG B', body: 'Texte confidentiel de l’org B',
    }]);

    const r = await texteDuCourriel(ORG_A, 'invoice_sent', {}, db);
    expect(r).toBeNull();
  });

  it('chaque org reçoit son propre texte quand les deux en ont un', async () => {
    const lignes: Ligne[] = [
      { org_id: ORG_A, type: 'invoice_sent', subject: 'A', body: 'Texte de A' },
      { org_id: ORG_B, type: 'invoice_sent', subject: 'B', body: 'Texte de B' },
    ];
    expect((await texteDuCourriel(ORG_A, 'invoice_sent', {}, faussebase(lignes)))?.corpsHtml).toContain('Texte de A');
    expect((await texteDuCourriel(ORG_B, 'invoice_sent', {}, faussebase(lignes)))?.corpsHtml).toContain('Texte de B');
  });

  it('un orgId vide ne lit rien du tout', async () => {
    const db = faussebase([{ org_id: ORG_A, type: 'invoice_sent', subject: 'S', body: 'B' }]);
    expect(await texteDuCourriel('', 'invoice_sent', {}, db)).toBeNull();
  });
});

describe('assainirHtmlCourriel', () => {
  it('retire <script> AVEC son contenu — sinon le code resterait en texte brut', () => {
    const sale = '<p>Bonjour</p><script>alert(1);fetch("/vol")</script><p>Fin</p>';
    const propre = assainirHtmlCourriel(sale);
    expect(propre).not.toMatch(/<script/i);
    expect(propre).not.toContain('alert(1)');
    expect(propre).not.toContain('fetch("/vol")');
    expect(propre).toContain('<p>Bonjour</p>');
    expect(propre).toContain('<p>Fin</p>');
  });

  it('retire aussi <style>, <iframe> et <noscript>', () => {
    const propre = assainirHtmlCourriel(
      '<style>body{display:none}</style><iframe src="https://pirate.test"></iframe><noscript>x</noscript><p>ok</p>',
    );
    expect(propre).not.toMatch(/<style|<iframe|<noscript/i);
    expect(propre).not.toContain('display:none');
    expect(propre).not.toContain('pirate.test');
    expect(propre).toContain('<p>ok</p>');
  });

  it('retire les attributs on* — guillemets doubles, simples ou absents', () => {
    const propre = assainirHtmlCourriel(
      '<div onclick="voler()" onmouseover=\'x()\' onerror=boum()><img src="https://x.test/a.png" onload="y()" alt="a"/></div>',
    );
    expect(propre).not.toMatch(/\son\w+\s*=/i);
    expect(propre).not.toContain('voler()');
    expect(propre).not.toContain('boum()');
    // Le contenu légitime reste : on coupe le dangereux, pas le décoratif.
    expect(propre).toContain('src="https://x.test/a.png"');
    expect(propre).toContain('alt="a"');
  });

  it('neutralise javascript: dans un href, y compris avec des blancs insérés', () => {
    const propre = assainirHtmlCourriel(
      '<a href="javascript:alert(1)">A</a><a href="java\tscript:alert(2)">B</a><a href="JaVaScRiPt:x">C</a>',
    );
    expect(propre).not.toMatch(/javascript\s*:/i);
    expect(propre.match(/href="#"/g)?.length).toBe(3);
    // Le texte des liens reste : le lecteur voit toujours le contenu du courriel.
    expect(propre).toContain('>A</a>');
  });

  it('préserve le HTML légitime de mise en forme', () => {
    // Un modèle importé doit rester joli. Trop assainir le viderait de sa
    // substance et l'entreprise croirait la fonctionnalité cassée.
    const legitime = '<table><tr><td style="padding:8px"><strong>Merci !</strong> '
      + '<a href="https://visionlavage.ca/promo">Voir l’offre</a></td></tr></table>'
      + '<ul><li>Lavage</li><li>Cirage</li></ul>';
    const propre = assainirHtmlCourriel(legitime);
    expect(propre).toContain('<strong>Merci !</strong>');
    expect(propre).toContain('href="https://visionlavage.ca/promo"');
    expect(propre).toContain('style="padding:8px"');
    expect(propre).toContain('<li>Lavage</li>');
  });

  it('un <script> imbriqué ne se reconstitue pas après un passage', () => {
    // « <scr<script>ipt> » : si on ne bouclait pas, retirer la balise interne
    // recollerait les morceaux en un <script> parfaitement valide.
    const propre = assainirHtmlCourriel('<scr<script>oups</script>ipt>alert(1)</script>');
    expect(propre).not.toMatch(/<script/i);
  });

  it('accepte une entrée vide ou absente sans lever', () => {
    expect(assainirHtmlCourriel(null)).toBe('');
    expect(assainirHtmlCourriel(undefined)).toBe('');
    expect(assainirHtmlCourriel('')).toBe('');
  });
});

describe('la charpente survit à un modèle importé', () => {
  const marque = {
    nom: 'Vision Lavage',
    couleur: '#0f766e',
    email: 'info@visionlavage.ca',
    telephone: '514 555-0199',
    lignesTaxes: ['TPS No : 123456789 RT0001', 'TVQ No : 1098765432 TQ0001'],
  };

  /** Le pire modèle plausible : du HTML hostile, sans bouton, sans pied. */
  const importHostile = '<script>document.write("")</script>'
    + '<div onclick="voler()"><h2>PROMO DU MOIS</h2><p>Merci de votre confiance !</p>'
    + '<a href="javascript:void(0)">cliquez</a></div>';

  const html = rendreCourrielClient({
    langue: 'fr',
    marque,
    titre: 'Votre facture 40',
    corpsHtml: assainirHtmlCourriel(importHostile),
    montant: { libelle: 'Montant à payer', valeur: '1 234,56 $' },
    bouton: { texte: 'Voir et payer la facture', url: 'https://lumecrm.net/invoice/abc' },
  });

  it('le BOUTON de paiement est là — un client doit toujours pouvoir payer', () => {
    expect(html).toContain('https://lumecrm.net/invoice/abc');
    expect(html).toContain('Voir et payer la facture');
  });

  it('le MONTANT est là, dans notre carte et pas dans le texte importé', () => {
    expect(html).toContain('1 234,56 $');
    expect(html).toContain('Montant à payer');
  });

  it('les NUMÉROS DE TAXES et le pied sont là — obligation légale, jamais déléguée', () => {
    expect(html).toContain('TPS No : 123456789 RT0001');
    expect(html).toContain('TVQ No : 1098765432 TQ0001');
    expect(html).toContain('Vision Lavage');
    expect(html).toContain('info@visionlavage.ca');
    expect(html).toContain('Envoyé avec');
  });

  it('le texte de l’entreprise apparaît bien, mais désarmé', () => {
    expect(html).toContain('PROMO DU MOIS');
    expect(html).toContain('Merci de votre confiance !');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\bonclick\s*=/i);
    expect(html).not.toMatch(/javascript\s*:/i);
  });

  it('le courriel reste un document complet : <html>, <body>, un seul gabarit', () => {
    // Un import ne remplace jamais la charpente : il est POSÉ dedans.
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<html lang="fr">');
    expect(html.match(/<body/g)?.length).toBe(1);
  });
});
