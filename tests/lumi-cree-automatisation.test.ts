/**
 * Lumi sait créer une automatisation.
 *
 * Lumi pouvait activer, renommer et réécrire une automatisation — jamais en
 * créer une. La création vivait dans un module séparé, atteignable seulement
 * par un assistant à questions successives.
 *
 * Ce qui doit rester vrai, et que ces tests figent :
 *  · la règle naît EN PAUSE (sinon fermer une conversation enverrait des
 *    messages à de vrais clients) ;
 *  · le chemin de génération reste le chemin PAS CHER (`genererParcours` :
 *    Haiku, catalogue en cache, budget réservé avant l'appel) ;
 *  · la proposition passe la validation du moteur avant d'être enregistrée ;
 *  · l'outil est gardé par la permission des automatisations.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RACINE = resolve(__dirname, '..');
const SRC = readFileSync(resolve(RACINE, 'server/lib/agent/tools-reglages.ts'), 'utf8');
const GEN = readFileSync(resolve(RACINE, 'server/lib/lumi/generer-parcours.ts'), 'utf8');
// Depuis la mission finale (2026-10-02), aucun outil n'écrit `automation_rules` lui-même :
// tous passent par `ecrireRegle`. Les garanties d'écriture se lisent donc LÀ.
const ECR = readFileSync(resolve(RACINE, 'server/lib/automations-ecriture.ts'), 'utf8');
/** L'insertion de `ecrireRegle` : de `.insert({` à sa fermeture. */
function insertionDEcrireRegle(): string {
  const i = ECR.indexOf('.insert({');
  expect(i, 'insertion introuvable dans ecrireRegle').toBeGreaterThan(-1);
  return ECR.slice(i, ECR.indexOf('})', i));
}

/** Le corps de l'outil, isolé pour que les assertions ne visent pas un voisin. */
function corpsOutil(): string {
  const i = SRC.indexOf('const createAutomationFromText');
  expect(i, 'outil createAutomationFromText introuvable').toBeGreaterThan(-1);
  const j = SRC.indexOf('\nconst ', i + 10);
  const k = SRC.indexOf('\n/**', i + 10);
  const fin = Math.min(...[j, k].filter((n) => n > -1));
  return SRC.slice(i, fin > i ? fin : undefined);
}

describe('l’outil existe et est déclaré à Lumi', () => {
  it('porte un nom stable', () => {
    expect(SRC).toContain("name: 'create_automation_from_text'");
  });

  it('est enregistré dans le jeu d’outils', () => {
    // Déclaré mais pas exporté = invisible pour Lumi, sans erreur.
    expect(SRC).toMatch(/OUTILS_REGLAGES[\s\S]*createAutomationFromText/);
  });

  it('est une écriture, pas une lecture', () => {
    expect(corpsOutil()).toContain("kind: 'write'");
  });
});

