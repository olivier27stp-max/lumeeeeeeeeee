// Suggestion IA optionnelle pour les colonnes ambiguës. OFF par défaut :
// exige MIGRATION_AI_SUGGESTIONS=1 ET une clé Gemini configurée. Ne reçoit
// JAMAIS d'échantillons non masqués ; la sortie du modèle est validée par un
// schéma zod strict et plafonnée à 85 de confiance (jamais « confiance
// élevée » sans humain). Toute défaillance → null, jamais d'exception.

import { z } from 'zod';
import { generateContent, isGeminiConfigured } from '../agent/gemini';

export function isAiMappingEnabled(): boolean {
  return process.env.MIGRATION_AI_SUGGESTIONS === '1' && isGeminiConfigured();
}

export interface AiSuggestInput {
  header: string;
  detectedType: string;
  fileName: string;
  samplesMasked: string[];
  candidates: { field: string; label: string }[];
}

const responseSchema = z.object({
  field: z.string().nullable(),
  confidence: z.number().min(0).max(100),
  reason: z.string().max(300),
});

export async function aiSuggestForColumn(input: AiSuggestInput): Promise<{ field: string | null; confidence: number; reason: string } | null> {
  if (!isAiMappingEnabled()) return null;
  try {
    const candidateList = input.candidates.map((c) => `- ${c.field} (${c.label})`).join('\n');
    const result = await generateContent({
      systemInstruction:
        'Tu associes une colonne de fichier CSV exporté d\'un CRM à un champ cible. ' +
        'Réponds UNIQUEMENT en JSON strict: {"field": string|null, "confidence": number, "reason": string}. ' +
        '"field" doit être exactement un des champs candidats, ou null si aucun ne convient. ' +
        'Sois conservateur : en cas de doute, null.',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                `Fichier: ${input.fileName}\nColonne: "${input.header}" (type détecté: ${input.detectedType})\n` +
                `Échantillons masqués: ${input.samplesMasked.slice(0, 3).join(' | ') || '(aucun)'}\n` +
                `Champs candidats:\n${candidateList}`,
            },
          ],
        },
      ],
      temperature: 0.1,
    });
    const text = (result.text ?? '').replace(/```json|```/g, '').trim();
    const parsed = responseSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return null;
    const field = parsed.data.field;
    if (field !== null && !input.candidates.some((c) => c.field === field)) return null;
    return {
      field,
      confidence: Math.min(85, Math.round(parsed.data.confidence)),
      reason: `ai:${parsed.data.reason.slice(0, 200)}`,
    };
  } catch (err: any) {
    console.error('[migration-ai] suggestion failed:', err?.message || err);
    return null;
  }
}
