import { Router } from 'express';
import { requireAuthedClient, isOrgMember, getServiceClient } from '../lib/supabase';
import { parseOrgId, resolvePublicBaseUrl } from '../lib/helpers';
import { emailFrom } from '../lib/config';
import { sendEmail, isMailerConfigured } from '../lib/mailer';
import {
  validate,
  sendInvoiceEmailSchema,
  sendQuoteEmailSchema,
  sendCustomEmailSchema,
} from '../lib/validation';
import { eventBus } from '../lib/eventBus';
import { isOrgAdminOrOwner } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { logger } from '../lib/logger';
import { getCompanyBranding } from '../lib/companyBranding';
import { lireLiensSociaux, type SocialLinks } from '../lib/socialLinks';
import { expediteurDe } from '../lib/courriels/domaines';
import { rendreCourrielClient, montant as montantLisible, dateLisible, langueDe, MOTS, type Marque, type Langue } from '../lib/courriels/gabarit';
import { texteDuCourriel, assainirHtmlCourriel } from '../lib/courriels/modeles';
import { remplacerParExemples } from '../../src/lib/variablesCourriel';

const router = Router();

// Simple HTML sanitizer — strips script tags and event handlers
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript\s*:/gi, '');
}

// ── Helpers ──

function ensureMailer() {
  if (!isMailerConfigured()) throw Object.assign(new Error('SMTP is not configured.'), { status: 503 });
}

/* Ces deux helpers alimentent les VARIABLES des modèles ({invoice_amount},
   {due_date}) : le texte que l'entreprise écrit elle-même. Ils étaient figés
   sur `en-CA`, alors que le corps structuré du même courriel passe par
   `montantLisible`/`dateLisible`, qui suivent la langue. Un courriel français
   affichait donc « $1,220.17 » dans la phrase de l'entreprise et
   « 1 220,17 $ » dans la carte, à trois centimètres d'écart. */
function formatCurrency(cents: number, currency = 'CAD', langue: Langue = 'fr') {
  return montantLisible(cents, currency, langue);
}

function formatDate(dateStr: string | null | undefined, langue: Langue = 'fr') {
  if (!dateStr) return '';
  // Une date seule (« 2026-09-04 ») est affichée telle quelle, dans le fuseau
  // de l'entreprise — pas convertie via minuit UTC, qui la ferait reculer
  // d'un jour si le serveur tournait un jour ailleurs qu'en UTC.
  const seule = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const d = seule
    ? new Date(Date.UTC(Number(seule[1]), Number(seule[2]) - 1, Number(seule[3]), 12))
    : new Date(dateStr);
  return d.toLocaleDateString(langue === 'fr' ? 'fr-CA' : 'en-CA', { year: 'numeric', month: 'long', day: 'numeric', ...(seule ? { timeZone: 'UTC' } : {}) });
}

export interface CompanyInfo {
  company_name?: string | null;
  company_email?: string | null;
  company_phone?: string | null;
  company_address?: string | null;
  company_logo_url?: string | null;
  tax_registration_lines?: string[];
  /** Réseaux sociaux — liens texte au bas du courriel. */
  social_links?: SocialLinks;
  /** Couleur de marque (#rrggbb), bouton et bande du courriel. */
  brand_color?: string | null;
  /** Langue de l'entreprise : celle de ses courriels à ses clients. */
  default_language?: string | null;
  website?: string | null;
}

export async function getCompanySettings(orgId: string): Promise<CompanyInfo> {
  try {
    const serviceClient = getServiceClient();
    // Tolère un schéma en retard sur le code (colonne récente absente) :
    // sans cela, un seul champ inconnu vidait TOUT le branding du courriel.
    const data = await getCompanyBranding(
      serviceClient,
      orgId,
      'company_name, email, phone, street1, city, province, postal_code, logo_url, social_links, brand_color, default_language, website',
    );
    if (!data) return {};
    const address = [data.street1, data.city, data.province, data.postal_code].filter(Boolean).join(', ') || null;

    // Fetch tax registration numbers from active tax configs
    let taxLines: string[] = [];
    try {
      const { data: taxes } = await serviceClient
        .from('tax_configs')
        .select('name, registration_number')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .not('registration_number', 'is', null);
      taxLines = (taxes || [])
        .filter((t: any) => t.registration_number)
        .map((t: any) => `${t.name} No: ${t.registration_number}`);
    } catch { /* registration_number column may not exist yet */ }

    return {
      company_name: data.company_name || null,
      company_email: data.email || null,
      company_phone: data.phone || null,
      company_address: address,
      company_logo_url: data.logo_url || null,
      tax_registration_lines: taxLines,
      social_links: lireLiensSociaux(data.social_links),
      brand_color: data.brand_color || null,
      default_language: data.default_language || null,
      website: data.website || null,
    };
  } catch {
    return {};
  }
}