describe('la règle naît en pause — la garantie qui protège les clients', () => {
  it('insère is_active à false', () => {
    // Le défaut inverse enverrait des messages dès le prochain déclencheur,
    // sans que personne ait relu le parcours.
    // L'outil crée par `ecrireRegle` (ruleId null), et c'est elle qui insère — toujours en brouillon.
    expect(corpsOutil()).toMatch(/ecrireRegle\(\{[\s\S]{0,160}ruleId: null/);
    expect(corpsOutil()).not.toMatch(/\.insert\(/);
    expect(insertionDEcrireRegle()).toContain('is_active: false');
  });

  it('ne rend jamais is_active true', () => {
    expect(corpsOutil()).not.toContain('is_active: true');
    // `ecrireRegle` n'écrit JAMAIS la publication : ni à la création, ni dans une modification.
    expect(ECR).not.toContain('is_active: true');
    expect(ECR).not.toMatch(/for \(const cle of \[[^\]]*is_active/);
  });

  it('le dit à l’utilisateur dans sa réponse', () => {
    expect(corpsOutil()).toMatch(/EN PAUSE|en pause/);
  });

  it('la description de l’outil prévient le modèle', () => {
    // Si le modèle croit la règle active, il l'annoncera comme telle.
    expect(corpsOutil()).toMatch(/created PAUSED|PAUSED/);
  });
});

describe('le coût reste celui du chemin bon marché', () => {
  it('délègue à genererParcours au lieu de faire raisonner l’orchestrateur', () => {
    expect(corpsOutil()).toContain('genererParcours');
  });

  it('genererParcours tourne sur Sonnet 5 — jamais Opus', () => {
    // Haiku jusqu'au 2026-09-30 : textes plats et même phrase répétée trois
    // fois sur une vraie conversation (tests/lumi-parcours-montre-les-textes).
    // Sonnet ≈ 1,2 ¢ la demande ; Opus serait le coût de l'orchestrateur.
    expect(GEN).toContain("const MODELE = 'claude-sonnet-5'");
    expect(GEN).not.toMatch(/const MODELE = 'claude-opus/);
  });

  it('son catalogue est mis en cache', () => {
    // Sans cache, le catalogue (26 déclencheurs + 52 actions) est repayé à
    // chaque création.
    expect(GEN).toContain("cache_control: { type: 'ephemeral' }");
  });

  it('le budget Lumi est réservé AVANT l’appel, et un forfait sans Lumi est refusé', () => {
    // Décision du 2026-09-28 : Construire avec Lumi = Autopilot, facturé au budget.
    const iRes = GEN.indexOf('reserverBudget(admin, orgId, estimation)');
    const iApp = GEN.indexOf('messages.create');
    expect(iRes, 'reserverBudget absent').toBeGreaterThan(-1);
    expect(iRes).toBeLessThan(iApp);
    expect(GEN).toMatch(/reservation\.statut === 'plan_sans_lumi'/);
  });

  it('la réservation est RÉGLÉE au coût réel (elle restait en vol avant)', () => {
    expect(GEN).toMatch(/reglerBudget\(admin, reservation\.id, coutGeneration\)/);
  });

  it('la sortie est plafonnée — assez haut pour Sonnet, et une réponse coupée est dite, pas déguisée', () => {
    // 1 500 coupait 2 réponses sur 3 de Sonnet (JSON illisible → « Lumi n'a pas compris »), mesuré le 2026-09-30.
    expect(GEN).toMatch(/MAX_TOKENS\s*=\s*4_000/);
    expect(GEN).toMatch(/stop_reason === 'max_tokens'/);
    expect(GEN, 'le JSON compact faisait 2/10 JSON illisibles').not.toMatch(/JSON, COMPACT/);
  });

  it('l’usage est journalisé, donc mesurable', () => {
    expect(GEN).toContain('journaliserUsage');
  });
});

describe('rien d’invalide n’atteint la base', () => {
  it('la proposition passe sequenceEtapes avant l’insertion', () => {
    const c = corpsOutil();
    const iVal = c.indexOf('sequenceEtapes');
    const iIns = c.indexOf('ecrireRegle({');
    expect(iVal, 'validation absente').toBeGreaterThan(-1);
    expect(iIns, 'écriture absente').toBeGreaterThan(-1);
    expect(iVal).toBeLessThan(iIns);
    // … et `ecrireRegle` revalide elle-même avant d'écrire (le schéma de la route porte `sequenceEtapes`).
    expect(ECR.indexOf('automationRuleUpdateSchema.safeParse')).toBeGreaterThan(-1);
    expect(ECR.indexOf('automationRuleUpdateSchema.safeParse')).toBeLessThan(ECR.indexOf('.insert({'));
  });

  it('une proposition refusée lève au lieu d’insérer', () => {
    expect(corpsOutil()).toMatch(/verdict\.success[\s\S]{0,200}throw/);
  });

  it('l’écriture est bornée à l’organisation', () => {
    expect(corpsOutil()).toMatch(/ecrireRegle\(\{[\s\S]{0,80}orgId: ctx\.orgId/);
    expect(insertionDEcrireRegle()).toContain('org_id: o.orgId');
    // Lecture, modification et relecture : chacune filtrée par le bureau.
    expect(ECR.match(/\.eq\('org_id', o\.orgId\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('l’appel est idempotent', () => {
    // Un rejeu ne doit pas créer deux règles identiques.
    expect(corpsOutil()).toContain("executerIdempotent(ctx, 'create_automation_from_text'");
  });
});

describe('les gardes du projet sont respectées', () => {
  it('l’outil exige la permission des automatisations', () => {
    expect(SRC).toMatch(/create_automation_from_text:\s*\{\s*cle: 'automations\.update'/);
  });

  it('il est classé comme écriture sensible et réversible', () => {
    expect(SRC).toMatch(/create_automation_from_text:\s*\{ sensible: true,\s*reversible: true,\s*vers_client: false \}/);
  });

  it('vers_client est faux, et c’est justifié', () => {
    // Une règle en pause n'atteint aucun client : le marquer `vers_client`
    // ferait mentir la carte de confirmation.
    expect(SRC).toMatch(/create_automation_from_text[\s\S]{0,120}vers_client: false/);
  });
});
