/* ═══════════════════════════════════════════════════════════════
   Routes — Sondage de satisfaction (public, sans auth)

   Workflow en deux temps :
     GET  /survey/:token           → état du sondage + plateformes d'avis
     POST /survey/:token           → la NOTE (1-5)
                                     4-5 : liens Google/Facebook + message
                                     1-3 : formulaire de commentaires
     POST /survey/:token/feedback  → le COMMENTAIRE (note basse)
   ═══════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { getServiceClient } from '../lib/supabase';
import {
  isPositiveRating,
  isValidRating,
  reviewDestinations,
  reviewInviteMessage,
  surveyNextStep,
} from '../lib/reviews';

const router = Router();

const COMPANY_REVIEW_COLUMNS = 'company_name, google_review_url, facebook_review_url, review_invite_message';

async function loadCompany(supabase: ReturnType<typeof getServiceClient>, orgId: string) {
  const { data } = await supabase
    .from('company_settings')
    .select(COMPANY_REVIEW_COLUMNS)
    .eq('org_id', orgId)
    .limit(1)
    .maybeSingle();
  return data;
}

function feedbackNeeded(rating: number | null, feedbackSubmittedAt: string | null): boolean {
  return rating != null && !isPositiveRating(rating) && !feedbackSubmittedAt;
}

// GET /api/survey/:token — état du sondage (public)
router.get('/survey/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Missing survey token.' });

    const supabase = getServiceClient();
    const { data: survey, error } = await supabase
      .from('satisfaction_surveys')
      .select(`
        id, token, rating, feedback, submitted_at, feedback_submitted_at, created_at,
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
    const rating: number | null = survey.rating ?? null;

    return res.json({
      token: survey.token,
      submitted: Boolean(survey.submitted_at),
      rating,
      feedback_submitted: Boolean(survey.feedback_submitted_at),
      feedback_needed: feedbackNeeded(rating, survey.feedback_submitted_at),
      client_name: survey.clients
        ? `${survey.clients.first_name || ''} ${survey.clients.last_name || ''}`.trim()
        : null,
      job_name: survey.jobs?.title || null,
      company_name: company?.company_name || '',
      destinations: reviewDestinations(company),
      invite_message: reviewInviteMessage(company, 'fr'),
      invite_message_en: reviewInviteMessage(company, 'en'),
      // Rétro-compat pour d'anciens clients de l'API
      google_review_url: reviewDestinations(company).find((d) => d.platform === 'google')?.url || null,
    });
  } catch (err: any) {
    console.error('[surveys] GET failed:', err.message);
    return res.status(500).json({ error: 'Unable to fetch survey.' });
  }
});

// POST /api/survey/:token — la note (public)
router.post('/survey/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Missing survey token.' });

    if (!isValidRating(req.body?.rating)) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
    }
    const rating = Number(req.body.rating);
    // Un commentaire joint à la note reste accepté (anciens clients de l'API).
    const inlineFeedback = String(req.body?.feedback || '').trim() || null;

    const supabase = getServiceClient();

    const { data: survey, error: fetchError } = await supabase
      .from('satisfaction_surveys')
      .select('id, org_id, client_id, job_id, submitted_at')
      .eq('token', token)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!survey) return res.status(404).json({ error: 'Survey not found.' });
    if (survey.submitted_at) return res.status(409).json({ error: 'Survey already submitted.' });

    const now = new Date().toISOString();
    const company = await loadCompany(supabase, survey.org_id);
    const positive = isPositiveRating(rating);

    // ── Note basse : tâche de suivi créée tout de suite, même si le client
    // ferme la page sans écrire de commentaire. tasks.created_by est NOT NULL
    // et la route est publique : on attribue la tâche à l'owner de l'org.
    let followupTaskId: string | null = null;
    if (!positive) {
      const { data: taskOwner } = await supabase
        .from('memberships')
        .select('user_id')
        .eq('org_id', survey.org_id)
        .eq('role', 'owner')
        .limit(1)
        .maybeSingle();
      if (taskOwner?.user_id) {
        const { data: task, error: taskError } = await supabase
          .from('tasks')
          .insert({
            org_id: survey.org_id,
            created_by: taskOwner.user_id,
            title: `Suivi client insatisfait (${rating}/5)`,
            description: inlineFeedback
              ? `Note ${rating}/5. Commentaire : ${inlineFeedback}`
              : `Note ${rating}/5. Le client n'a pas encore laissé de commentaire.`,
            // Le CHECK de tasks.status n'accepte que 'open' | 'done'.
            status: 'open',
            linked_entity_type: survey.client_id ? 'client' : 'job',
            linked_entity_id: survey.client_id || survey.job_id || null,
          })
          .select('id')
          .single();
        if (taskError) {
          console.error('[surveys] follow-up task insert failed:', { surveyId: survey.id, orgId: survey.org_id, rating, error: taskError.message });
        } else {
          followupTaskId = task?.id || null;
        }
      }
    }

    // ── Enregistrer la note (déclenche la notification « Avis client reçu »
    // via trg_ac_track_survey_reviews, une seule fois : sur submitted_at).
    const { error: updateError } = await supabase
      .from('satisfaction_surveys')
      .update({
        rating,
        feedback: inlineFeedback,
        feedback_submitted_at: inlineFeedback ? now : null,
        submitted_at: now,
        followup_task_id: followupTaskId,
      })
      .eq('id', survey.id);
    if (updateError) throw updateError;

    const { error: trackError } = await supabase
      .from('review_requests')
      .update({ status: 'submitted', submitted_at: now })
      .eq('survey_id', survey.id)
      .in('status', ['sent', 'clicked']);
    if (trackError) console.error('[surveys] submit tracking failed:', { surveyId: survey.id, error: trackError.message });

    // ── Timeline de l'entité. (On n'émet PLUS job.completed ici : cet
    // événement relançait toutes les automatisations « après la job », dont
    // le sondage lui-même.)
    const { error: logError } = await supabase.from('activity_log').insert({
      org_id: survey.org_id,
      entity_type: survey.job_id ? 'job' : 'client',
      entity_id: survey.job_id || survey.client_id || survey.id,
      related_entity_type: survey.client_id ? 'client' : null,
      related_entity_id: survey.client_id || null,
      event_type: positive ? 'positive_review' : 'feedback_received',
      metadata: { rating, feedback: inlineFeedback, survey_id: survey.id, followup_task_id: followupTaskId },
    });
    if (logError) console.error('[surveys] activity_log insert failed:', { surveyId: survey.id, error: logError.message });

    const next = surveyNextStep(rating, company);
    return res.json({
      success: true,
      rating,
      step: next.step,
      destinations: next.destinations,
      auto_redirect_url: next.auto_redirect_url,
      invite_message: reviewInviteMessage(company, 'fr'),
      invite_message_en: reviewInviteMessage(company, 'en'),
      feedback_needed: !positive && !inlineFeedback,
      // Rétro-compat
      redirect_to_review: positive,
      google_review_url: next.destinations.find((d) => d.platform === 'google')?.url || null,
    });
  } catch (err: any) {
    console.error('[surveys] POST failed:', err.message);
    return res.status(500).json({ error: 'Unable to submit survey.' });
  }
});

// POST /api/survey/:token/feedback — le commentaire (note basse)
router.post('/survey/:token/feedback', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Missing survey token.' });

    const feedback = String(req.body?.feedback || '').trim().slice(0, 4000);
    if (!feedback) return res.status(400).json({ error: 'Feedback is required.' });
    // Note haute : le client a écrit un commentaire qu'il va coller sur Google/Facebook.
    // On le garde chez nous (même colonne), journalisé à part — pas un problème à suivre.
    const publicComment = req.body?.public === true;

    const supabase = getServiceClient();
    const { data: survey, error: fetchError } = await supabase
      .from('satisfaction_surveys')
      .select('id, org_id, client_id, job_id, rating, submitted_at, feedback_submitted_at, followup_task_id')
      .eq('token', token)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!survey) return res.status(404).json({ error: 'Survey not found.' });
    if (!survey.submitted_at || survey.rating == null) {
      return res.status(409).json({ error: 'Rate your experience first.' });
    }
    if (survey.feedback_submitted_at) return res.status(409).json({ error: 'Feedback already submitted.' });

    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('satisfaction_surveys')
      .update({ feedback, feedback_submitted_at: now })
      .eq('id', survey.id);
    if (updateError) throw updateError;

    // Compléter la tâche de suivi créée à la note.
    if (survey.followup_task_id) {
      const { error: taskError } = await supabase
        .from('tasks')
        .update({ description: `Note ${survey.rating}/5. Commentaire du client : ${feedback}` })
        .eq('id', survey.followup_task_id);
      if (taskError) console.error('[surveys] follow-up task update failed:', { surveyId: survey.id, error: taskError.message });
    }

    const { error: logError } = await supabase.from('activity_log').insert({
      org_id: survey.org_id,
      entity_type: survey.job_id ? 'job' : 'client',
      entity_id: survey.job_id || survey.client_id || survey.id,
      related_entity_type: survey.client_id ? 'client' : null,
      related_entity_id: survey.client_id || null,
      event_type: publicComment ? 'public_review_written' : 'feedback_received',
      metadata: { rating: survey.rating, feedback, survey_id: survey.id, followup_task_id: survey.followup_task_id, public: publicComment },
    });
    if (logError) console.error('[surveys] feedback activity_log insert failed:', { surveyId: survey.id, error: logError.message });

    return res.json({ success: true });
  } catch (err: any) {
    console.error('[surveys] feedback POST failed:', err.message);
    return res.status(500).json({ error: 'Unable to submit feedback.' });
  }
});

export default router;