/** La marque d'une entreprise telle que le gabarit la porte (logo, couleur, coordonnées, réseaux, taxes). */
export function marqueDepuis(company: CompanyInfo): Marque {
  return {
    nom: company.company_name || '',
    logoUrl: company.company_logo_url || null,
    couleur: company.brand_color || null,
    email: company.company_email || null,
    telephone: company.company_phone || null,
    adresse: company.company_address || null,
    siteWeb: company.website || null,
    liensSociaux: company.social_links || null,
    lignesTaxes: company.tax_registration_lines || null,
  };
}

/** La langue des courriels d'une entreprise à ses clients : la sienne (company_settings.default_language), fr par défaut. */
export function langueEntreprise(company: CompanyInfo): Langue {
  return langueDe(company.default_language);
}

/**
 * Enveloppe un contenu libre (modèle de l'entreprise, courriel personnalisé,
 * formulaire) dans le gabarit commun (server/lib/courriels/gabarit.ts) :
 * bande de couleur, logo, pied aux coordonnées de l'entreprise. Les routes
 * facture / soumission / contrat utilisent directement rendreCourrielClient
 * avec un contenu structuré (montant, lignes, bouton).
 */
/**
 * L'enveloppe commune d'un courriel libre (automatisation, message manuel).
 *
 * `bouton` est optionnel et récent : les 26 relances automatiques partaient
 * sans aucun bouton, et demandaient toutes de « répondre à ce courriel ». Une
 * relance de soumission sans bouton « Accepter » oblige le client à écrire un
 * message au lieu de cliquer une fois. Les appels qui n'en passent pas se
 * comportent exactement comme avant.
 */
export function buildEmailLayout(
  company: CompanyInfo,
  bodyHtml: string,
  bouton?: { texte: string; url: string } | null,
) {
  return rendreCourrielClient({
    langue: langueEntreprise(company),
    marque: marqueDepuis(company),
    corpsHtml: bodyHtml,
    bouton: bouton ?? null,
    signature: null,
  });
}

// Branded sender: keep the platform's VERIFIED sending address (deliverability),
// but show the company's name and route replies to the company's own inbox. So a
// client sees "From: {Company}" and replies land straight in the business's email
// — the "connect your email" experience with zero per-company SMTP/DNS setup.
// (Each org's email lives in company_settings; no per-tenant config needed.)
/**
 * La partie locale porte le nom de l'entreprise, pas `noreply` (2026-09-24).
 *
 * L'adresse affichée était « Coquin lavage <noreply@lumecrm.net> » : en
 * dépliant l'en-tête, le client de Coquin lavage lisait le nom de la
 * plateforme. Le domaine doit rester `lumecrm.net` — c'est lui qui est
 * vérifié chez SES, et en changer ferait rejeter l'envoi — mais la partie
 * locale, elle, est libre : SES accepte n'importe quel préfixe sur un
 * domaine vérifié. « Coquin lavage <coquin-lavage@lumecrm.net> » ne cache
 * pas la plateforme, mais ne la met plus en avant.
 *
 * Tant que l'entreprise n'a pas vérifié SON domaine (`senderForOrg`), c'est
 * le mieux qu'on puisse faire sans casser la délivrabilité.
 */
