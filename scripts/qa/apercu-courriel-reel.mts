/**
 * Aperçu d'un courriel client aux VRAIES couleurs d'une entreprise (lue en prod, lecture seule).
 *
 *   node --env-file=.env.local --import tsx scripts/qa/apercu-courriel-reel.mts --entreprise "Coquin lavage" --courriel facture [--envoyer x@y]
 *
 * Lit company_settings + tax_configs de l'entreprise par l'API de gestion Supabase
 * (read_only), rend l'exemple demandé avec cette marque, écrit le PNG, envoie si demandé.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer';
import { exemplesPour } from './courriels-exemples/clients.mts';
import { lireLiensSociaux } from '../../server/lib/socialLinks';
import type { Marque } from '../../server/lib/courriels/gabarit';

const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const entreprise = arg('--entreprise') || 'Coquin lavage';
const courriel = arg('--courriel') || 'facture';
const envoyerA = arg('--envoyer');
delete process.env.SLACK_BOT_TOKEN;

const prod = process.env.SUPABASE_PROJECT_REF_PROD!;
const query = `select cs.company_name, cs.logo_url, cs.brand_color, cs.email, cs.phone, cs.street1, cs.city, cs.province, cs.postal_code, cs.website, cs.social_links,
 (select json_agg(json_build_object('name', t.name, 'registration_number', t.registration_number)) from tax_configs t where t.org_id = o.id and t.is_active and t.registration_number is not null) as taxes
 from orgs o join company_settings cs on cs.org_id = o.id where o.name = $$${entreprise.replace(/\$/g, '')}$$ limit 1`;
const r = await fetch(`https://api.supabase.com/v1/projects/${prod}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, read_only: true }) });
const rows = await r.json() as Array<Record<string, any>>;
if (!Array.isArray(rows) || !rows[0]) throw new Error(`entreprise introuvable : ${JSON.stringify(rows).slice(0, 200)}`);
const c = rows[0];
const marque: Marque = {
  nom: c.company_name, logoUrl: c.logo_url || null, couleur: c.brand_color || null, email: c.email || null, telephone: c.phone || null,
  adresse: [c.street1, c.city, c.province, c.postal_code].filter(Boolean).join(', ') || null, siteWeb: c.website || null,
  liensSociaux: lireLiensSociaux(c.social_links), lignesTaxes: (c.taxes || []).map((t: { name: string; registration_number: string }) => `${t.name} No : ${t.registration_number}`),
};
console.log('marque :', { ...marque, logoUrl: marque.logoUrl ? 'oui' : 'non' });
let ex = exemplesPour(marque).find((e) => e.nom === courriel);
// --reelle : la facture, c'est une VRAIE facture de l'entreprise (la plus récente avec un solde), avec son vrai lien public.
if (courriel === 'facture' && process.argv.includes('--reelle')) {
  const q2 = `select i.invoice_number, i.total_cents, i.balance_cents, i.due_date, i.status, i.currency, i.view_token, c.first_name as client_prenom
    from invoices i join orgs o on o.id = i.org_id left join clients c on c.id = i.client_id
    where o.name = $$${entreprise.replace(/\$/g, '')}$$ and i.deleted_at is null and i.status in ('sent', 'partial', 'paid') and i.view_token is not null
    order by (i.balance_cents > 0) desc, i.created_at desc limit 1`;
  const r2 = await fetch(`https://api.supabase.com/v1/projects/${prod}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q2, read_only: true }) });
  const f = ((await r2.json()) as Array<Record<string, any>>)[0];
  if (!f) throw new Error('aucune facture');
  const { rendreCourrielClient, montant, dateLisible, MOTS } = await import('../../server/lib/courriels/gabarit');
  const m = MOTS.fr;
  const solde = Number(f.balance_cents || 0);
  const dejaPayee = f.status === 'paid' || solde === 0;
  const montantTexte = montant(dejaPayee ? Number(f.total_cents) : solde, f.currency || 'CAD', 'fr');
  const echeance = dateLisible(f.due_date, 'fr');
  const url = `https://lumecrm.net/invoice/${f.view_token}`;
  const prenom = String(f.client_prenom || 'Client').replace(/^\[QA\]\s*/, '');
  ex = { nom: 'facture', sujet: `Facture ${f.invoice_number} — ${montantTexte} — ${marque.nom}`, html: rendreCourrielClient({
    langue: 'fr', marque, preheader: `Facture ${f.invoice_number} — ${montantTexte}${echeance ? ` — Échéance ${echeance}` : ''}`,
    titre: `Votre facture ${f.invoice_number}`, salutation: m.bonjour(prenom),
    intro: dejaPayee ? 'Voici votre facture, réglée. Merci !' : 'Voici votre facture. Vous pouvez la consulter et la payer en ligne en un clic.',
    montant: { libelle: dejaPayee ? m.montantTotal : m.montantDu, valeur: montantTexte, sous: !dejaPayee && echeance ? `${m.echeance} : ${echeance}` : null },
    lignes: [{ libelle: m.numero, valeur: String(f.invoice_number) }, ...(echeance ? [{ libelle: m.echeance, valeur: echeance }] : []), ...(dejaPayee ? [{ libelle: m.statut, valeur: m.payee, fort: true }] : [])],
    bouton: { texte: dejaPayee ? 'Voir la facture' : m.voirFacture, url }, note: m.question,
  }) };
  console.log('facture réelle :', f.invoice_number, montantTexte, f.status, '→', url.slice(0, 40) + '…');
}
// --reelle : la soumission, c'est un VRAI devis de l'entreprise (le plus récent envoyé), avec son vrai lien public.
if (courriel === 'soumission' && process.argv.includes('--reelle')) {
  const q3 = `select q.quote_number, q.total_cents, q.valid_until, q.status, q.currency, q.view_token, q.title, c.first_name as client_prenom
    from quotes q join orgs o on o.id = q.org_id left join clients c on c.id = q.client_id
    where o.name = $$${entreprise.replace(/\$/g, '')}$$ and q.deleted_at is null and q.view_token is not null and q.status <> 'draft'
    order by q.created_at desc limit 1`;
  const r3 = await fetch(`https://api.supabase.com/v1/projects/${prod}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q3, read_only: true }) });
  const d = ((await r3.json()) as Array<Record<string, any>>)[0];
  if (!d) throw new Error('aucun devis');
  const { rendreCourrielClient, montant, dateLisible, MOTS } = await import('../../server/lib/courriels/gabarit');
  const m = MOTS.fr;
  const montantTexte = montant(Number(d.total_cents || 0), d.currency || 'CAD', 'fr');
  const validite = dateLisible(d.valid_until, 'fr');
  const url = `https://lumecrm.net/quote/${d.view_token}`;
  const prenom = String(d.client_prenom || 'Client').replace(/^\[QA\]\s*/, '');
  ex = { nom: 'soumission', sujet: `Soumission ${d.quote_number} — ${montantTexte} — ${marque.nom}`, html: rendreCourrielClient({
    langue: 'fr', marque, preheader: `Soumission ${d.quote_number} — ${montantTexte}`,
    titre: `Votre soumission ${d.quote_number}`, salutation: m.bonjour(prenom),
    intro: 'Voici votre soumission. Vous pouvez la consulter et l’approuver en ligne.',
    montant: { libelle: m.montantTotal, valeur: montantTexte, sous: validite ? `${m.valideJusquau} ${validite}` : null },
    lignes: [{ libelle: m.numero, valeur: String(d.quote_number) }, ...(d.title ? [{ libelle: 'Objet', valeur: String(d.title) }] : []), ...(validite ? [{ libelle: m.valideJusquau, valeur: validite }] : [])],
    bouton: { texte: m.voirSoumission, url }, note: m.question,
  }) };
  console.log('devis réel :', d.quote_number, montantTexte, d.status, '→', url.slice(0, 40) + '…');
}
// --reelle : la demande de paiement, c'est un VRAI lien de paiement de l'entreprise (le plus récent en attente).
if (courriel === 'paiement-demande' && process.argv.includes('--reelle')) {
  const q4 = `select pr.public_token, pr.amount_cents, pr.currency, i.invoice_number, c.first_name as client_prenom
    from payment_requests pr join invoices i on i.id = pr.invoice_id join orgs o on o.id = pr.org_id left join clients c on c.id = i.client_id
    where o.name = $$${entreprise.replace(/\$/g, '')}$$ and pr.deleted_at is null and pr.status in ('pending', 'sent') order by pr.created_at desc limit 1`;
  const r4 = await fetch(`https://api.supabase.com/v1/projects/${prod}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q4, read_only: true }) });
  const d = ((await r4.json()) as Array<Record<string, any>>)[0];
  if (!d) throw new Error('aucun lien de paiement');
  const { rendreCourrielClient, montant, MOTS } = await import('../../server/lib/courriels/gabarit');
  const m = MOTS.fr;
  const montantTexte = montant(Number(d.amount_cents || 0), d.currency || 'CAD', 'fr');
  const url = `https://lumecrm.net/pay/${d.public_token}`;
  const prenom = String(d.client_prenom || 'Client').replace(/^\[QA\]\s*/, '');
  ex = { nom: 'paiement-demande', sujet: `Paiement demandé — ${montantTexte} — facture ${d.invoice_number}`, html: rendreCourrielClient({
    langue: 'fr', marque, preheader: `${montantTexte} à payer — facture ${d.invoice_number}`, titre: 'Paiement demandé', salutation: m.bonjour(prenom),
    intro: `Un paiement de ${montantTexte} est demandé pour la facture ${d.invoice_number}. Vous pouvez payer en ligne, par carte, en moins d’une minute.`,
    montant: { libelle: m.montantDu, valeur: montantTexte, sous: `${m.facture} ${d.invoice_number}` }, bouton: { texte: m.payer(montantTexte), url },
    note: 'Paiement sécurisé par Stripe. Une question ? Répondez simplement à ce courriel.',
  }) };
  console.log('lien réel :', d.invoice_number, montantTexte, '→', url.slice(0, 36) + '…');
}
if (!ex) throw new Error(`courriel inconnu : ${courriel}`);
mkdirSync('qa-captures', { recursive: true });
writeFileSync(resolve('qa-captures', `reel-${courriel}.html`), ex.html);
const b = await puppeteer.launch({ headless: true });
const p = await b.newPage(); await p.setViewport({ width: 720, height: 900 });
await p.setContent(ex.html, { waitUntil: 'load' });
await p.screenshot({ path: resolve('qa-captures', `reel-${courriel}.png`), fullPage: true });
await b.close();
console.log(`rendu : qa-captures/reel-${courriel}.png`);
if (envoyerA) {
  const { sendEmail } = await import('../../server/lib/mailer');
  const base = process.env.EMAIL_FROM?.match(/<([^>]+)>/)?.[1] || process.env.SMTP_USER || 'noreply@lumecrm.net';
  const res = await sendEmail({ from: `${marque.nom} <${base}>`, replyTo: marque.email || undefined, to: envoyerA, subject: `[Aperçu] ${ex.sujet.replace('Vision Lavage', marque.nom)}`, html: ex.html });
  console.log('envoyé :', res.sent ? 'ok' : res.error);
}
