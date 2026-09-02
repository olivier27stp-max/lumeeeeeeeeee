import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * L'alerte « job en retard » et l'activation du moteur d'alertes.
 *
 * Contexte (2026-09-01, audit du robot de recette) : `runAlertScan` tournait
 * toutes les 30 minutes en production depuis la mise en ligne, mais
 * `alert_rules` était VIDE — aucune organisation n'avait de règle, et il
 * n'existait ni écran ni route pour en créer. Le moteur lisait une liste vide
 * et repartait. Personne n'a jamais été prévenu d'une facture en retard.
 *
 * Au même moment, « Late job alert » existait dans l'ancien constructeur de
 * workflows, marqué actif — mais son moteur avait été retiré. Ce type d'alerte
 * n'existait nulle part ailleurs : il a été ajouté ici.
 */

const RACINE = process.cwd();
const lire = (p: string) => fs.readFileSync(path.join(RACINE, p), 'utf8');

describe('le moteur d\'alertes gère les jobs en retard', () => {
  const moteur = lire('server/lib/alerts-engine.ts');

  it('le type job_overdue est aiguillé', () => {
    expect(moteur).toContain("case 'job_overdue':");
    expect(moteur).toContain('await checkJobOverdue(sb, rule)');
  });

  it('ne retient que les jobs ni terminés ni en brouillon', () => {
    // `draft` n'est pas encore planifié, `completed` est fini : ni l'un ni
    // l'autre ne peut être « en retard ».
    expect(moteur).toContain("\.in('status', ['scheduled', 'in_progress'])");
  });

  it('ignore les jobs sans date et ceux mis de côté', () => {
    expect(moteur).toContain("\.not('scheduled_at', 'is', null)");
    expect(moteur).toContain("\.is('deleted_at', null)");
  });

  it('ne laisse pas une erreur de requête passer en silence', () => {
    // Sans ce garde, une colonne renommée rendrait l'alerte muette sans que
    // rien ne le signale — le défaut même que cet audit cherche à éliminer.
    const bloc = moteur.slice(moteur.indexOf('async function checkJobOverdue'));
    const fin = bloc.slice(0, bloc.indexOf('\n}'));
    expect(fin).toContain('if (error)');
    expect(fin).toContain('console.error');
  });

  it('produit une notification rattachée au job', () => {
    const bloc = moteur.slice(moteur.indexOf('async function checkJobOverdue'));
    const fin = bloc.slice(0, bloc.indexOf('\n}'));
    expect(fin).toContain("category: 'job_overdue'");
    expect(fin).toContain("entity_type: 'job'");
  });
});

describe('la migration active bien les alertes', () => {
  const migration = 'supabase/migrations/20260901180000_activer_alertes.sql';
  const sql = lire(migration);

  it('crée les quatre types', () => {
    for (const t of ['invoice_overdue', 'job_overdue', 'client_inactive', 'low_pipeline']) {
      expect(sql).toContain(`'${t}'`);
    }
  });

  it('n\'envoie aucun courriel', () => {
    // Les alertes vont dans le centre de notifications. Un seuil mal réglé ne
    // doit pas pouvoir noyer une boîte de réception.
    expect(sql).toMatch(/notify_email[\s\S]*?false/);
  });

  it('est rejouable sans créer de doublon', () => {
    expect(sql).toContain('not exists');
    expect(sql).toContain('from public.alert_rules ar');
  });

  it('échoue si aucune règle n\'est active au final', () => {
    expect(sql).toContain('le moteur resterait muet');
  });
});
