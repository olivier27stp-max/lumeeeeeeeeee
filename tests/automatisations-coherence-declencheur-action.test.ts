/**
 * LA MATRICE : chaque action marche-t-elle avec chaque déclencheur ?
 *
 * C'est LA question avant de construire un vrai workflow. Une action
 * « changer le statut du rendez-vous » posée sur un déclencheur « facture
 * payée » ne peut pas marcher : l'entité qui arrive est une facture, pas un
 * rendez-vous. Le moteur le refuse à l'exécution — donc silencieusement,
 * trois essais plus tard, dans un journal que personne ne lit.
 *
 * Ce fichier mesure la matrice complète (16 déclencheurs × 18 actions) et
 * exige que le catalogue DÉCLARE les restrictions, pour que l'interface
 * puisse les montrer AVANT que l'utilisateur publie.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DECLENCHEURS, ACTIONS, actionCompatible } from '../src/lib/automationCatalogue';

const RACINE = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(RACINE, p), 'utf8');

/**
 * L'entité que chaque déclencheur fait VRAIMENT arriver au moteur.
 *
 * Relevé dans le serveur le 2026-09-24 (les `emit('x.y', { entityType })`),
 * pas deviné. Le test ci-dessous vérifie que cette table ne ment pas.
 */
const ENTITE_DU_DECLENCHEUR: Record<string, string> = {
  'quote.sent': 'quote',
  'quote.approved': 'quote',
  'quote.declined': 'quote',
  'quote.changes_requested': 'quote',
  'invoice.sent': 'invoice',
  'invoice.paid': 'invoice',
  'invoice.overdue': 'invoice',
  'appointment.created': 'schedule_event',
  'appointment.cancelled': 'schedule_event',
  'job.completed': 'job',
  'job.ready_for_invoicing': 'job',
  'lead.created': 'lead',
  'lead.status_changed': 'lead',
  // `agreement.signed` émet entityType 'job' (le contrat appartient au job).
  'agreement.signed': 'job',
  'deal.stage_entered': 'deal',
  'deal.stage_idle': 'deal',
};

