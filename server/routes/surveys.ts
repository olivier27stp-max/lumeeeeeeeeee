/* ═══════════════════════════════════════════════════════════════
   Routes — Demande d'avis (public, sans auth)

   Un seul écran pour TOUS les clients (2026-09-30) : message d'invitation
   + choix Google / Facebook. Aucune note préalable, aucun filtrage selon la
   satisfaction (« review gating » interdit par Google et Facebook).

     GET  /survey/:token           → textes + plateformes d'avis
     POST /survey/:token/choice    → plateforme choisie (journal)
     POST /survey/:token/feedback  → commentaire que le client va coller
                                     sur Google / Facebook (gardé chez nous)
     POST /survey/:token           → ancienne note d'étoiles : acceptée pour
                                     les pages déjà ouvertes, sans effet sur
                                     la suite (tout le monde va au choix)
   ═══════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { getServiceClient } from '../lib/supabase';
import {
  isReviewPlatform,
  reviewInviteMessage,
  reviewLanding,
  surveyTexts,
} from '../lib/reviews';

const router = Router();

const COMPANY_REVIEW_COLUMNS = 'company_name, google_review_url, facebook_review_url, review_invite_message, review_survey_question';

async function loadCompany(supabase: ReturnType<typeof getServiceClient>, orgId: string) {
  const { data } = await supabase
    .from('company_settings')
    .select(COMPANY_REVIEW_COLUMNS)
    .eq('org_id', orgId)
    .limit(1)
    .maybeSingle();
  return data;
}

function landingPayload(company: Awaited<ReturnType<typeof loadCompany>>) {
  const landing = reviewLanding(company);
  return {
    destinations: landing.destinations,
    auto_redirect_url: landing.auto_redirect_url,
    invite_message: reviewInviteMessage(company, 'fr'),
    invite_message_en: reviewInviteMessage(company, 'en'),
    texts: surveyTexts(company, 'fr'),
    texts_en: surveyTexts(company, 'en'),
    // Rétro-compat pour d'anciens clients de l'API
    google_review_url: landing.destinations.find((d) => d.platform === 'google')?.url || null,
  };
}

// GET /api/survey/:token — page d'avis (public)
router.get('/survey/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Missing survey token.' });

    const supabase = getServiceClient();
    const { data: survey, error } = await supabase
      .from('satisfaction_surveys')
      .select(`
        id, token, created_at,
        clients!satisfaction_surveys_client_id_fkey(first_name, last_name),
        jobs!satisfaction_surveys_job_id_fkey(title),
        org_id
      `)
      .eq('token', token)
      .maybeSingle() as any;

    if (error) throw error;
    if (!survey) return res.status(404).json({ error: 'Survey not found.' });

    // Suivi du clic sur le lien (review_requests.status → clicked)
    const { error: clickError } = await supabase
      .from('review_requests')
      .update({ status: 'clicked', clicked_at: new Date().toISOString() })
      .eq('survey_id', survey.id)
      .eq('status', 'sent');
    if (clickError) console.error('[surveys] click tracking failed:', { surveyId: survey.id, error: clickError.message });

    const company = await loadCompany(supabase, survey.org_id);

    return res.json({
      token: survey.token,
      client_name: survey.clients
        ? `${survey.clients.first_name || ''} ${survey.clients.last_name || ''}`.trim()
        : null,
      job_name: survey.jobs?.title || null,
      company_name: company?.company_name || '',
      ...landingPayload(company),
    });
  } catch (err: any) {
    console.error('[surveys] GET failed:', err.message);
    return res.status(500).json({ error: 'Unable to fetch survey.' });
  }
});

// POST /api/survey/:token/choice — plateforme choisie (public)
router.post('/survey/:token/choice', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Missing survey token.' });
    const platform = req.body?.platform;
    if (!isReviewPlatform(platform)) return res.status(400).json({ error: 'Unknown platform.' });

    const supabase = getServiceClient();
    const { data: survey, error: fetchError } = await supabase
      .from('satisfaction_surveys')
      .select('id, org_id, client_id, job_id')
      .eq('token', token)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!survey) return res.status(404).json({ error: 'Survey not found.' });

    const { error: logError } = await supabase.from('activity_log').insert({
      org_id: survey.org_id,
      entity_type: survey.job_id ? 'job' : 'client',
      entity_id: survey.job_id || survey.client_id || survey.id,
      related_entity_type: survey.client_id ? 'client' : null,
      related_entity_id: survey.client_id || null,
      event_type: 'review_platform_chosen',
      metadata: { platform, survey_id: survey.id },
    });
    if (logError) console.error('[surveys] choice activity_log insert failed:', { surveyId: survey.id, error: logError.message });

    return res.json({ success: true });
  } catch (err: any) {
    console.error('[surveys] choice POST failed:', err.message);
    return res.status(500).json({ error: 'Unable to record choice.' });
  }
});

// POST /api/survey/:token — ancienne note d'étoiles (pages ouvertes avant le
// changement). Enregistrée telle quelle ; la suite est la même pour tous.
router.post('/survey/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Missing survey token.' });

    const supabase = getServiceClient();
    const { data: survey, error: fetchError } = await supabase
      .from('satisfaction_surveys')
      .select('id, org_id, submitted_at')
      .eq('token', token)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!survey) return res.status(404).json({ error: 'Survey not found.' });

    const rating = Number(req.body?.rating);
    if (!survey.submitted_at && Number.isInteger(rating) && rating >= 1 && rating <= 5) {
      const now = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('satisfaction_surveys')
        .update({ rating, submitted_at: now })
        .eq('id', survey.id);
      if (updateError) throw updateError;
    }

    const company = await loadCompany(supabase, survey.org_id);
    return res.json({ success: true, step: 'public_review', ...landingPayload(company) });
  } catch (err: any) {
    console.error('[surveys] POST failed:', err.message);
    return res.status(500).json({ error: 'Unable to submit survey.' });
  }
});

// POST /api/survey/:token/feedback — le commentaire que le client colle sur
// Google / Facebook. On le garde chez nous (même colonne), journalisé.
router.post('/survey/:token/feedback', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Missing survey token.' });

    const feedback = String(req.body?.feedback || '').trim().slice(0, 4000);
    if (!feedback) return res.status(400).json({ error: 'Feedback is required.' });

    const supabase = getServiceClient();
    const { data: survey, error: fetchError } = await supabase
      .from('satisfaction_surveys')
      .select('id, org_id, client_id, job_id')
      .eq('token', token)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!survey) return res.status(404).json({ error: 'Survey not found.' });

    // Le client peut recopier puis modifier son texte : la dernière version gagne.
    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('satisfaction_surveys')
      .update({ feedback, feedback_submitted_at: now })
      .eq('id', survey.id);
    if (updateError) throw updateError;

    const { error: logError } = await supabase.from('activity_log').insert({
      org_id: survey.org_id,
      entity_type: survey.job_id ? 'job' : 'client',
      entity_id: survey.job_id || survey.client_id || survey.id,
      related_entity_type: survey.client_id ? 'client' : null,
      related_entity_id: survey.client_id || null,
      event_type: 'public_review_written',
      metadata: { feedback, survey_id: survey.id, public: true },
    });
    if (logError) console.error('[surveys] feedback activity_log insert failed:', { surveyId: survey.id, error: logError.message });

    return res.json({ success: true });
  } catch (err: any) {
    console.error('[surveys] feedback POST failed:', err.message);
    return res.status(500).json({ error: 'Unable to submit feedback.' });
  }
});

export default router;
