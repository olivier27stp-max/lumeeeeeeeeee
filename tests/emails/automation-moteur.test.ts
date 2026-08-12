/**
 * Lot 2 du chantier automatisations — fiabilité du moteur.
 *
 * Quatre défauts, invisibles pour l'utilisateur mais structurels :
 *   1. six lectures Supabase non vérifiées annulaient des relances à tort ;
 *   2. une tâche interrompue restait bloquée pour toujours, et verrouillait
 *      sa clé d'unicité ;
 *   3. aucun verrou sur les deux planificateurs, alors que tous les autres
 *      crons du produit en ont un ;
 *   4. créer une tâche depuis un rendez-vous violait une contrainte.
 *
 * Voir docs/plan-chantier-automatisations.md §P5 à P9.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

// ───────────────────────────────────────────────────────────────────
// 1. Une erreur de lecture n'annule plus une relance
// ───────────────────────────────────────────────────────────────────

describe('conditions d’arrêt — une erreur ne conclut rien', () => {
  const engine = read('server/lib/automationEngine.ts');
  const fn = engine.slice(
    engine.indexOf('async function checkStopConditions'),
    engine.indexOf('// ── Public API'),
  );

  it('les six lectures vérifient leur erreur', () => {
    // `supabase-js` ne lève pas : sur erreur, `data` vaut `null` — que le code
    // interprétait comme « entité supprimée » → annulation DÉFINITIVE. Un
    // hoquet de deux secondes suffisait à supprimer des relances en attente.
    const lectures = (fn.match(/await supabase\s*\n?\s*\.from\(/g) || []).length;
    const verifs = (fn.match(/if \(\w*[eE]rr\w*\) return illisible\(/g) || []).length;
    expect(lectures).toBeGreaterThanOrEqual(6);
    expect(verifs).toBe(lectures);
  });

  it('une lecture illisible conserve la tâche', () => {
    // `false` = ne pas annuler. Le tick suivant réessaiera.
    expect(fn).toContain('const illisible =');
    expect(fn).toContain('return false; // ne PAS annuler');
    expect(fn).toContain("condition d'arrêt indéterminable");
  });

  it('les conditions d’arrêt réelles restent intactes', () => {
    // Non-régression : ce sont elles qui empêchent de relancer un client qui a
    // déjà payé ou accepté.
    expect(fn).toContain("['paid', 'cancelled', 'void'].includes(inv.status)");
    expect(fn).toContain("'approved', 'declined', 'changes_requested'");
    expect(fn).toContain("evt.status === 'cancelled'");
  });
});

// ───────────────────────────────────────────────────────────────────
// 2. Les tâches figées sont récupérées
// ───────────────────────────────────────────────────────────────────

describe('tâches interrompues — plus de blocage définitif', () => {
  const engine = read('server/lib/automationEngine.ts');

  it('les tâches « en cours » trop anciennes repassent en file', () => {
    // Sans ça : le fetch ne sélectionne que `pending`, donc une tâche
    // interrompue n'était jamais reprise — ET sa clé d'unicité restait
    // occupée, rendant l'entité sourde pour cette règle à jamais.
    expect(engine).toContain('async function recupererTachesFigees');
    expect(engine).toContain("eq('status', 'running')");
    expect(engine).toContain("update({ status: 'pending'");
    expect(engine).toContain('TACHE_FIGEE_MS');
  });

  it('la récupération tourne avant chaque traitement', () => {
    const proc = engine.slice(engine.indexOf('export async function processScheduledTasks'));
    const recup = proc.indexOf('await recupererTachesFigees(supabase)');
    const fetch = proc.indexOf("eq('status', 'pending')");
    expect(recup).toBeGreaterThan(-1);
    expect(fetch).toBeGreaterThan(recup);
  });

  it('le délai laisse le temps à une action lente de finir', () => {
    // Un envoi SMTP ou Twilio poussif ne doit pas être repris en parallèle.
    expect(engine).toContain('15 * 60 * 1000');
  });

  it('la prise horodate la tâche, faute de colonne updated_at', () => {
    // La table n'a PAS de `updated_at` — vérifié en base. Sans réécrire
    // `execute_at` à la prise, la détection n'aurait aucun repère temporel.
    expect(engine).toContain("execute_at: new Date().toISOString() })");
  });
});

// ───────────────────────────────────────────────────────────────────
// 3. La prise de tâche est atomique
// ───────────────────────────────────────────────────────────────────

describe('prise de tâche — une seule instance l’emporte', () => {
  const engine = read('server/lib/automationEngine.ts');

  it('la mise à jour filtre sur le statut attendu', () => {
    // Sans `.eq('status','pending')`, deux instances réussissaient toutes les
    // deux leur UPDATE et exécutaient l'action : le client recevait le message
    // en double.
    const bloc = engine.slice(
      engine.indexOf('const { data: claimed, error: claimError }'),
      engine.indexOf('if (claimError)'),
    );
    expect(bloc).toContain(".eq('status', 'pending')");
    expect(bloc).toContain(".select('id')");
  });

  it('zéro ligne touchée fait passer son tour', () => {
    expect(engine).toContain('if (!claimed || claimed.length === 0) continue;');
  });
});

// ───────────────────────────────────────────────────────────────────
// 4. Les planificateurs sont verrouillés
// ───────────────────────────────────────────────────────────────────

describe('planificateurs — verrou et anti-chevauchement', () => {
  const scheduler = read('server/lib/scheduler.ts');
  const recurring = read('server/lib/recurringJobScheduler.ts');

  it('le moteur d’automatisation tourne sous verrou', () => {
    // Tous les autres crons du produit l'utilisent ; celui-ci, le seul à
    // ENVOYER aux clients, en était dépourvu.
    expect(scheduler).toContain("withAdvisoryLock('automation-scheduler'");
    expect(scheduler).toContain('async function tickProtege');
  });

  it('les jobs récurrents aussi', () => {
    // Création d'occurrence et avancement de la date ne sont pas atomiques :
    // deux passages concurrents créent deux jobs identiques, visibles par
    // l'utilisateur.
    expect(recurring).toContain("withAdvisoryLock('recurring-jobs'");
    expect(recurring).toContain('async function passageProtege');
  });

  it('un tick lent ne se fait pas doubler par le suivant', () => {
    // `setInterval` relance toutes les 5 min sans se soucier de la durée du
    // tick précédent.
    expect(scheduler).toContain('let tickEnCours = false');
    expect(scheduler).toContain('tick précédent encore en cours');
    expect(recurring).toContain('let passageEnCours = false');
  });

  it('la garde est libérée même en cas d’erreur', () => {
    // Sans `finally`, une exception bloquerait le planificateur pour toujours.
    for (const src of [scheduler, recurring]) {
      expect(src).toContain('} finally {');
    }
    expect(scheduler).toContain('tickEnCours = false;');
    expect(recurring).toContain('passageEnCours = false;');
  });

  it('les deux verrous portent des noms distincts', () => {
    // Un nom partagé ferait s'exclure deux traitements indépendants.
    expect(scheduler).toContain("'automation-scheduler'");
    expect(recurring).toContain("'recurring-jobs'");
  });
});

// ───────────────────────────────────────────────────────────────────
// 5. Créer une tâche depuis un rendez-vous fonctionne
// ───────────────────────────────────────────────────────────────────

describe('création de tâche — plus de violation de contrainte', () => {
  const actions = read('server/lib/actions/index.ts');
  const fn = actions.slice(
    actions.indexOf('export async function executeCreateTask'),
    actions.indexOf('// ── Action: Update Status'),
  );

  it('les entités hors contrainte sont converties', () => {
    // `tasks.linked_entity_type` n'admet que client|lead|quote|invoice|job.
    // Écrire `schedule_event` violait la contrainte : la règle échouait, était
    // réessayée 3 fois pour rien, puis abandonnée — sans que l'utilisateur ne
    // voie rien.
    expect(fn).toContain('TYPES_VALIDES');
    expect(fn).toContain("'client', 'lead', 'quote', 'invoice', 'job'");
  });

  it('un rendez-vous est rattaché à son job', () => {
    // Sémantiquement juste : une visite appartient à un job.
    expect(fn).toContain("ctx.entityType === 'schedule_event'");
    expect(fn).toContain("lienType = 'job'");
    expect(fn).toContain('evt?.job_id');
  });

  it('une entité non représentable donne une tâche sans lien', () => {
    // Mieux vaut une tâche sans lien que pas de tâche du tout.
    expect(fn).toContain('lienType = null');
    expect(fn).toContain('lienId = null');
  });

  it('l’insertion utilise les valeurs converties', () => {
    expect(fn).toContain('linked_entity_type: lienType');
    expect(fn).toContain('linked_entity_id: lienId');
    expect(fn).not.toContain('linked_entity_type: ctx.entityType');
  });
});

// ───────────────────────────────────────────────────────────────────
// 6. Déplacer une visite replanifie réellement les rappels
// ───────────────────────────────────────────────────────────────────

describe('déplacement de visite — les rappels suivent la nouvelle date', () => {
  const route = read('server/routes/automation-events.ts');
  const bloc = route.slice(
    route.indexOf("router.post('/automations/events/appointment-rescheduled'"),
    route.indexOf("router.post('/automations/events/job-completed'"),
  );

  it('les rappels périmés sont annulés', () => {
    // Une version précédente se contentait d'émettre `appointment.updated` :
    // aucun preset ne l'écoute, il n'est pas dans EVENT_TO_TRIGGER, et rien
    // n'annulait les tâches. La route retournait pourtant { ok: true }.
    expect(bloc).toContain("from('automation_scheduled_tasks')");
    expect(bloc).toContain("status: 'cancelled'");
    expect(bloc).toContain("eq('entity_id', eventId)");
    expect(bloc).toContain("eq('status', 'pending')");
  });

  it('l’annulation est cloisonnée par organisation', () => {
    expect(bloc).toContain("eq('org_id', auth.orgId)");
  });

  it('l’annulation précède la replanification — l’ordre est vital', () => {
    // L'index d'unicité couvre `pending` ET `running`. Ré-émettre d'abord ferait
    // rejeter la nouvelle planification (23505) et il ne resterait que les
    // anciennes tâches : pire que le bug d'origine.
    const annulation = bloc.indexOf("status: 'cancelled'");
    const emission = bloc.indexOf("eventBus.emit('appointment.created'");
    expect(annulation).toBeGreaterThan(-1);
    expect(emission).toBeGreaterThan(annulation);
  });

  it('l’événement émis est celui que les presets écoutent vraiment', () => {
    // `appointment.updated` n'est écouté par aucun preset — vérifié en base.
    expect(bloc).toContain("eventBus.emit('appointment.created'");
    expect(bloc).not.toContain("eventBus.emit('appointment.updated'");
    // Le drapeau distingue un déplacement d'une création, pour les journaux.
    expect(bloc).toContain('rescheduled: true');
  });

  it('un échec d’annulation interrompt la route', () => {
    // Sans annulation, la replanification échouerait sur l'unicité : mieux
    // vaut une erreur franche qu'un { ok: true } trompeur.
    expect(bloc).toContain('annulation des rappels périmés échouée');
    expect(bloc).toContain('return res.status(500)');
  });

  it('les deux chemins de déplacement appellent bien la route', () => {
    // Modal « Nouveau job » (via le flag `updated` du RPC) et glisser-déposer
    // dans le calendrier.
    expect(read('src/lib/jobsApi.ts')).toContain('emitAppointmentRescheduled(params)');
    expect(read('src/lib/scheduleApi.ts')).toContain('emitAppointmentRescheduled({');
  });
});
