/**
 * Sujet d'un ordre trouvé par règle (server/lib/lumi/sujet-par-regle.ts) : le
 * routeur payant n'est pas appelé quand le vocabulaire ne désigne qu'un sujet.
 *
 * Le contrat : quand la règle tranche, le jeu d'outils chargé contient l'outil
 * qu'il faut. Mesuré ici sur tous les cas de l'éval, hors ligne.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { sujetParRegle } from '../server/lib/lumi/sujet-par-regle';
import { estDemandeDAction } from '../server/lib/lumi/demande-action';
import { outilsDuSousAgent, sousAgentDepuisVerdict } from '../server/lib/lumi/sous-agents';
import { resultatParRegle } from '../server/lib/lumi/routeur';

afterEach(() => { delete process.env.LUMI_SUJET_PAR_REGLE; });

describe('sujetParRegle', () => {
  it('un vocabulaire, un sujet', () => {
    expect(sujetParRegle('Supprime la soumission 3, c’était un test.')).toBe('devis');
    expect(sujetParRegle('Supprime la facture brouillon n° 1.')).toBe('facturation');
    expect(sujetParRegle('Supprime la job 48, c’était une erreur de saisie.')).toBe('planification');
    expect(sujetParRegle('Ajoute un nouveau client : Nadia Gauthier, 418-555-0142.')).toBe('clients');
    expect(sujetParRegle('Texte à Sophie Tremblay : « on arrive vers 13 h ».')).toBe('communications');
    expect(sujetParRegle('Ajoute une tâche pour vendredi : commander du savon.')).toBe('equipe');
    expect(sujetParRegle('Désactive l’automatisation de bienvenue.')).toBe('rapports');
    // Le nom de la règle parle de factures : deux sujets, la règle se tait.
    expect(sujetParRegle('Mets en pause l’automatisation « Invoice Reminder — 3 Days ».')).toBeNull();
  });

  it('deux sujets ou aucun : la règle se tait, le routeur tranche', () => {
    expect(sujetParRegle('Bill job 29 for Patrick Bélanger, the balcony painting is done.')).toBeNull(); // job + facturer
    expect(sujetParRegle('Envoie la soumission 1 à Sophie Tremblay par courriel.')).toBeNull(); // devis + envoi
    expect(sujetParRegle('Fais une facture à Marc Gagnon pour la job 4.')).toBeNull();
    expect(sujetParRegle('Supprime-la.')).toBeNull();
    expect(sujetParRegle('Remets ça comme avant.')).toBeNull();
  });

  it('un canal n’est un sujet que s’il y a une intention d’envoi', () => {
    // « a changé de courriel » parle d'une fiche, pas d'un envoi.
    expect(sujetParRegle('Julie Dupuis a changé de courriel : c’est julie@lume.test maintenant, mets sa fiche à jour.')).toBe('clients');
    expect(sujetParRegle('Envoie un courriel à Julie Dupuis pour confirmer jeudi.')).toBe('communications');
  });

  it('LUMI_SUJET_PAR_REGLE=0 coupe la règle', () => {
    process.env.LUMI_SUJET_PAR_REGLE = '0';
    expect(sujetParRegle('Supprime la soumission 3.')).toBeNull();
  });

  it('sur tous les cas de l’éval : quand la règle tranche un ordre, l’outil attendu est dans le jeu chargé', () => {
    const racine = resolve(__dirname, '..', 'evals', 'lumi-tools');
    const fichiers = [...readdirSync(resolve(racine, 'cas')).map((f) => resolve(racine, 'cas', f)), resolve(racine, 'cas-prod', 'prod.json')];
    const cas = fichiers.flatMap((f) => JSON.parse(readFileSync(f, 'utf8'))) as Array<{ id: string; q: string; outil: string | null }>;
    let ordres = 0, tranches = 0; const rates: string[] = [];
    for (const c of cas) {
      if (!c.outil || !estDemandeDAction(c.q)) continue;
      ordres++;
      const sujet = sujetParRegle(c.q);
      if (!sujet) continue;
      tranches++;
      if (!outilsDuSousAgent(sujet).includes(c.outil)) rates.push(`${c.id} → ${sujet} (attend ${c.outil})`);
    }
    // Mesuré le 2026-10-01 : 260 ordres tranchés sur 377 (69 %), 1 raté (delete_availability-3).
    // Le routeur, sur les mêmes cas : 218 sur 238 (91,6 %).
    expect(tranches / ordres).toBeGreaterThan(0.6);
    expect(rates.length, rates.join(' | ')).toBeLessThanOrEqual(2);
  });
});

describe('le sujet par règle dans la route', () => {
  it('un verdict de règle charge le sous-agent, sans coût', () => {
    const r = resultatParRegle('devis');
    expect(r.usage).toBeUndefined();
    expect(r.source).toBe('regle');
    expect(sousAgentDepuisVerdict(r)).toBe('devis');
  });

  it('une action du routeur écartée garde son sujet (« supprime la job 48 » ne part plus avec le jeu de base)', () => {
    const r = { statut: 'ok' as const, decision: 'action' as const, duree_ms: 1, verdict: { topic: 'planification' as const, action: 'job-numero', params: { numero: '48' }, confidence: 0.95 } };
    expect(sousAgentDepuisVerdict(r)).toBeNull();
    expect(sousAgentDepuisVerdict(r, { actionEcartee: true })).toBe('planification');
  });

  it('la route n’appelle la règle que pour un ordre, et le routeur seulement si elle se tait', () => {
    const src = readFileSync(resolve(__dirname, '..', 'server', 'routes', 'lumi.ts'), 'utf8');
    expect(src).toContain('const sujetRegle = estDemandeDAction(message) ? sujetParRegle(message) : null;');
    expect(src).toContain('routeur = sujetRegle ? resultatParRegle(sujetRegle) : await classifier(message, contexteRouteur(historique));');
    expect(src).toContain('sousAgentDepuisVerdict(routeur, { actionEcartee: true })');
  });
});
