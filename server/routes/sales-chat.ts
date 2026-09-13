/* ═══════════════════════════════════════════════════════════════
   /api/public/sales-chat — Agent « vendeur » PUBLIC (Lumi)
   ─────────────────────────────────────────────────────────────
   Répond aux questions des VISITEURS de la page d'accueil (sans compte).
   Branché sur Gemini, SANS aucun outil CRM, SANS accès aux données d'une
   org. Le tenant ne vient jamais du client ici — il n'y a pas de tenant.

   Garde-fous (page publique = surface d'abus, tokens facturés) :
   - rate-limiting par IP (monté dans server/index.ts, preset `public`) ;
   - historique borné (10 derniers messages) + longueur par message ;
   - plafond de tokens de sortie par réponse ;
   - system prompt verrouillé : Lumi ne parle QUE de Lume, non détournable,
     et n'a aucun outil — il ne peut rien lire ni écrire.
   ═══════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../lib/validation';
import { generateContent, isGeminiConfigured, geminiModel, type GeminiContent } from '../lib/agent/gemini';
import { getServiceClient } from '../lib/supabase';
import { journaliserTrace, normaliserEnonce, usageGemini } from '../lib/lumi/traces';
import { reponseFixePour } from '../lib/agent/reponsesFixes';
import { VERSION_PROMPT } from '../lib/lumi/version';

const router = Router();

const salesChatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(1500),
      }),
    )
    .min(1)
    .max(20),
  // D'où vient le dernier message : suggestion cliquée ou texte libre (mesure, jamais une autorisation).
  origine: z.enum(['texte', 'suggestion']).optional(),
});

import { SYSTEM_PROMPT } from '../lib/agent/promptVente';


router.post('/public/sales-chat', validate(salesChatSchema), async (req, res) => {
  try {
    if (!isGeminiConfigured()) {
      return res.status(503).json({ error: 'Sales chat unavailable.' });
    }

    const { messages } = req.body as z.infer<typeof salesChatSchema>;

    // On ne garde que les 10 derniers tours et on mappe vers le format Gemini.
    // (assistant -> 'model'). On ignore un éventuel message d'accueil purement
    // client : le 1er contenu doit venir de l'utilisateur côté Gemini, donc on
    // laisse tomber les 'model' en tête.
    const trimmed = messages.slice(-10);
    const contents: GeminiContent[] = [];
    for (const m of trimmed) {
      const role = m.role === 'assistant' ? 'model' : 'user';
      // Gemini exige que la conversation commence par un tour 'user'.
      if (contents.length === 0 && role === 'model') continue;
      contents.push({ role, parts: [{ text: m.content }] });
    }
    if (contents.length === 0 || contents[contents.length - 1].role !== 'user') {
      return res.status(400).json({ error: 'A user message is required.' });
    }

    const debut = Date.now();
    // Étage 0 : une suggestion cliquée a une réponse fixe (mêmes faits que le prompt) — 0 appel Gemini.
    const dernier = contents[contents.length - 1]?.parts?.[0]?.text ?? '';
    const fixe = reponseFixePour(dernier);
    if (fixe) {
      void journaliserTrace(getServiceClient(), {
        orgId: null, userId: null, canal: 'public', origine: (req.body as any)?.origine === 'suggestion' ? 'suggestion' : 'texte',
        enonce: dernier, etage: 0, action: fixe.id, resultat: 'ok', model: null, costCents: 0, dureeMs: Date.now() - debut,
      });
      return res.json({ reply: fixe.reponse, fixe: fixe.id });
    }
    const result = await generateContent({
      systemInstruction: SYSTEM_PROMPT,
      contents,
      temperature: 0.6,
      maxOutputTokens: 400, // réponses courtes de vendeur, avec marge
      disableThinking: true, // pas de « réflexion » : sinon elle mange le budget
                             // et la réponse est coupée (bug MAX_TOKENS constaté).
    });

    // Trace sans tenant (page publique) : tokens Gemini, aucun coût inventé (pas de grille Gemini dans tarifs.ts).
    void journaliserTrace(getServiceClient(), {
      orgId: null, userId: null, canal: 'public', origine: (req.body as any)?.origine === 'suggestion' ? 'suggestion' : 'texte',
      enonce: normaliserEnonce(contents[contents.length - 1]?.parts?.[0]?.text ?? null),
      etage: 6, resultat: 'ok', model: geminiModel, promptVersion: VERSION_PROMPT, usage: usageGemini(result.usage), costCents: null, dureeMs: Date.now() - debut,
    });
    const reply = (result.text || '').trim();
    if (!reply) {
      return res.json({
        reply: "Bonne question ! Le plus simple, c'est une courte démo — tu veux que je t'aide à en réserver une ?",
      });
    }
    return res.json({ reply });
  } catch (err: any) {
    // 429 Gemini (quota) -> on le remonte tel quel pour que le widget affiche
    // le bon message d'attente.
    if (err?.status === 429) {
      return res.status(429).json({ error: 'Rate limited.' });
    }
    console.error('[public/sales-chat]', err?.message || err);
    return res.status(500).json({ error: 'Sales chat failed.' });
  }
});

export default router;