export function prefixeDepuisNom(nom: string | null | undefined): string | null {
  const base = String(nom ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  // Un nom qui ne laisse aucun caractère utilisable (idéogrammes, emoji) :
  // on garde le préfixe d'origine plutôt qu'une adresse vide ou bancale.
  return base.length >= 2 ? base : null;
}

export function senderFor(company: CompanyInfo): { from: string; replyTo?: string } {
  const baseAddr = emailFrom.match(/<([^>]+)>/)?.[1] || process.env.SMTP_USER || 'noreply@lume.crm';
  // Sans nom d'entreprise, l'expéditeur reste anonyme plutôt que de
  // s'annoncer « Lume » au client d'une autre entreprise.
  const name = company.company_name || '';
  const domaine = baseAddr.split('@')[1];
  const prefixe = prefixeDepuisNom(company.company_name);
  const adresse = prefixe && domaine ? `${prefixe}@${domaine}` : baseAddr;
  return {
    from: `${name} <${adresse}>`,
    replyTo: company.company_email || undefined,
  };
}

/**
 * Expéditeur d'une org (2026-09-17) : si elle a fait vérifier SON domaine
 * (Paramètres entreprise → « Envoyer depuis mon adresse », table
 * org_sending_domains via Resend), le courriel part de
 * « {Entreprise} <facturation@sondomaine.ca> » ; sinon senderFor() tel quel
 * (adresse vérifiée de la plateforme, Reply-To vers l'entreprise). Le Reply-To
 * ne change pas dans les deux cas. La consultation du domaine est en cache
 * 5 min par org (server/lib/courriels/domaines.ts) et n'échoue jamais :
 * toute erreur retombe sur l'expéditeur de la plateforme.
 */
export async function senderForOrg(orgId: string, company: CompanyInfo): Promise<{ from: string; replyTo?: string }> {
  const plateforme = senderFor(company);
  try {
    const propre = await expediteurDe(getServiceClient(), orgId, company);
    return propre ? { from: propre.from, replyTo: plateforme.replyTo } : plateforme;
  } catch (err: any) {
    logger.error('[emails/senderForOrg] domaine propre illisible, expéditeur plateforme', { orgId, error: err?.message || String(err) });
    return plateforme;
  }
}

// ── POST /api/emails/send-invoice ──

router.post('/emails/send-invoice', validate(sendInvoiceEmailSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { client, orgId } = auth;
    const invoiceId = String(req.body.invoiceId).trim();
    const emailTemplateId = req.body.emailTemplateId ? String(req.body.emailTemplateId).trim() : null;
    const customSubject = req.body.subject ? sanitizeHtml(String(req.body.subject).trim()) : null;
    const customBody = req.body.body ? sanitizeHtml(String(req.body.body).trim()) : null;

    const member = await isOrgMember(client, auth.user.id, orgId);
    if (!member) return res.status(403).json({ error: 'Forbidden.' });

    // Fetch invoice
    const { data: invoice, error: invoiceError } = await client
      .from('invoices')
      .select('id, invoice_number, total_cents, balance_cents, currency, due_date, status, client_id, view_token, created_at, sent_at')
      .eq('id', invoiceId)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .maybeSingle();

    if (invoiceError || !invoice) return res.status(404).json({ error: 'Invoice not found.' });

    /* Ce qu'on facture, ligne par ligne.

       Le courriel ne montrait que le TOTAL. Un client qui reçoit 1 220,17 $
       veut savoir pour quoi — lavage de vitres, gouttières, combien d'heures.
       Sans ce détail, le courriel ressemble à une notification de paiement
       plutôt qu'à une facture, et il faut cliquer pour comprendre ce qu'on
       doit. C'est le genre de manque qui pousse une entreprise à réécrire le
       modèle, alors qu'il devrait suffire tel quel.

       Best-effort : un échec de lecture donne un courriel sans détail, comme
       avant, plutôt qu'une facture qui ne part pas. */
    const { data: lignesFacture, error: erreurLignes } = await client
      .from('invoice_items')
      .select('description, title, qty, line_total_cents, sort_order')
      .eq('invoice_id', invoiceId)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .order('sort_order', { ascending: true })
      .limit(20);
    if (erreurLignes) logger.warn('[emails/send-invoice] détail des lignes illisible', { error: erreurLignes.message, invoiceId });

    // Anti double-clic : si la facture vient d'être envoyée (< 10 s), on refuse
    // le renvoi immédiat — c'est un double-clic ou un retry réseau, pas un vrai
    // renvoi. Un renvoi volontaire plus tard passe normalement.
    if (invoice.sent_at && Date.now() - new Date(invoice.sent_at).getTime() < 10_000) {
      return res.status(409).json({ error: 'Cette facture vient d’être envoyée. Réessaie dans un instant si besoin.' });
    }

    // Fetch client (exclude archived)
    const { data: clientData } = await client
      .from('clients')
      .select('id, first_name, last_name, email')
      .eq('id', invoice.client_id)
      .is('deleted_at', null)
      .maybeSingle();

    if (!clientData?.email) return res.status(400).json({ error: 'Client has no email address.' });

    const clientName = `${clientData.first_name || ''} ${clientData.last_name || ''}`.trim() || 'Client';
    const company = await getCompanySettings(orgId);
    const langue = langueEntreprise(company);
    /* UN SEUL montant. `amountStr` prenait le TOTAL et partait dans l'objet et
       dans {invoice_amount} ; `montantTexte`, plus bas, prenait le SOLDE et
       partait dans la carte. Sur une facture partiellement payée, le client
       lisait deux montants différents dans le même courriel. C'est le solde
       qui compte : c'est ce qu'il doit payer. */
    const amountStr = formatCurrency(invoice.balance_cents || invoice.total_cents || 0, invoice.currency || 'CAD', langue);
    const baseUrl = resolvePublicBaseUrl(req);
    // Page publique de facture (audit QA 2026-09-09 n°1) — /q/ redirige encore.
    const viewUrl = invoice.view_token ? `${baseUrl}/invoice/${invoice.view_token}` : null;

    // Resolve email subject and body
    let emailSubject = customSubject || `Invoice ${invoice.invoice_number || ''} — ${amountStr}`;
    let bodyHtml = customBody || '';
    void amountStr;

    const templateVars: Record<string, string> = {
      client_name: clientName,
      company_name: company.company_name || '',
      invoice_number: invoice.invoice_number || '',
      invoice_amount: amountStr,
      due_date: formatDate(invoice.due_date, langue),
      payment_link: viewUrl || '',
    };

    // Try to load email template if provided or use default
    if (emailTemplateId) {
      const serviceClient = getServiceClient();
      const { data: tpl } = await serviceClient
        .from('email_templates')
        .select('subject, body')
        .eq('id', emailTemplateId)
        .eq('org_id', orgId) // tenant guard — don't render another org's template
        .maybeSingle();
      if (tpl) {
        emailSubject = customSubject || tpl.subject.replace(/\{(\w+)\}/g, (_: string, k: string) => templateVars[k] ?? '');
        bodyHtml = customBody || tpl.body.replace(/\{(\w+)\}/g, (_: string, k: string) => templateVars[k] ?? '');
      }
    }

    /* Le modèle de l'entreprise, quand aucun `emailTemplateId` n'est passé.
       C'est LE branchement qui manquait : `is_default` n'était jamais lu, donc
       les modèles écrits par les entreprises ne servaient à rien (aucune page
       ne passe d'`emailTemplateId`).

       Son texte ne remplace PAS le courriel : il part dans `corpsHtml` du
       gabarit, donc la carte du montant, le bouton « payer », les numéros de
       taxes et le pied restent posés par nous. Une entreprise ne peut pas
       écrire un modèle qui empêche son client de payer.

       Sans modèle → `null` → le courriel sort EXACTEMENT comme aujourd'hui. */
    const modeleOrg = (!emailTemplateId && !customBody)
      ? await texteDuCourriel(orgId, 'invoice_sent', templateVars, undefined,
        { invoice: invoice.id, client: invoice.client_id ?? null })
      : null;

    // If no custom body and no template, use default layout
    const m = MOTS[langue];
    const numero = invoice.invoice_number || invoiceId.slice(0, 8);
    const montantTexte = montantLisible(invoice.balance_cents || invoice.total_cents || 0, invoice.currency || 'CAD', langue);
    const echeance = dateLisible(invoice.due_date, langue);
    const dejaPayee = (invoice.status || '') === 'paid' || Number(invoice.balance_cents ?? 1) === 0;
    /* L'objet ne porte PAS le nom de l'entreprise.

       Je l'y avais mis en tête, croyant qu'il disparaissait à la coupure de
       Gmail. Un test l'a rattrapé, et la capture d'un vrai courriel le
       confirme : Gmail affiche déjà « Coquin lavage » en gras comme
       EXPÉDITEUR, juste au-dessus de l'objet. Le répéter le dit deux fois sur
       la même ligne, et vole la place du montant. */
    if (!customSubject) emailSubject = modeleOrg?.sujet || `${m.facture} ${numero} — ${montantTexte}`;
    // Sans modèle ni texte personnalisé : le courriel structuré (montant en carte, échéance, un bouton).
    const htmlStructure = !bodyHtml ? rendreCourrielClient({
      langue,
      marque: marqueDepuis(company),
      preheader: dejaPayee ? `${m.facture} ${numero} — ${m.payee}` : `${m.facture} ${numero} — ${montantTexte}${echeance ? ` — ${m.echeance} ${echeance}` : ''}`,
      titre: langue === 'fr' ? `Votre facture ${numero}` : `Your invoice ${numero}`,
      // Le modèle de l'entreprise porte sa propre salutation et son propre
      // texte : on n'ajoute pas les nôtres par-dessus, on les remplace.
      salutation: modeleOrg ? null : m.bonjour(clientName),
      intro: modeleOrg ? null : (dejaPayee
        ? (langue === 'fr' ? 'Voici votre facture, réglée. Merci !' : 'Here is your invoice, paid in full. Thank you!')
        : (langue === 'fr' ? 'Les travaux sont terminés — merci de votre confiance. Voici votre facture, détail ci-dessous.' : 'The work is done — thank you for your trust. Here is your invoice, details below.')),
      corpsHtml: modeleOrg?.corpsHtml ?? null,
      montant: { libelle: dejaPayee ? m.montantTotal : m.montantDu, valeur: montantTexte, sous: !dejaPayee && echeance ? `${m.echeance} : ${echeance}` : null },
      /* Ce qu'on facture d'abord, les métadonnées ensuite.

         L'ordre compte : le client cherche « pour quoi », pas « quel
         numéro ». Le numéro et l'échéance restent, en dessous, parce qu'un
         document comptable les porte — mais ils ne sont plus tout ce qu'il y
         a à lire.

         La quantité n'apparaît que si elle n'est pas 1 : « Lavage de vitres
         × 1 » n'apprend rien et alourdit la ligne. */
      lignes: [
        ...(lignesFacture ?? []).map((l) => {
          const nom = String(l.title || l.description || '').trim();
          const q = Number(l.qty ?? 1);
          return {
            libelle: q > 1 ? `${nom} × ${q}` : nom,
            valeur: montantLisible(Number(l.line_total_cents ?? 0), invoice.currency || 'CAD', langue),
          };
        }).filter((l) => l.libelle),
        { libelle: m.numero, valeur: numero },
        ...(echeance ? [{ libelle: m.echeance, valeur: echeance }] : []),
        ...(dejaPayee ? [{ libelle: m.statut, valeur: m.payee, fort: true }] : []),
      ],
      bouton: viewUrl ? { texte: dejaPayee ? (langue === 'fr' ? 'Voir la facture' : 'View invoice') : m.voirFacture, url: viewUrl } : null,
      note: m.question,
    }) : null;
    if (!bodyHtml && !htmlStructure) {
      bodyHtml = `
<h2 style="margin:0 0 8px;font-size:20px;color:#1a1a2e;">Invoice ${invoice.invoice_number || ''}</h2>
<p style="margin:0 0 24px;color:#6b7280;">Hello ${clientName},</p>
<p style="margin:0 0 16px;color:#374151;">
  Please find below the details for your invoice.
</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
<tr style="background-color:#f9fafb;">
  <td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600;">Invoice #</td>
  <td style="padding:12px 16px;font-size:14px;color:#1a1a2e;text-align:right;">${invoice.invoice_number || invoiceId.slice(0, 8)}</td>
</tr>
<tr>
  <td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600;border-top:1px solid #e5e7eb;">Amount</td>
  <td style="padding:12px 16px;font-size:14px;color:#1a1a2e;text-align:right;border-top:1px solid #e5e7eb;font-weight:700;">${amountStr}</td>
</tr>
<tr>
  <td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600;border-top:1px solid #e5e7eb;">Due Date</td>
  <td style="padding:12px 16px;font-size:14px;color:#1a1a2e;text-align:right;border-top:1px solid #e5e7eb;">${formatDate(invoice.due_date)}</td>
</tr>
<tr>
  <td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600;border-top:1px solid #e5e7eb;">Status</td>
  <td style="padding:12px 16px;font-size:14px;color:#1a1a2e;text-align:right;border-top:1px solid #e5e7eb;">${(invoice.status || 'pending').charAt(0).toUpperCase() + (invoice.status || 'pending').slice(1)}</td>
</tr>
</table>

${viewUrl ? `
<div style="text-align:center;margin-bottom:16px;">
  <a href="${viewUrl}" style="display:inline-block;padding:12px 32px;background-color:#4f46e5;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">
    View Invoice
  </a>
</div>
` : ''}

<p style="margin:0;font-size:13px;color:#9ca3af;">
  If you have any questions, please reply to this email or contact us directly.
</p>`;
    }

    ensureMailer();
    const emailResult = await sendEmail({
      ...(await senderForOrg(orgId, company)),
      to: clientData.email,
      subject: emailSubject,
      html: htmlStructure ?? buildEmailLayout(company, bodyHtml),
      suivi: { orgId, entityType: 'invoice', entityId: invoiceId },
    });

    if (!emailResult.sent) throw new Error(emailResult.error || 'Email send failed');

    // Update invoice status to sent (also set issued_at if not already set)
    // Le courriel est déjà parti : on ne peut plus répondre en erreur sans
    // pousser l'utilisateur à renvoyer, donc on journalise fort.
    const now = new Date().toISOString();
    // Le statut DOIT suivre l'envoi. Sans lui, une facture partie chez le
    // client restait « brouillon » : absente des impayés, absente des
    // relances, absente du chiffre d'affaires à recouvrer.
    // Constat en production le 2026-09-03 : 4 factures dans ce cas — 919 $
    // envoyés au client mais invisibles côté Lume.
    // On ne touche QU'AUX brouillons : une facture déjà payée, partielle ou
    // annulée garde son statut, un renvoi de courriel ne doit pas la rouvrir.
    const { error: stampError } = await client.from('invoices').update({
      ...(invoice.status === 'draft' ? { status: 'sent', issued_at: now } : {}),
      sent_at: now,
    }).eq('id', invoiceId);
    if (stampError) {
      console.error(`[emails/send-invoice] invoice ${invoiceId} sent but sent_at not saved (org ${orgId}):`, stampError.message);
    }

    // Log send event for audit trail
    const serviceClient = getServiceClient();
    const { error: sendEventError } = await serviceClient.from('invoice_send_events').insert({
      invoice_id: invoiceId,
      org_id: orgId,
      event_type: invoice.status === 'draft' ? 'sent' : 'resent',
      recipient_email: clientData.email,
      channel: 'email',
      metadata: { subject: emailSubject, email_template_id: emailTemplateId },
    });
    if (sendEventError) {
      console.error(`[emails/send-invoice] invoice_send_events insert failed (invoice ${invoiceId}, org ${orgId}):`, sendEventError.message);
    }

    // Journal d'activité : UNE SEULE écriture, via l'event bus (source unique).
    // L'insert manuel dans activity_log qui existait ici faisait DOUBLE emploi
    // avec le bus (qui écrit lui aussi 'invoice_sent' dans activity_log), d'où
    // deux lignes « Invoice sent » par envoi. On garde uniquement l'emit,
    // enrichi des métadonnées qui étaient dans l'insert manuel.
    eventBus.emit('invoice.sent', {
      orgId,
      entityType: 'invoice',
      entityId: invoiceId,
      actorId: auth.user.id,
      relatedEntityType: invoice.client_id ? 'client' : undefined,
      relatedEntityId: invoice.client_id || undefined,
      metadata: {
        invoice_number: invoice.invoice_number,
        client_name: clientName,
        client_id: invoice.client_id || null,
        subject_sent: emailSubject,
        email_template_id: emailTemplateId,
        to_email: clientData.email,
      },
    });

    return res.json({ ok: true, emailId: emailResult?.messageId || null });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to send invoice email.', '[emails/send-invoice]');
  }
});

