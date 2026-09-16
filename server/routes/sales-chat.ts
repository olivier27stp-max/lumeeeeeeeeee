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
import { repondreSupportIA, isSupportIAConfigured, MODELE_SUPPORT } from '../lib/support/ia';
import { getServiceClient } from '../lib/supabase';
import { journaliserTrace, normaliserEnonce } from '../lib/lumi/traces';
import { reponseFixePour } from '../lib/agent/reponsesFixes';
import { VERSION_PROMPT } from '../lib/lumi/version';
import { embed, chercherSemantique, memoriserSemantique } from '../lib/lumi/cache-semantique';
import { reponsesPubliquesAujourdhui } from '../lib/support/garde-fous';
import { reglesCout } from '../lib/lumi/regles-cout';

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



router.post('/public/sales-chat', validate(salesChatSchema), async (req, res) => {
  try {
    if (!isSupportIAConfigured()) {
      return res.status(503).json({ error: 'Sales chat unavailable.' });
    }

    const { messages } = req.body as z.infer<typeof salesChatSchema>;

    // On ne garde que les 10 derniers tours ; un message d'accueil purement
    // client en tête est ignoré (la conversation commence par l'utilisateur).
    const trimmed = messages.slice(-10);
    const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
    for (const m of trimmed) {
      const role = m.role === 'assistant' ? 'model' : 'user';
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
    // Étage 4 public : une question déjà répondue, reformulée, sans Gemini. Index PARTAGÉ
    // (aucune donnée client ici) ; seulement quand la question est le premier message.
    const vecteur = contents.length === 1 ? await embed(dernier) : null;
    if (vecteur) {
      const s = await chercherSemantique({ genre: 'public' }, vecteur, null, dernier);
      if (s) {
        void journaliserTrace(getServiceClient(), {
          orgId: null, userId: null, canal: 'public', origine: (req.body as any)?.origine === 'suggestion' ? 'suggestion' : 'texte',
          enonce: dernier, etage: 4, action: 'cache-semantique', resultat: 'ok', model: null, promptVersion: VERSION_PROMPT, costCents: null, dureeMs: Date.now() - debut,
        });
        return res.json({ reply: s.entree.texte, cache: 'semantique' });
      }
    }
    // Règle stricte : plafond GLOBAL de réponses du modèle par 24 h sur le site
    // (toutes IP confondues) — une ferme d'IP ne brûle plus le compte. Au-delà :
    // réponse fixe vers la démo, 0 token, tracée.
    if ((await reponsesPubliquesAujourdhui(getServiceClient())) >= reglesCout().plafond_public_par_jour) {
      void journaliserTrace(getServiceClient(), {
        orgId: null, userId: null, canal: 'public', origine: (req.body as any)?.origine === 'suggestion' ? 'suggestion' : 'texte',
        enonce: normaliserEnonce(dernier), etage: 0, action: 'plafond_public', resultat: 'refus', model: null, costCents: 0, dureeMs: Date.now() - debut,
      });
      return res.json({ reply: "Bonne question ! Le plus simple, c'est une courte démo — tu veux que je t'aide à en réserver une ?", fixe: 'plafond_public' });
    }
    // Le même Lumi que dans l'app et le portail (Sonnet 5, surface publique : aucun compte, aucun dossier).
    const historique = contents.slice(0, -1).map((c) => ({ role: c.role === 'model' ? 'assistant' as const : 'user' as const, content: c.parts[0]?.text ?? '' }));
    const r = await repondreSupportIA(
      { langue: 'fr', companyName: '', planLabel: '', userName: 'visiteur', slaTexte: '', surface: 'public', dossier: null },
      historique, dernier,
    );

    // Trace sans tenant (page publique) : coût réel du modèle.
    void journaliserTrace(getServiceClient(), {
      orgId: null, userId: null, canal: 'public', origine: (req.body as any)?.origine === 'suggestion' ? 'suggestion' : 'texte',
      enonce: normaliserEnonce(dernier),
      etage: 6, action: 'support-public', outils: r.outils, resultat: 'ok', model: MODELE_SUPPORT, promptVersion: VERSION_PROMPT, costCents: r.coutCents, dureeMs: Date.now() - debut,
    });
    const reply = (r.texte || '').trim();
    if (vecteur && reply) void memoriserSemantique({ genre: 'public' }, { enonce: dernier, vec: vecteur, texte: reply, fiches: [], outils: [], version: 0 });
    if (!reply) {
      return res.json({
        reply: "Bonne question ! Le plus simple, c'est une courte démo — tu veux que je t'aide à en réserver une ?",
      });
    }
    return res.json({ reply });
  } catch (err: any) {
    // 429 du modèle (quota) -> on le remonte tel quel pour que le widget affiche
    // le bon message d'attente.
    if (err?.status === 429) {
      return res.status(429).json({ error: 'Rate limited.' });
    }
    console.error('[public/sales-chat]', err?.message || err);
    return res.status(500).json({ error: 'Sales chat failed.' });
  }
});

export default router;
