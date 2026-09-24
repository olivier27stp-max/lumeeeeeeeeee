/**
 * « ARRÊTER QUAND LE CLIENT RÉPOND » — le réglage qui ne servait à rien.
 *
 * L'interrupteur existait dans l'onglet Réglages, s'enregistrait en base
 * (`automation_rules.settings.arret_sur_reponse`)… et le moteur ne le lisait
 * JAMAIS. Un client qui répondait recevait quand même les trois relances
 * suivantes. C'est le pire effet possible d'une automatisation : elle
 * continue de parler à quelqu'un qui a déjà répondu.
 *
 * Ce fichier tient la garde sur les quatre décisions qui comptent :
 *   1. le moteur LIT le réglage ;
 *   2. il ne regarde que les messages reçus APRÈS la planification ;
 *   3. une lecture impossible n'annule RIEN (on ne supprime pas un envoi
 *      sur une information qu'on n'a pas pu vérifier) ;
 *   4. seules les actions qui PARLENT au client sont concernées.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RACINE = resolve(__dirname, '..');
const moteur = readFileSync(resolve(RACINE, 'server/lib/automationEngine.ts'), 'utf8');
const webhookSms = readFileSync(resolve(RACINE, 'server/routes/messages.ts'), 'utf8');
const hooks = readFileSync(resolve(RACINE, 'server/routes/automation-events.ts'), 'utf8');
const tachesApi = readFileSync(resolve(RACINE, 'src/lib/tasksApi.ts'), 'utf8');
const routeNotes = readFileSync(resolve(RACINE, 'server/routes/activity-notes.ts'), 'utf8');
const actions = readFileSync(resolve(RACINE, 'server/lib/actions/index.ts'), 'utf8');

describe('le réglage « arrêter sur réponse » est vraiment branché', () => {
  it('le moteur LIT `arret_sur_reponse` (il ne l’ignorait plus)', () => {
    // La garde principale : ce réglage était déclaré dans `ReglagesRegle` et
    // dans le schéma Zod, mais le mot n'apparaissait nulle part dans la
    // logique du worker. Un réglage qu'on affiche sans le lire est un
    // mensonge à l'écran.
    const logique = moteur.slice(moteur.indexOf('async function processScheduledTasks'));
    expect(
      logique.includes('arret_sur_reponse'),
      'le worker doit lire `reglagesRegle.arret_sur_reponse`',
    ).toBe(true);

    /*
     * Et il doit le lire POUR DE VRAI.
     *
     * Vérifié en sabotant le code : remplacer la condition par
     * `if (false && reglagesRegle?.arret_sur_reponse …)` laissait ce test
     * au vert — le mot était encore là, la garde était morte. On exige donc
     * que la condition commence par la NÉGATION de `shouldStop`, la seule
     * forme qui exécute vraiment la vérification.
     */
    expect(
      logique,
      'la garde doit être atteignable : `if (!shouldStop && reglagesRegle?.arret_sur_reponse`',
    ).toMatch(/if \(!shouldStop && reglagesRegle\?\.arret_sur_reponse/);

    // Et le résultat doit servir à ANNULER, pas dormir dans une variable.
    expect(logique, '`stopReponse` doit décider de l’annulation')
      .toMatch(/if \(shouldStop \|\| stopReponse\)/);
  });

  it('ne compte que les messages ENTRANTS reçus APRÈS la planification', () => {
    const fn = moteur.slice(
      moteur.indexOf('async function clientARepondu'),
      moteur.indexOf('async function checkStopConditions'),
    );
    expect(fn, 'sans `direction = inbound`, un message SORTANT de la relance elle-même compterait comme une réponse')
      .toMatch(/direction['"]?\s*,\s*['"]inbound/);
    // `gte('created_at', depuis)` : une conversation ANCIENNE ne doit pas
    // empêcher une nouvelle relance de partir.
    expect(fn, 'sans borne de date, une vieille conversation annulerait toute relance future')
      .toMatch(/gte\(\s*['"]created_at['"]/);
    expect(fn).toMatch(/limit\(\s*1\s*\)/);
  });

  it('une lecture impossible n’annule RIEN', () => {
    const fn = moteur.slice(
      moteur.indexOf('async function clientARepondu'),
      moteur.indexOf('async function checkStopConditions'),
    );
    // Le bloc d'erreur doit retourner `false` — donc « je ne sais pas, donc
    // je n'annule pas ». La même prudence que `checkStopConditions`.
    const blocErreur = fn.slice(fn.indexOf('if (error)'));
    expect(blocErreur.slice(0, 220), 'une erreur de lecture ne doit jamais supprimer un envoi')
      .toMatch(/return false/);
  });

  it('un client sans identifiant ne fait jamais annuler', () => {
    const fn = moteur.slice(
      moteur.indexOf('async function clientARepondu'),
      moteur.indexOf('async function checkStopConditions'),
    );
    expect(fn).toMatch(/if \(!clientId\) return false/);
  });

  it('seules les actions qui parlent au CLIENT sont concernées', () => {
    // Annuler « ajouter une note » ou « créer une tâche » parce que le client
    // a écrit n'aurait aucun sens : ces actions sont internes.
    const zone = moteur.slice(moteur.indexOf('let stopReponse = false;'));
    const garde = zone.slice(0, 400);
    for (const action of ['send_sms', 'send_email']) {
      expect(garde, `« ${action} » doit être concernée par l’arrêt sur réponse`).toContain(action);
    }
    expect(garde, 'la garde doit filtrer par type d’action').toMatch(/taskType ===/);
  });

  it('la tâche annulée dit POURQUOI', () => {
    // « Annulée » sans explication est la plainte n°1 sur ce genre d'écran :
    // l'onglet Journaux affiche `last_error` en clair.
    const zone = moteur.slice(moteur.indexOf('if (shouldStop || stopReponse) {'));
    expect(zone.slice(0, 900)).toMatch(/last_error/);
    expect(zone.slice(0, 900)).toMatch(/le client a répondu/);
  });

  it('le client est résolu par les VRAIS liens du schéma', () => {
    const fn = moteur.slice(
      moteur.indexOf('async function clientDeLaTache'),
      moteur.indexOf('async function clientARepondu'),
    );
    // Les trois pièges vérifiés en base le 2026-09-24 :
    expect(fn, 'un `lead` EST une fiche clients').toMatch(/entityType === 'lead'/);
    expect(fn, 'une visite n’a pas de client_id : elle passe par son job').toMatch(/schedule_events/);
    expect(fn, 'un devis porte DEUX liens vers clients').toMatch(/lead_id/);
  });
});

describe('le déclencheur « le client répond » part au bon moment', () => {
  it('l’événement est émis depuis le webhook des SMS entrants', () => {
    expect(webhookSms, 'sans émission, le déclencheur ne partirait jamais')
      .toMatch(/emit\(\s*['"]client\.replied['"]/);
  });

  it('un MEMBRE de l’équipe qui écrit ne déclenche rien', () => {
    /*
     * Un technicien qui envoie un texto à Lumi n'est pas un client qui
     * répond. Sans cette garde, chaque question posée à l'assistant
     * déclencherait les automatisations de « réponse client ».
     */
    const zone = webhookSms.slice(webhookSms.indexOf("emit('client.replied'") - 700);
    expect(zone.slice(0, 700), 'la garde `!repondaLumi` doit encadrer l’émission')
      .toMatch(/if \(!repondaLumi/);
  });

  it('un numéro sans fiche client ne déclenche rien', () => {
    // Sans `client_id`, aucune action ne saurait à qui s'adresser.
    const zone = webhookSms.slice(webhookSms.indexOf("emit('client.replied'") - 700);
    expect(zone.slice(0, 700)).toMatch(/conversation\.client_id/);
  });

  it('l’entité est le CLIENT, pas la conversation', () => {
    // C'est du client que les actions ont besoin, et c'est lui que les
    // variables décrivent (`[client_name]`, `[client_phone]`).
    const zone = webhookSms.slice(webhookSms.indexOf("emit('client.replied'"));
    expect(zone.slice(0, 420)).toMatch(/entityType:\s*['"]client['"]/);
    expect(zone.slice(0, 420)).toMatch(/entityId:\s*conversation\.client_id/);
  });

  it('le texte reçu est borné', () => {
    // Un SMS de 1 600 caractères recopié dans `activity_log` à chaque
    // réponse gonflerait la table pour rien.
    const zone = webhookSms.slice(webhookSms.indexOf("emit('client.replied'"));
    expect(zone.slice(0, 600)).toMatch(/slice\(0,\s*500\)/);
  });
});

describe('le déclencheur « étiquette ajoutée » ne part pas dans le vide', () => {
  const route = hooks.slice(hooks.indexOf("'/automations/events/client-tagged'"));

  it('l’étiquette doit VRAIMENT être posée', () => {
    /*
     * Ce point de contact est appelé par le NAVIGATEUR : sans vérification,
     * n'importe qui pourrait déclencher les automatisations d'une étiquette
     * qu'il n'a jamais posée. On relit donc `client_tags` avant d'émettre.
     */
    expect(route.slice(0, 2000), 'la route doit relire `client_tags` avant d’émettre')
      .toMatch(/from\('client_tags'\)/);
    expect(route.slice(0, 2000)).toMatch(/status\(409\)/);
  });

  it('le client doit appartenir à l’organisation de l’appelant', () => {
    // Sans ce filtre, on pourrait faire partir une séquence chez un
    // concurrent en devinant un identifiant.
    expect(route.slice(0, 2000)).toMatch(/eq\('org_id',\s*auth\.orgId\)/);
    expect(route.slice(0, 2000)).toMatch(/status\(404\)/);
  });

  it('le RETRAIT d’étiquette n’existe pas comme déclencheur', () => {
    // Décision assumée : enlever un marqueur ne doit jamais déclencher un
    // envoi au client. Si quelqu'un ajoute la route, ce test le force à
    // relire ce choix.
    expect(hooks).not.toMatch(/client-untagged|tag-removed/);
  });

  it('l’étiquette voyage dans les métadonnées', () => {
    // Sans elle, impossible d'écrire « quand l'étiquette est À rappeler » :
    // toutes les étiquettes déclencheraient la même règle.
    const emission = route.slice(route.indexOf("emit('client.tagged'"), route.indexOf("emit('client.tagged'") + 700);
    // Deux vérifications simples plutôt qu'une expression alambiquée : un
    // test illisible se fait contourner au premier échec.
    expect(emission, 'l’étiquette doit voyager dans les métadonnées').toContain('metadata:');
    expect(emission, '`tag` doit être dans les métadonnées, pour les conditions').toMatch(/^\s*tag,$/m);
    expect(emission).toMatch(/entityType:\s*'client'/);
  });
});

describe('le déclencheur « tâche terminée » ne part que quand il faut', () => {
  const route = hooks.slice(hooks.indexOf("'/automations/events/task-completed'"));

  it('la tâche doit VRAIMENT être terminée', () => {
    // Appelé par le navigateur : une séquence déclenchée sur une tâche
    // encore ouverte enverrait un suivi pour un travail non fait.
    expect(route.slice(0, 1200)).toMatch(/status !== 'done'/);
    expect(route.slice(0, 1200)).toMatch(/status\(409\)/);
  });

  it('une tâche SANS client n’émet rien — et ce n’est pas une erreur', () => {
    /*
     * « Commander des pièces » n'a personne à qui écrire. Émettre quand
     * même ferait échouer toute action de message, réessayée trois fois
     * pour rien. On répond 200 avec `emis: false`.
     */
    expect(route.slice(0, 3200)).toMatch(/emis:\s*false/);
    expect(route.slice(0, 3200)).toMatch(/tâche sans client rattaché/);
  });

  it('le client est résolu par les CINQ liens permis de `tasks`', () => {
    // `tasks_linked_entity_type_check` n'admet que ces cinq valeurs.
    const bloc = route.slice(0, 3200);
    for (const t of ['client', 'lead', 'job', 'invoice', 'quote']) {
      expect(bloc, `le lien « ${t} » doit être traité`).toContain(`'${t}'`);
    }
    // Un devis porte DEUX liens vers clients.
    expect(bloc).toMatch(/lead_id/);
  });

  it('le titre voyage dans les métadonnées', () => {
    // Sans lui, impossible d'écrire « quand la tâche “Rappeler” est
    // terminée » : toutes les tâches déclencheraient la même règle.
    expect(route.slice(0, 3600)).toMatch(/task_title/);
  });

  it('un marquage EN LOT émet un événement par tâche', () => {
    /*
     * Le moteur raisonne sur UNE tâche et UN client. Sans la boucle,
     * marquer dix tâches terminées d'un coup n'enverrait qu'un seul suivi
     * — neuf clients seraient oubliés en silence.
     */
    const bulk = tachesApi.slice(tachesApi.indexOf('export async function bulkUpdateTaskStatus'));
    expect(bulk.slice(0, 900)).toMatch(/for \(const id of ids\) emitTaskCompleted/);
  });

  it('l’émission part APRÈS l’écriture réussie', () => {
    // Émettre avant ferait partir une séquence sur une tâche qui n'a pas
    // changé de statut.
    const maj = tachesApi.slice(
      tachesApi.indexOf('export async function updateTask'),
      tachesApi.indexOf('// ── Delete task'),
    );
    const posErreur = maj.indexOf('if (error) throw error');
    const posEmit = maj.indexOf('emitTaskCompleted');
    expect(posErreur).toBeGreaterThan(-1);
    expect(posEmit, 'l’émission doit suivre le `throw` en cas d’échec').toBeGreaterThan(posErreur);
  });
});

describe('le déclencheur « note ajoutée » ne peut pas boucler', () => {
  it('l’action du moteur n’écrit PAS par la route humaine', () => {
    /*
     * LE piège n°1 de ce déclencheur chez GoHighLevel : une règle
     * « note ajoutée → ajouter une note » qui s'auto-déclenche à l'infini.
     *
     * Chez nous c'est impossible par construction : l'action du moteur
     * écrit dans `notes` avec le client service_role, tandis que
     * l'événement part de `activity_notes` — deux tables, deux chemins.
     * Ce test verrouille la séparation.
     */
    const action = actions.slice(actions.indexOf('export async function executeAjouterNote'));
    expect(action.slice(0, 1800), 'l’action écrit dans `notes`').toMatch(/from\('notes'\)/);
    expect(action.slice(0, 1800), 'et JAMAIS dans `activity_notes`, d’où part l’événement')
      .not.toMatch(/activity_notes/);
  });

  it('l’événement part de la route HUMAINE, qui exige une session', () => {
    const creation = routeNotes.slice(0, routeNotes.indexOf('// ── Soft-delete'));
    expect(creation).toMatch(/requireAuthedClient/);
    expect(creation).toMatch(/emit\('note\.added'/);
  });

  it('une note sur un JOB remonte au client', () => {
    // C'est le client que les messages décrivent, pas le job.
    const zone = routeNotes.slice(routeNotes.indexOf("emit('note.added'") - 900);
    expect(zone.slice(0, 900)).toMatch(/entityType === 'job'/);
    expect(zone.slice(0, 900)).toMatch(/client_id/);
  });

  it('un job sans client n’émet rien', () => {
    const zone = routeNotes.slice(routeNotes.indexOf("emit('note.added'") - 900);
    expect(zone.slice(0, 900), 'sans destinataire, aucune action de message ne pourrait aboutir')
      .toMatch(/if \(!clientId\) return/);
  });

  it('un échec d’émission ne fait pas échouer l’ajout de note', () => {
    // La note est déjà enregistrée et affichée : la perdre pour une panne
    // du bus serait absurde.
    const zone = routeNotes.slice(routeNotes.indexOf("emit('note.added'") - 1200);
    expect(zone.slice(0, 2200)).toMatch(/catch/);
    expect(zone.slice(0, 2200)).toMatch(/non émis/);
  });

  it('le texte de la note est borné', () => {
    const zone = routeNotes.slice(routeNotes.indexOf("emit('note.added'"));
    expect(zone.slice(0, 600)).toMatch(/slice\(0,\s*500\)/);
  });
});
