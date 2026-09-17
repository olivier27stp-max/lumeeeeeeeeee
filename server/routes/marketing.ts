import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { validate } from '../lib/validation';
import { sendEmail, isMailerConfigured } from '../lib/mailer';
import { sendSafeError } from '../lib/error-handler';
import { getServiceClient } from '../lib/supabase';
import { rendreCourrielLume, echapper, type LigneDetail } from '../lib/courriels/gabarit';

const router = Router();

// ── Shared enum (industry) ──────────────────────────────────
const INDUSTRY_VALUES = [
  'landscaping',
  'snow_removal',
  'residential_cleaning',
  'commercial_cleaning',
  'plumbing',
  'electrical',
  'roofing',
  'hvac',
  'window_cleaning',
  'other',
] as const;
const industryEnum = z.enum(INDUSTRY_VALUES);

const phoneRegex = /^[+]?[0-9][0-9\s\-().]{6,19}$/;

// ── Public submission schema ────────────────────────────────
const bookDemoSchema = z.object({
  full_name: z.string().trim().min(1, 'Full name is required.').max(200),
  company_name: z.string().trim().min(1).max(200).optional(),
  company: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().toLowerCase().email('Valid email is required.').max(254),
  phone: z.string().trim().min(4, 'Phone is required.').max(40)
    .refine((p) => phoneRegex.test(p.replace(/\s+/g, '')), 'Invalid phone number.'),
  industry: industryEnum.optional(),
  employee_count: z.string().trim().max(40).optional().nullable(),
  source: z.string().trim().max(80).optional().nullable(),
  availability: z.string().trim().max(80).optional().nullable(),
  message: z.string().trim().max(2000).optional().nullable(),
  referral_code: z.string().trim().max(40).optional().nullable(),
}).refine((d) => !!(d.company_name || d.company), {
  message: 'Company is required.',
  path: ['company_name'],
});

/** Libellés lisibles des secteurs, pour les courriels. */
const SECTEUR_LABEL: Record<typeof INDUSTRY_VALUES[number], string> = {
  landscaping: 'Aménagement paysager',
  snow_removal: 'Déneigement',
  residential_cleaning: 'Ménage résidentiel',
  commercial_cleaning: 'Entretien commercial',
  plumbing: 'Plomberie',
  electrical: 'Électricité',
  roofing: 'Toiture',
  hvac: 'CVC',
  window_cleaning: 'Lavage de vitres',
  other: 'Autre',
};

export interface DemandeDemo {
  reference: string;
  full_name: string;
  company_name: string;
  email: string;
  phone: string;
  industry: typeof INDUSTRY_VALUES[number];
  employee_count?: string | null;
  source?: string | null;
  availability?: string | null;
  message?: string | null;
  referral_code?: string | null;
}

/**
 * Alerte à l'exploitant : « [ref] Nouveau lead Lume — … ». Interne (sans
 * signature), les champs du lead en lignes, le message en contenu libre.
 * Pur — aperçu : scripts/qa/courriels-exemples/abonnement.mts.
 */