// ── POST /api/emails/send-quote ──

router.post('/emails/send-quote', validate(sendQuoteEmailSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { client, orgId } = auth;
    const invoiceId = String(req.body.invoiceId).trim();

    const member = await isOrgMember(client, auth.user.id, orgId);
    if (!member) return res.status(403).json({ error: 'Forbidden.' });

    // Fetch quote (invoices table, quotes are stored as invoices)
    const { data: quote, error: quoteError } = await client
      .from('invoices')
      .select('id, invoice_number, total_cents, balance_cents, currency, due_date, status, client_id, view_token, created_at, sent_at')
      .eq('id', invoiceId)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .maybeSingle();

    if (quoteError || !quote) return res.status(404).json({ error: 'Quote not found.' });

    // Anti double-clic (voir send-invoice) : refuse un renvoi < 10 s.
    if (quote.sent_at && Date.now() - new Date(quote.sent_at).getTime() < 10_000) {
      return res.status(409).json({ error: 'Ce devis vient d’être envoyé. Réessaie dans un instant si besoin.' });
    }

    // Fetch client (exclude archived)
    const { data: clientData } = await client
      .from('clients')
      .select('id, first_name, last_name, email')
      .eq('id', quote.client_id)
      .is('deleted_at', null)
      .maybeSingle();

    if (!clientData?.email) return res.status(400).json({ error: 'Client has no email address.' });

    const clientName = `${clientData.first_name || ''} ${clientData.last_name || ''}`.trim() || 'Client';
    const company = await getCompanySettings(orgId);
    const langue = langueEntreprise(company);
    const amountStr = formatCurrency(quote.total_cents || quote.balance_cents || 0, quote.currency || 'CAD', langue);
    const baseUrl = resolvePublicBaseUrl(req);
    /* `/quote/`, pas `/q/`.

       `/q/:token` a été reconverti en redirection de FACTURES lors de l'audit
       du 2026-09-09 : il cherche le jeton dans `invoices`. Un jeton de
       soumission n'y est pas — la route répondait donc « Invoice not found »,
       un 404 pur, sur le bouton de CHAQUE soumission envoyée.

       Vérifié en prod avant correction : /q/<jeton de devis> → 404,
       /quote/<le même> → 200. La route mobile (`send-mobile-quote`) utilisait
       déjà le bon chemin ; c'est ce qui a masqué le défaut. */
    const viewUrl = quote.view_token ? `${baseUrl}/quote/${quote.view_token}` : null;

    const m = MOTS[langue];
    const numero = quote.invoice_number || invoiceId.slice(0, 8);
    const montantTexte = montantLisible(quote.total_cents || quote.balance_cents || 0, quote.currency || 'CAD', langue);
    const validite = dateLisible(quote.due_date, langue);
    // Le modèle « quote_sent » de l'entreprise, s'il existe (sinon null, et le
    // courriel sort exactement comme avant). Comme pour la facture, son texte
    // se pose dans `corpsHtml` : le montant, le bouton « Voir la soumission »,
    // les taxes et le pied restent les nôtres.
    const modeleOrg = await texteDuCourriel(orgId, 'quote_sent', {
      client_name: clientName,
      company_name: company.company_name || '',
      quote_number: numero,
      quote_amount: montantTexte,
      valid_until: validite,
      quote_link: viewUrl || '',
    });
    const html = rendreCourrielClient({
      langue,
      marque: marqueDepuis(company),
      preheader: `${m.soumission} ${numero} — ${montantTexte}`,
      titre: langue === 'fr' ? `Votre soumission ${numero}` : `Your quote ${numero}`,
      salutation: modeleOrg ? null : m.bonjour(clientName),
      intro: modeleOrg ? null : (langue === 'fr' ? 'Voici notre proposition pour vos travaux. Le détail est ci-dessous ; approuvez-la quand vous êtes prêt.' : 'Here is our proposal for your work. The details are below — approve it when you are ready.'),
      corpsHtml: modeleOrg?.corpsHtml ?? null,
      montant: { libelle: m.montantTotal, valeur: montantTexte, sous: validite ? `${m.valideJusquau} ${validite}` : null },
      lignes: [{ libelle: m.numero, valeur: numero }, ...(validite ? [{ libelle: m.valideJusquau, valeur: validite }] : [])],
      bouton: viewUrl ? { texte: m.voirSoumission, url: viewUrl } : null,
      note: m.question,
    });

    ensureMailer();
    const emailResult = await sendEmail({
      ...(await senderForOrg(orgId, company)),
      to: clientData.email,
      subject: modeleOrg?.sujet || `${m.soumission} ${numero} — ${montantTexte}${company.company_name ? ` — ${company.company_name}` : ''}`,
      html,
      suivi: { orgId, entityType: 'invoice', entityId: quote.id },
    });

    if (!emailResult.sent) throw new Error(emailResult.error || 'Email send failed');

    // Update status to sent
    const { error: statusError } = await client
      .from('invoices')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', invoiceId);
    if (statusError) {
      console.error(`[emails/send-quote] quote ${invoiceId} sent but status not saved (org ${orgId}):`, statusError.message);
    }

    // Emit estimate.sent event
    eventBus.emit('estimate.sent', {
      orgId,
      entityType: 'invoice',
      entityId: invoiceId,
      actorId: auth.user.id,
      relatedEntityType: (quote as any).client_id ? 'client' : undefined,
      relatedEntityId: (quote as any).client_id || undefined,
      metadata: { invoice_number: (quote as any).invoice_number, client_id: (quote as any).client_id || null },
    });

    return res.json({ ok: true, emailId: emailResult?.messageId || null });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to send quote email.', '[emails/send-quote]');
  }
});