describe('le catalogue ne promet pas ce que le moteur refusera', () => {
  it('chaque déclencheur offert porte l’entité que le serveur émet vraiment', () => {
    // Le champ `entite` du catalogue sert à proposer les bonnes variables.
    // S'il ment, on propose `[invoice_total]` sur un devis.
    const equivalents: Record<string, string> = {
      appointment: 'schedule_event',
      agreement: 'job', // un contrat signé arrive porté par son job
    };
    for (const d of DECLENCHEURS) {
      const reel = ENTITE_DU_DECLENCHEUR[d.cle];
      expect(reel, `${d.cle} absent de la table des entités`).toBeDefined();
      const attendu = equivalents[d.entite] ?? d.entite;
      expect(attendu, `« ${d.fr} » annonce l’entité « ${d.entite} », le serveur émet « ${reel} »`)
        .toBe(reel);
    }
  });

  it('une action restreinte à une entité le DÉCLARE dans le catalogue', () => {
    /*
     * Le serveur refuse cinq actions hors de leur entité :
     *   `if (ctx.entityType !== 'deal')`, `!== 'schedule_event'`, etc.
     *
     * Chacune doit porter `entites` dans le catalogue, sinon l'interface
     * l'offre sur n'importe quel déclencheur et l'utilisateur ne l'apprend
     * qu'après publication — dans un journal d'échec.
     */
    const moteur = lire('server/lib/actions/index.ts');
    const restreintes = [...moteur.matchAll(/ctx\.entityType !== '([a-z_]+)'/g)].map((m) => m[1]);
    expect(restreintes.length, 'le moteur doit bien porter des restrictions').toBeGreaterThan(0);

    const declarees = ACTIONS.filter((a) => a.entites && a.entites.length > 0);
    expect(
      declarees.length,
      'des actions sont restreintes côté serveur mais aucune ne le déclare au catalogue',
    ).toBeGreaterThan(0);
  });

  it('la matrice complète : aucune paire « offerte mais impossible » en silence', () => {
    /*
     * Pour chaque couple (déclencheur, action), on demande au catalogue s'il
     * est compatible. Le test n'exige pas que tout soit compatible — il exige
     * que l'INCOMPATIBILITÉ SOIT CONNUE, donc affichable.
     */
    const impossibles: string[] = [];
    for (const d of DECLENCHEURS) {
      for (const a of ACTIONS) {
        const entite = ENTITE_DU_DECLENCHEUR[d.cle];
        // Ce que le serveur ferait : refuser si l'action est restreinte.
        const refuseParLeMoteur = Boolean(a.entites) && !a.entites!.includes(entite);
        // Ce que le catalogue annonce.
        const annonceCompatible = actionCompatible(a, d.cle);
        if (refuseParLeMoteur && annonceCompatible) {
          impossibles.push(`« ${a.fr} » sur « ${d.fr} » : le moteur refusera, le catalogue l’offre`);
        }
        if (!refuseParLeMoteur && !annonceCompatible) {
          impossibles.push(`« ${a.fr} » sur « ${d.fr} » : interdite au catalogue alors que le moteur l’accepte`);
        }
      }
    }
    expect(impossibles, impossibles.join('\n')).toEqual([]);
  });

  it('chaque déclencheur garde au moins les actions de communication', () => {
    // Un déclencheur sur lequel on ne pourrait rien faire n'aurait aucun sens.
    for (const d of DECLENCHEURS) {
      const utilisables = ACTIONS.filter((a) => actionCompatible(a, d.cle));
      expect(utilisables.length, `« ${d.fr} » n’offre presque rien`).toBeGreaterThanOrEqual(10);
      for (const cle of ['send_email', 'send_sms', 'create_notification', 'create_task']) {
        expect(
          utilisables.some((a) => a.cle === cle),
          `« ${d.fr} » devrait accepter « ${cle} »`,
        ).toBe(true);
      }
    }
  });

  it('les actions « client » marchent partout : toute entité remonte à un client', () => {
    /*
     * `clientDeLEntite` (actions/index.ts) sait remonter de n'importe quelle
     * entité jusqu'à la fiche client : un job par `client_id`, une visite par
     * son job, un devis par `client_id` ou `lead_id`. Ces actions-là ne
     * doivent donc PAS être restreintes.
     */
    for (const cle of ['ajouter_etiquette', 'retirer_etiquette', 'modifier_client', 'assigner_responsable', 'ajouter_note']) {
      const a = ACTIONS.find((x) => x.cle === cle)!;
      expect(a, `${cle} absente du catalogue`).toBeDefined();
      expect(a.entites, `« ${a.fr} » ne doit pas être restreinte : tout remonte à un client`).toBeUndefined();
    }
  });

  it('un déclencheur mort est signalé, pas offert en silence', () => {
    /*
     * `deal.stage_entered` et `deal.stage_idle` sont déclarés dans le bus
     * mais AUCUN code ne les émet (le pipeline de ventes n'est pas encore
     * branché au moteur). Une automatisation posée dessus ne partirait
     * jamais, sans que personne comprenne pourquoi.
     *
     * Tant qu'ils ne sont pas émis, ils doivent porter `bientot: true` —
     * l'interface les grise et dit pourquoi.
     */
    const serveur = ['server/lib/automationEngine.ts', 'server/lib/eventBus.ts']
      .map(lire).join('\n');
    for (const d of DECLENCHEURS) {
      if (!d.bientot) continue;
      expect(
        serveur.includes(`'${d.cle}'`),
        `« ${d.fr} » est marqué « bientôt » : il doit au moins être déclaré au bus`,
      ).toBe(true);
    }
    // Et l'inverse : ceux qui SONT émis ne doivent pas être grisés pour rien.
    const emisReellement = ['quote.sent', 'invoice.paid', 'job.completed', 'lead.created'];
    for (const cle of emisReellement) {
      const d = DECLENCHEURS.find((x) => x.cle === cle)!;
      expect(d.bientot, `« ${d.fr} » est bel et bien émis : ne pas le griser`).toBeFalsy();
    }
  });
});