export function courrielNouveauLead(d: DemandeDemo, meta: { recuLe: string; ip: string | null; ua: string }): { sujet: string; html: string } {
  const secteur = SECTEUR_LABEL[d.industry] || d.industry;
  const lignes: LigneDetail[] = [
    { libelle: 'Référence', valeur: d.reference },
    { libelle: 'Reçu le', valeur: meta.recuLe },
    { libelle: 'Nom', valeur: d.full_name, fort: true },
    { libelle: 'Entreprise', valeur: d.company_name, fort: true },
    { libelle: 'Téléphone', valeur: d.phone, fort: true },
    { libelle: 'Courriel', valeur: d.email },
    { libelle: 'Secteur', valeur: secteur },
    { libelle: 'Taille de l’équipe', valeur: d.employee_count || '—' },
    { libelle: 'Disponibilités', valeur: d.availability || '—' },
    { libelle: 'Source', valeur: d.source || '—' },
    { libelle: 'Parrainage', valeur: d.referral_code || '—' },
  ];
  return {
    sujet: `[${d.reference}] Nouveau lead Lume — ${d.company_name} (${d.industry})`,
    html: rendreCourrielLume({
      langue: 'fr',
      preheader: `${d.full_name} · ${d.phone} · ${secteur}`,
      titre: `Nouveau lead — ${d.company_name}`,
      intro: 'Action requise : appeler le prospect. Réponse promise dans les 24 h.',
      lignes,
      corpsHtml: d.message
        ? `<p style="margin:0 0 6px;font-weight:600;">Message du prospect</p><p style="margin:0 0 14px;white-space:pre-wrap;">${echapper(d.message)}</p>`
        : null,
      bouton: { texte: 'Appeler le prospect', url: `tel:${d.phone.replace(/[^0-9+]/g, '')}` },
      note: `Pour répondre par écrit, utilise « Répondre » : le courriel du prospect est en réponse. IP ${meta.ip || '—'} · ${meta.ua.slice(0, 80) || '—'}`,
      signature: null,
    }),
  };
}

/** Confirmation au visiteur : « Merci pour ta demande de démo Lume ». Pur. */
export function courrielDemandeDemo(d: Pick<DemandeDemo, 'reference' | 'full_name' | 'company_name' | 'industry'>, ownerEmail: string): { sujet: string; html: string } {
  const prenom = d.full_name.split(' ')[0] || '';
  const secteur = SECTEUR_LABEL[d.industry] || d.industry;
  return {
    sujet: 'Merci pour ta demande de démo Lume',
    html: rendreCourrielLume({
      langue: 'fr',
      preheader: `On te contacte d’ici 24 h pour planifier ta démo (${d.reference}).`,
      titre: 'Merci pour ta demande de démo',
      salutation: `Bonjour ${prenom},`.replace(' ,', ','),
      intro: `On a bien reçu ta demande de démo pour ${d.company_name}. On te contacte d’ici 24 h pour planifier une session adaptée à ton industrie.`,
      lignes: [
        { libelle: 'Référence', valeur: d.reference, fort: true },
        { libelle: 'Entreprise', valeur: d.company_name },
        { libelle: 'Secteur', valeur: secteur },
        { libelle: 'Durée de la démo', valeur: '20 à 30 min' },
      ],
      corpsHtml: '<p style="margin:0 0 14px;">Au programme : une démo personnalisée, adaptée à ton industrie, et des réponses à toutes tes questions. Sans engagement.</p>',
      note: `Garde ta référence si tu veux nous écrire au sujet de cette demande. Si c’est urgent, écris-nous à ${ownerEmail}.`,
      supportEmail: ownerEmail,
    }),
  };
}

function extractClientIp(req: Request): string | null {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.ip || null;
}

function getOwnerEmail(): string {
  return (
    process.env.PLATFORM_OWNER_EMAIL ||
    process.env.SALES_INBOX_EMAIL ||
    'willhebert30@gmail.com'
  );
}