// ── POST /api/emails/send-mobile-quote ──
// Mobile quotes live in the standalone `quotes` table (not `invoices` like the
// web). This emails such a quote to its client from the org's mailer, with a
// link to the public /quote/:token view to approve.

router.post('/emails/send-mobile-quote', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { client, orgId } = auth;
    const quoteId = String(req.body?.quoteId || '').trim();
    if (!quoteId) return res.status(400).json({ error: 'quoteId is required.' });

    const member = await isOrgMember(client, auth.user.id, orgId);
    if (!member) return res.status(403).json({ error: 'Forbidden.' });

    const { data: quote, error: qErr } = await client
      .from('quotes')
      .select('id, quote_number, total_cents, currency, valid_until, status, client_id, view_token')
      .eq('id', quoteId)
      .eq('org_id', orgId)
      .maybeSingle();
    if (qErr || !quote) return res.status(404).json({ error: 'Quote not found.' });

    const { data: clientData } = await client
      .from('clients')
      .select('id, first_name, last_name, email')
      .eq('id', quote.client_id)
      .is('deleted_at', null)
      .maybeSingle();
    if (!clientData?.email) return res.status(400).json({ error: 'Client has no email address.' });

    const clientName = `${clientData.first_name || ''} ${clientData.last_name || ''}`.trim() || 'Client';
    const company = await getCompanySettings(orgId);
    const langue = langueEntreprise(company);
    const amountStr = formatCurrency(quote.total_cents || 0, quote.currency || 'CAD', langue);
    const baseUrl = resolvePublicBaseUrl(req);
    const viewUrl = quote.view_token ? `${baseUrl}/quote/${quote.view_token}` : null;

    const m = MOTS[langue];
    const numero = quote.quote_number || '';
    const montantTexte = montantLisible(quote.total_cents || 0, quote.currency || 'CAD', langue);
    const validite = dateLisible(quote.valid_until, langue);
    /* Cette route n'appelait PAS les modèles : une entreprise qui réécrivait
       son courriel de soumission voyait son texte partir depuis le bureau, et
       le texte générique partir depuis le mobile. Deux clients, deux courriels
       pour le même geste, sans explication possible. */
    const modeleOrg = await texteDuCourriel(orgId, 'quote_sent', {
      client_name: clientName,
      company_name: company.company_name || '',
      quote_number: numero,
      quote_amount: montantTexte,
      valid_until: validite,
      quote_link: viewUrl || '',
    }, undefined, { quote: quote.id, client: quote.client_id ?? null });
    const html = rendreCourrielClient({
      langue,
      marque: marqueDepuis(company),
      preheader: `${m.soumission} ${numero} — ${montantTexte}`,
      titre: langue === 'fr' ? `Votre soumission ${numero}` : `Your quote ${numero}`,
      salutation: modeleOrg ? null : m.bonjour(clientName),
      intro: modeleOrg ? null : (langue === 'fr' ? 'Voici notre proposition pour vos travaux. Le détail est ci-dessous ; approuvez-la quand vous êtes prêt.' : 'Here is our proposal for your work. The details are below — approve it when you are ready.'),
      corpsHtml: modeleOrg?.corpsHtml ?? null,
      montant: { libelle: m.montantTotal, valeur: montantTexte, sous: validite ? `${m.valideJusquau} ${validite}` : null },
      lignes: [{ libelle: m.numero, valeur: numero }, ...(validite ? [{ libelle: m.valideJusquau, valeur: validite }] : [])],
      bouton: viewUrl ? { texte: m.voirSoumission, url: viewUrl } : null,
      note: m.question,
    });

    ensureMailer();
    const emailResult = await sendEmail({
      ...(await senderForOrg(orgId, company)),
      to: clientData.email,
      subject: modeleOrg?.sujet || `${m.soumission} ${numero} — ${montantTexte}${company.company_name ? ` — ${company.company_name}` : ''}`,
      html,
      suivi: { orgId, entityType: 'quote', entityId: quoteId },
    });
    if (!emailResult.sent) throw new Error(emailResult.error || 'Email send failed');

    const { error: statusError } = await client
      .from('quotes')
      .update({ status: 'awaiting_response' })
      .eq('id', quoteId)
      .in('status', ['draft', 'changes_requested']);
    if (statusError) {
      console.error(`[emails/send-mobile-quote] quote ${quoteId} sent but status not saved (org ${orgId}):`, statusError.message);
    }

    return res.json({ ok: true, emailId: emailResult?.messageId || null });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to send quote email.', '[emails/send-mobile-quote]');
  }
});

