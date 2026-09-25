/**
 * CLIQUETS — les défauts trouvés en cliquant le parcours d'un client final
 * le 2026-09-24, chacun figé pour qu'il ne revienne pas.
 *
 * Deux tenants au branding opposé (Coquin lavage orange/Sherbrooke, Grok Audit
 * bleu/Montréal) ont servi de révélateur : c'est en comparant deux factures
 * qu'on a vu qu'AUCUNE des deux ne portait sa couleur.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { nettoyerLiensMorts } from '../../server/routes/reminders-cron';

const lire = (p: string) => readFileSync(resolve(__dirname, '..', '..', p), 'utf8');
/** Le code seul : les commentaires expliquent les défauts, ils ne doivent pas les déclencher. */
const codeSeul = (p: string) => lire(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('la facture publique porte la couleur de l’entreprise', () => {
  it('InvoiceView résout la couleur de marque, comme les trois autres pages', () => {
    // Elle était la SEULE des quatre à ne pas le faire : l'API envoyait
    // `brand_color`, la page ne la lisait jamais. Une facture — la page la plus
    // vue par un client — s'affichait en noir et gris quelle que soit la marque.
    const src = lire('src/pages/InvoiceView.tsx');
    expect(src).toContain('resolveBrand');
    expect(src).toMatch(/const brand = resolveBrand\(company\?\.brand_color\)/);
  });

  it('le titre et le bouton de paiement portent cette couleur', () => {
    const src = lire('src/pages/InvoiceView.tsx');
    expect(src).toMatch(/style=\{\{ color: brand \}\}/);
    expect(src).toMatch(/background: brand, color: readableOn\(brand\)/);
  });

  it.each([
    'src/pages/InvoiceView.tsx',
    'src/pages/QuoteView.tsx',
    'src/pages/ContractView.tsx',
    'src/pages/PublicPayment.tsx',
  ])('%s applique la couleur du tenant', (fichier) => {
    expect(lire(fichier)).toContain('resolveBrand');
  });
});

describe('aucun bouton ne pointe vers un jeton absent', () => {
  it.each([
    ['server/routes/agreements.ts', /const viewUrl = agreement\.view_token \?/],
    ['server/routes/emails.ts', /view_token \?/],
  ])('%s construit son lien sous garde', (fichier, motif) => {
    expect(codeSeul(fichier)).toMatch(motif);
  });

  it('le bouton du contrat disparaît avec son lien', () => {
    expect(codeSeul('server/routes/agreements.ts')).toMatch(/bouton: viewUrl \? \{/);
  });

  it('le bouton de paiement disparaît avec son lien', () => {
    expect(codeSeul('server/routes/payment-requests.ts')).toMatch(/bouton: params\.paymentUrl \? \{/);
  });
});

describe('le rappel n’envoie jamais le client vers le tableau de bord', () => {
  it('sans Stripe, le lien est vide — pas /dashboard', () => {
    // Le bouton était bien masqué, mais la phrase « Vous pouvez la régler
    // ici : {pay_url} » du corps ET le SMS portaient ce lien mort. Le client
    // final n'a aucun accès au tableau de bord du CRM.
    const code = codeSeul('server/routes/reminders-cron.ts');
    expect(code).not.toMatch(/payUrl = `\$\{publicBase\}\/dashboard`/);
    expect(code).toMatch(/let payUrl = ''/);
  });

  it('une ligne qui annonçait un lien disparu est retirée', () => {
    const avec = nettoyerLiensMorts('Facture due.\n\nVous pouvez la régler ici : https://x/pay/abc\n\nMerci');
    expect(avec).toContain('https://x/pay/abc');

    const sans = nettoyerLiensMorts('Facture due.\n\nVous pouvez la régler ici : \n\nMerci');
    expect(sans).not.toContain('régler ici');
    expect(sans).toContain('Facture due.');
    expect(sans).toContain('Merci');
  });

  it('le corps et le SMS passent tous deux par le nettoyage', () => {
    const code = codeSeul('server/routes/reminders-cron.ts');
    expect(code).toMatch(/const body = nettoyerLiensMorts\(/);
    expect(code).toMatch(/const smsBody = nettoyerLiensMorts\(/);
  });
});

describe('la langue suit l’entreprise, jamais un défaut caché', () => {
  it('la route /quotes/send-email lit la langue de l’entreprise', () => {
    // Son `select` omettait `default_language` et un cast `as never` faisait
    // taire TypeScript : elle envoyait TOUJOURS en français, alors que
    // /emails/send-quote, même document, respectait la langue.
    const code = codeSeul('server/routes/quotes.ts');
    expect(code).toContain('const company = await getCompanySettings(quote.org_id)');
    expect(code).not.toMatch(/langueEntreprise\(company as never\)/);
  });

  it('elle passe la marque complète : couleur, adresse, taxes', () => {
    const code = codeSeul('server/routes/quotes.ts');
    expect(code).toMatch(/marque: marqueDepuis\(company\)/);
  });

  it('l’accusé de formulaire suit l’entreprise, pas le membre qui l’a créé', () => {
    const code = codeSeul('server/routes/request-forms.ts');
    expect(code).toMatch(/const lang = langueEntreprise\(company\)/);
  });

  it('le lien de désabonnement suit la langue de la relance', () => {
    const src = lire('server/lib/actions/index.ts');
    expect(src).toMatch(/langueRelance === 'fr' \? 'Se désabonner/);
  });

  it('un rappel ne signe plus « Your service provider » en français', () => {
    expect(codeSeul('server/routes/reminders-cron.ts')).not.toContain('Your service provider');
  });
});
