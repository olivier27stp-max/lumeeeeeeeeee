/**
 * Réglages de modèle imposés aux batteries d'évaluation (incident 2026-09-18).
 * ──────────────────────────────────────────────────────────────────────────
 * Mesuré sur staging du 2026-09-10 au 09-17 : 7 152 appels, 39,39 $ US, dont
 * 10,72 $ pour le seul palier Opus/Fable. La cause n'est pas le prompt : c'est
 * que les scripts de QA héritent des défauts de PRODUCTION, calibrés pour la
 * qualité (bot de migration : `claude-fable-5-1` à effort « high », ~25 ¢ par
 * fichier). Ces défauts sont les bons en production — la précision d'un
 * mapping de migration se paie une fois et évite des dégâts en base — mais une
 * batterie les rejoue des milliers de fois sans qu'aucun humain lise le
 * résultat.
 *
 * Ce module donne aux scripts de QA un palier économe par défaut, SANS toucher
 * aux défauts du serveur : il ne fait que poser des variables d'environnement
 * avant que les modules du serveur ne les lisent. Une évaluation qui a besoin
 * du modèle de production le redemande explicitement (QA_MODELE=prod), ce qui
 * reste possible pour déboguer un échec.
 *
 * À importer EN PREMIER dans un script de QA, avant tout import de `server/`.
 */

/** true si l'appelant a demandé les modèles de production (débogage d'un échec). */
export const modeProd = process.env.QA_MODELE === 'prod';

/**
 * Pose les défauts économes. N'écrase jamais une variable déjà fixée par
 * l'appelant : `LUMI_MODEL=claude-opus-5 npm run qa:lumi` continue de marcher.
 */
export function appliquerReglagesEval(): void {
  if (modeProd) {
    console.log('[qa] QA_MODELE=prod — modèles de production, coût plein assumé');
    return;
  }
  const defauts: Record<string, string> = {
    // Haiku partout : 1 $/5 $ par MTok contre 10 $/50 $ pour Fable 5.1.
    LUMI_MODEL: 'claude-haiku-4-5-20251001',
    LUMI_MODEL_MIGRATION: 'claude-haiku-4-5-20251001',
    // Le bot de migration raisonne « high » en prod (~25 ¢/fichier) : en QA, bas.
    LUMI_EFFORT_MIGRATION: 'low',
    LUMI_EFFORT: 'low',
    // Sortie bornée : les réponses mesurées font 191 tokens (p95 656).
    LUMI_MAX_TOKENS_SORTIE: '800',
    // Filet de sécurité propre aux évaluations, en plus du plafond par source.
    LUMI_PLAFOND_JOUR_USD: '5',
  };
  const poses: string[] = [];
  for (const [cle, valeur] of Object.entries(defauts)) {
    if (process.env[cle] === undefined || process.env[cle] === '') {
      process.env[cle] = valeur;
      poses.push(`${cle}=${valeur}`);
    }
  }
  console.log(`[qa] palier économe (QA_MODELE=prod pour les modèles de production) : ${poses.join(' ') || 'rien à poser'}`);
}

appliquerReglagesEval();