// ── POST /api/emails/send-custom ──

router.post('/emails/send-custom', validate(sendCustomEmailSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const member = await isOrgMember(auth.client, auth.user.id, auth.orgId);
    if (!member) return res.status(403).json({ error: 'Forbidden.' });

    // Custom emails require admin/owner role
    const canSend = await isOrgAdminOrOwner(auth.client, auth.user.id, auth.orgId);
    if (!canSend) return res.status(403).json({ error: 'Only admin or owner can send custom emails.' });

    const { to, subject, html } = req.body;
    const company = await getCompanySettings(auth.orgId);

    ensureMailer();
    const emailResult = await sendEmail({
      ...(await senderForOrg(auth.orgId, company)),
      to,
      subject: sanitizeHtml(subject),
      html: buildEmailLayout(company, sanitizeHtml(html)),
      suivi: { orgId: auth.orgId, entityType: 'message' },
    });

    if (!emailResult.sent) throw new Error(emailResult.error || 'Email send failed');

    return res.json({ ok: true, emailId: emailResult?.messageId || null });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to send email.', '[emails/send-custom]');
  }
});

/**
 * L'aperçu d'un courriel, rendu par le VRAI gabarit.
 * ──────────────────────────────────────────────────
 * Pourquoi cette route existe : `EmailPreviewEditor` redessinait le courriel
 * en React — le fond, le logo, le pied — avec les couleurs écrites en dur.
 * Deux sources de vérité pour une même chose, donc deux vérités : le jour où
 * le gabarit serveur est passé du ciel bleu au gris neutre, l'aperçu a
 * continué d'afficher un décor que plus personne ne recevait. Une entreprise
 * validait son texte sur une image fausse.
 *
 * Ici, le serveur rend exactement ce qu'il enverrait, et l'app l'affiche dans
 * une `iframe`. L'écart ne peut plus revenir : il n'y a plus qu'un rendu.
 *
 * Lecture seule : aucun envoi, aucune écriture. Le corps arrive de l'éditeur,
 * donc il est assaini comme à l'enregistrement — une entreprise ne doit pas
 * pouvoir exécuter du script dans notre app en tapant dans son propre champ.
 */
