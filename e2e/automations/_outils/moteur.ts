/**
 * Le vrai moteur, à la demande, pour un bureau de test (voir moteur-cli.mts).
 *
 *   await avancerMoteur(bureau.orgA);
 *
 * À appeler après avoir provoqué un événement qui passe par une FILE :
 *  · écrit par la base : visite créée / annulée, job terminé, devis accepté
 *    ou refusé, facture envoyée… (automation_evenements_base) ;
 *  · du pipeline : entrée / sortie d'étape (pipeline_events) ;
 *  · une étape différée arrivée à échéance (automation_scheduled_tasks) —
 *    pour un délai long, avance d'abord `execute_at` en base.
 * Un événement émis par une ROUTE de l'API (prospect créé, devis envoyé…)
 * est traité tout de suite par l'API locale : pas besoin de ce script, sauf
 * pour ses étapes différées.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';

export interface PassageMoteur { base: number; pipeline: number; pieges: { twilio: number; http: number } }

export function avancerMoteur(orgId: string, delaiMs = 120_000): Promise<PassageMoteur> {
  const racine = process.cwd();
  const tsx = join(racine, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const cli = join(racine, 'e2e', 'automations', '_outils', 'moteur-cli.mts');
  return new Promise((ok, ko) => {
    const p = spawn(process.execPath, [tsx, cli, orgId], { cwd: racine, env: process.env, windowsHide: true });
    let sortie = '';
    let erreurs = '';
    const minuterie = setTimeout(() => { p.kill(); ko(new Error(`moteur : pas de fin après ${delaiMs} ms\n${erreurs.slice(-800)}`)); }, delaiMs);
    p.stdout.on('data', (d) => { sortie += String(d); });
    p.stderr.on('data', (d) => { erreurs += String(d); });
    p.once('exit', (code) => {
      clearTimeout(minuterie);
      if (code === 3) return ko(new Error('ARRÊT : un envoi a atteint un fournisseur piège — un envoi réel aurait été possible.'));
      const ligne = sortie.split('\n').reverse().find((l) => l.trim().startsWith('{'));
      if (code !== 0 || !ligne) return ko(new Error(`moteur : code ${code}\n${erreurs.slice(-1200)}\n${sortie.slice(-400)}`));
      ok(JSON.parse(ligne) as PassageMoteur);
    });
  });
}
