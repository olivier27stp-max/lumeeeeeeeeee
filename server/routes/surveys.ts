/* ═══════════════════════════════════════════════════════════════
   Routes — Satisfaction Surveys
   Public endpoints for survey submission (no auth required).
   ═══════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { getServiceClient } from '../lib/supabase';
import { eventBus } from '../lib/eventBus';

const router = Router();

// GET /api/survey/:token — Fetch survey info (public, no auth)
router.get('/survey/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Missing survey token.' });

    const supabase = getServiceClient();
    const { data: survey, error } = await supabase
      .from('satisfaction_surveys')
      .select(`
        id, token, rating, feedback, submitted_at, created_at,
        clients!satisfaction_surveys_client_id_fkey(first_name, last_name),
        jobs!satisfaction_surveys_job_id_fkey(title),
        org_id
      `)
      .eq('token', token)
      .maybeSingle() as any;

    if (error) throw error;
    if (!survey) return res.status(404).json({ error: 'Survey not found.' });

    // Track click on review link (update review_requests status)
    await supabase
      .from('review_requests')
      .update({ status: 'clicked', clicked_at: new Date().toISOString() })
      .eq('survey_id', survey.id)
      .eq('status', 'sent');

    // Fetch company info
    const { data: company } = await supabase
      .from('company_settings')
      .select('company_name, google_review_url')
      .eq('org_id', survey.org_id)
      .maybeSingle();

    return res.json({
      token: survey.token,
      submitted: Boolean(survey.submitted_at),
      rating: survey.rating,
      client_name: survey.clients
        ? `${survey.clients.first_name || ''} ${survey.clients.last_name || ''}`.trim()
        : null,
      job_name: survey.jobs?.title || null,
      company_name: company?.company_name || '',
      google_review_url: company?.google_review_url || null,
    });
  } catch (err: any) {
    console.error('[surveys] GET failed:', err.message);
    return res.status(500).json({ error: 'Unable to fetch survey.' });
  }
});

// POST /api/survey/:token — Submit rating (public, no auth)
router.post('/survey/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Missing survey token.' });

    const rating = Number(req.body?.rating);
    const feedback = String(req.body?.feedback || '').trim() || null;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
    }

    const supabase = getServiceClient();

    // Check survey exists and not already submitted
    const { data: survey, error: fetchError } = await supabase
      .from('satisfaction_surveys')
      .select('id, org_id, client_id, job_id, submitted_at')
      .eq('token', token)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!survey) return res.status(404).json({ error: 'Survey not found.' });
    if (survey.submitted_at) return res.status(409).json({ error: 'Survey already submitted.' });

    // Update survey
    const { error: updateError } = await supabase
      .from('satisfaction_surveys')
      .update({
        rating,
        feedback,
        submitted_at: new Date().toISOString(),
      })
      .eq('id', survey.id);

    if (updateError) throw updateError;

    // Update review_requests tracking
    await supabase
      .from('review_requests')
      .update({ status: 'submitted', submitted_at: new Date().toISOString() })
      .eq('survey_id', survey.id)
      .in('status', ['sent', 'clicked']);

    // Fetch company info for response
    const { data: company } = await supabase
      .from('company_settings')
      .select('company_name, google_review_url')
      .eq('org_id', survey.org_id)
      .maybeSingle();

    // Handle based on rating
    if (rating >= 4) {
      // Log positive feedback activity
      if (survey.job_id) {
        await eventBus.emit('job.completed', {
          orgId: survey.org_id,
          entityType: 'job',
          entityId: survey.job_id,
          metadata: {
            sub_event: 'positive_review',
            rating,
            feedback,
          },
        });
      }

      return res.json({
        success: true,
        rating,
        redirect_to_review: true,
        google_review_url: company?.google_review_url || null,
        message: 'Thank you for your positive feedback!',
      });
    } else {
      // Rating <= 3: internal feedback, notify admin, create follow-up task
      // Log negative feedback activity
      await supabase.from('activity_log').insert({
        org_id: survey.org_id,
        entity_type: survey.job_id ? 'job' : 'client',
        entity_id: survey.job_id || survey.client_id || survey.id,
        event_type: 'feedback_received',
        metadata: { rating, feedback, survey_id: survey.id },
      });

      // Notification « Avis client reçu » : émise par le trigger DB sur
      // satisfaction_surveys (migration 20260747000000) — couvre toutes les
      // notes, la basse comme la bonne. On garde la tâche de suivi ici.

      // Create follow-up task
      await supabase.from('tasks').insert({
        org_id: survey.org_id,
        title: `Follow up on low satisfaction rating (${rating}/5)`,
        description: `Client gave ${rating}/5 stars. Feedback: ${feedback || 'None'}`,
        status: 'pending',
        entity_type: survey.client_id ? 'client' : 'job',
        entity_id: survey.client_id || survey.job_id || null,
      });

      return res.json({
        success: true,
        rating,
        redirect_to_review: false,
        message: 'Thank you for your feedback. We will follow up with you.',
      });
    }
  } catch (err: any) {
    console.error('[surveys] POST failed:', err.message);
    return res.status(500).json({ error: 'Unable to submit survey.' });
  }
});

export default router;