router.post('/emails/apercu', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const member = await isOrgMember(auth.client, auth.user.id, auth.orgId);
    if (!member) return res.status(403).json({ error: 'Forbidden.' });

    const corps = typeof req.body?.corpsHtml === 'string' ? req.body.corpsHtml : '';
    if (corps.length > 200_000) return res.status(400).json({ error: 'Body too large.' });

    const company = await getCompanySettings(auth.orgId);

    /* Les variables remplacées par leurs exemples, comme à l'envoi.

       Sans ça, l'aperçu affichait « Bonjour [client_name] » — exactement le
       genre d'écart que cette route devait supprimer. On rend donc ce que le
       client verra : un nom, un montant, une date.

       `remplacerParExemples` gère les deux syntaxes, comme `applyTemplate`. */
    const type = typeof req.body?.type === 'string' ? req.body.type : undefined;
    const avecExemples = (t: string) => remplacerParExemples(t, type, langueEntreprise(company) === 'fr');

    /* Un bouton d'exemple : le gabarit en pose un à l'envoi, et sans lui
       l'aperçu montrerait un courriel plus court que le vrai — l'entreprise
       écrirait « cliquez sur le lien ci-dessous » en croyant qu'il manque. */
    const fr = langueEntreprise(company) === 'fr';
    const html = rendreCourrielClient({
      langue: langueEntreprise(company),
      marque: marqueDepuis(company),
      corpsHtml: avecExemples(assainirHtmlCourriel(corps)),
      montant: { libelle: fr ? 'Montant à payer' : 'Amount due', valeur: fr ? '1 220,17 $' : '$1,220.17' },
      bouton: {
        texte: fr ? 'Voir et payer' : 'View and pay',
        url: 'https://lumecrm.net/',
        sousBouton: fr ? 'Carte de crédit · aucun compte à créer' : 'Credit card · no account needed',
      },
      signature: null,
    });

    /* L'envoi d'essai, par le même rendu. Sans lui, la seule façon de voir son
       courriel pour de vrai était d'envoyer une vraie facture à un vrai
       client — c'est ce que les gens faisaient, avec le risque que ça suppose.

       Toujours à SOI : jamais une adresse fournie par le client de l'API.
       Autrement, cette route deviendrait un relais d'envoi anonyme. */
    if (req.body?.envoyer === true) {
      const destinataire = auth.user.email;
      if (!destinataire) return res.status(400).json({ error: 'No email on this account.' });
      const envoi = await sendEmail({
        ...(await senderForOrg(auth.orgId, company)),
        to: destinataire,
        subject: `[Essai] ${avecExemples(String(req.body?.objet || '')).slice(0, 200) || (fr ? 'Aperçu de votre courriel' : 'Your email preview')}`,
        html,
        // Pas de `suivi` : un essai qu'on s'envoie à soi n'a pas à compter
        // dans les statistiques d'ouverture d'un vrai client.
      });
      if (!envoi.sent) return res.status(502).json({ error: envoi.error || 'Send failed.' });
      return res.json({ html, envoye: destinataire });
    }

    return res.json({ html });
  } catch (error) {
    return sendSafeError(res, error, 'Failed to render preview.', '[emails/apercu]');
  }
});

export default router;