// ── POST /api/public/book-demo ──────────────────────────────
// La demande est D'ABORD enregistrée dans `demo_requests`, ensuite seulement
// notifiée par courriel.
//
// La persistance avait été retirée au profit d'un simple envoi de courriel :
// les deux appels partaient sans `await`, avec un `.catch()` inopérant (le
// mailer ne lève jamais). Un SMTP en panne — ou simplement non configuré —
// faisait donc disparaître le prospect sans laisser la moindre trace, pendant
// que la page répondait « demande reçue ». La table existe toujours et porte
// même le suivi commercial (statut, notes, date de conversion) : elle avait
// juste été débranchée.
router.post('/public/book-demo', validate(bookDemoSchema), async (req, res) => {
  try {
    const body = req.body as z.infer<typeof bookDemoSchema>;
    const company_name = (body.company_name || body.company || '').trim();
    const industry = (body.industry || 'other') as typeof INDUSTRY_VALUES[number];

    const ip = extractClientIp(req);
    const ua = String(req.headers['user-agent'] || '').slice(0, 500);

    const reference = `LUM-${Date.now().toString(36).toUpperCase()}`;
    const ownerEmail = getOwnerEmail();

    // Enregistrement AVANT toute notification : le prospect ne doit jamais
    // dépendre de la bonne santé du serveur de courriel.
    let persisted = false;
    try {
      const { error: insertError } = await getServiceClient()
        .from('demo_requests')
        .insert({
          full_name: body.full_name,
          company_name,
          email: body.email,
          phone: body.phone,
          industry,
          employee_count: body.employee_count || null,
          source: body.source || null,
          availability: body.availability || null,
          message: body.message || null,
          status: 'new',
          notes: `Réf. ${reference}`,
          ip_address: ip || null,
          user_agent: ua || null,
        });
      if (insertError) {
        console.error('[public/book-demo] enregistrement échoué:', insertError.message);
      } else {
        persisted = true;
      }
    } catch (dbErr: any) {
      console.error('[public/book-demo] enregistrement échoué:', dbErr?.message);
    }

    if (!isMailerConfigured()) {
      // La demande est enregistrée : le prospect n'est plus perdu, même sans
      // courriel. On le signale tout de même comme un incident.
      console.error('[public/book-demo] SMTP non configuré — aucune notification envoyée', {
        reference, email: body.email, persisted,
      });
      return res.json({ ok: true, message: 'Demo request received', reference });
    }

    const submittedAt = new Date().toLocaleString('fr-CA', {
      timeZone: 'America/Toronto',
      dateStyle: 'long',
      timeStyle: 'short',
    });
    const demande: DemandeDemo = {
      reference,
      full_name: body.full_name,
      company_name,
      email: body.email,
      phone: body.phone,
      industry,
      employee_count: body.employee_count,
      source: body.source,
      availability: body.availability,
      message: body.message,
      referral_code: body.referral_code,
    };
    const alerte = courrielNouveauLead(demande, { recuLe: submittedAt, ip, ua });

    // Attendu et vérifié : l'appel partait sans `await`, avec un `.catch()`
    // inopérant puisque `sendEmail` ne lève jamais. Un échec était donc
    // totalement invisible.
    const adminMail = await sendEmail({
      to: ownerEmail,
      replyTo: body.email,
      subject: alerte.sujet,
      html: alerte.html,
    });
    if (!adminMail.sent) {
      console.error('[public/book-demo] notification au propriétaire non envoyée:', adminMail.error, { reference });
    }

    // ── Prospect confirmation email ────────────────────────
    const confirmation = courrielDemandeDemo(demande, ownerEmail);
    const prospectMail = await sendEmail({
      to: body.email,
      subject: confirmation.sujet,
      html: confirmation.html,
    });
    if (!prospectMail.sent) {
      console.error('[public/book-demo] confirmation au prospect non envoyée:', prospectMail.error, { reference });
    }

    // Le seul cas réellement grave : ni enregistré, ni notifié — la demande
    // n'existe alors nulle part. On le remonte à Sentry avec les coordonnées
    // pour pouvoir rattraper le prospect à la main.
    if (!persisted && !adminMail.sent) {
      try {
        const { captureException } = await import('../lib/sentry');
        captureException(new Error('Demande de démo perdue : ni enregistrée ni notifiée'), {
          kind: 'demo_request_lost',
          reference,
          email: body.email,
          phone: body.phone,
          company: company_name,
        });
      } catch { /* no-op */ }
    }

    return res.json({ ok: true, message: 'Demo request received', reference });
  } catch (err: any) {
    return sendSafeError(res, err, 'Unable to submit demo request.', '[public/book-demo]');
  }
});

export default router;
