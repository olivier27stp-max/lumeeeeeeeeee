/* ═══════════════════════════════════════════════════════════════
   Lume Agent — Chat route
   ─────────────────────────────────────────────────────────────
   POST /api/agent/chat — stateless turn. The client sends the running
   transcript; the server runs the Gemini tool-use loop scoped to the
   caller's org and returns the reply plus an optional proposedAction
   (which the client executes only after user confirmation).
   ═══════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { journaliserTrace, usageGemini } from '../lib/lumi/traces';
import { sendSafeError } from '../lib/error-handler';
import { validate, agentTranscribeSchema } from '../lib/validation';
import { isGeminiConfigured } from '../lib/agent/gemini';
import { verifierPlafond, compterRefus, ajouterAppel } from '../lib/lumi/plafond-journalier';
import { transcribeAudioAvecUsage, type TranscribeMimeType } from '../lib/agent/transcribe';

const router = Router();

// POST /api/agent/chat
/* Transcription du micro : l'audio enregistré par le navigateur arrive en
   base64, Gemini le transcrit, le texte revient au chat comme s'il avait été
   tapé. Réservé aux membres connectés (même limite de débit que le chat). */
router.post('/agent/transcribe', validate(agentTranscribeSchema), async (req, res) => {
  try {
    if (!isGeminiConfigured()) {
      return res.status(503).json({ error: 'Lume Agent is not configured. Set GEMINI_API_KEY on the server.', code: 'agent_not_configured' });
    }
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { audio, mimeType, language } = req.body as { audio: string; mimeType: TranscribeMimeType; language?: 'fr' | 'en' };
    // La dictée a sa PROPRE source (« voix ») depuis le 2026-09-22. Avant,
    // elle puisait dans le plafond de « lumi » : une journée chargée en
    // dictées aurait coupé le chat, alors que ce sont deux usages distincts.
    // Son tarif n'est pas connu du code (Gemini absent de TARIFS), donc le
    // plafond porte sur le VOLUME d'appels, pas sur des dollars.
    if (!verifierPlafond('voix').autorise) {
      compterRefus('voix');
      return res.status(429).json({ error: 'Daily transcription cap reached.', code: 'plafond_jour' });
    }
    const debut = Date.now();
    // Compté à l'envoi : c'est le volume, pas le montant, qui borne cette source.
    ajouterAppel('voix');
    const r = await transcribeAudioAvecUsage({ base64: audio, mimeType, language: language ?? 'fr' });
    // Trace (lumi_traces) : la dictée coûte un appel Gemini avant le tour Lumi.
    // org/user = contexte serveur ; le texte transcrit n'est pas stocké ici.
    void journaliserTrace(getServiceClient(), {
      orgId: authed.orgId, userId: authed.user.id, canal: 'transcription', origine: 'voix',
      // costCents null tant que le tarif Gemini n'est pas dans TARIFS : on ne
      // devine pas un prix. Les tokens, eux, sont comptés et lisibles.
      resultat: 'ok', model: r.model, usage: usageGemini(r.usage),
      costCents: null, dureeMs: Date.now() - debut,
    });
    res.json({ text: r.text });
  } catch (err) {
    sendSafeError(res, err, 'Transcription failed.');
  }
});

/**
 * POST /agent/chat — FERMÉE (item 2, AGENTFORCE_GAP.md).
 * L'ancien agent Gemini (« Lume Agent », page /lume-agent) est masqué dans
 * l'interface depuis l'audit QA, mais la route restait ouverte : un appel
 * Gemini non journalisé, avec le même accès aux outils que Lumi, sans carte
 * de confirmation dans l'interface. Deux orchestrateurs pour le même
 * comportement (R15) : on garde Lumi (/api/lumi/chat). 410 plutôt que 404 :
 * un client qui l'appelle encore doit comprendre que c'est définitif.
 * La transcription (/agent/transcribe) reste : Lumi s'en sert pour le micro.
 */
router.post('/agent/chat', (_req, res) => {
  res.status(410).json({ error: 'Lume Agent has been retired. Use Lumi (POST /api/lumi/chat).', code: 'agent_retire' });
});

export default router;
