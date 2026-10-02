/**
 * Agent D — le JEU CONNU d'exécutions du bureau A (suffixe d).
 *
 * Tout passe par le VRAI moteur (harnais `tests/automations-suite/harnais/moteur.ts`) :
 * règles en base, événements émis par le bus, actions exécutées, journaux écrits par le
 * moteur lui-même. Les seules retouches faites à la main sont les DATES (`created_at`
 * antidaté de 3, 10, 40 et 70 jours) : le moteur ne sait pas voyager dans le temps.
 *
 * Un scénario = une règle = une issue attendue. Chaque règle est publiée le temps de ses
 * propres événements, puis remise en brouillon : aucune autre ne réagit à ses clients.
 *
 * Le manifeste (ce qu'on a fabriqué, ce que chaque écran DEVRAIT montrer) est écrit hors du
 * dépôt : D:/lume-final/sorties/d/jeu-connu.json. Les preuves d'écran le relisent.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { demarrerMoteur, attendre, journalDefinitif, traiterFile } from '../../automations-suite/harnais/moteur';

export const PREFIXE = '[QA-D jeu]';
export const DOSSIER_SORTIES = process.env.QA_D_SORTIES || 'D:/lume-final/sorties/d';
export const FICHIER_MANIFESTE = `${DOSSIER_SORTIES}/jeu-connu.json`;

const JOUR_MS = 86_400_000;

/** Les issues qu'on veut voir comptées, et lues, à l'écran. */
export type Issue = 'reussi' | 'echec' | 'saute' | 'ecarte' | 'reporte' | 'doublon';

/**
 * Ce qu'UN client du jeu a produit dans sa règle. Les attentes d'une période (7, 30, 90 jours)
 * s'en déduisent : la somme des clients assez récents (`attendu()` plus bas).
 *
 * Définitions (les mêmes que `server/lib/automations-stats.ts`) :
 *   declenchee  la fiche est entrée dans l'automatisation ;
 *   envoyees    messages partis chez le client ; actions = actions internes faites ;
 *   echouees    échecs DÉFINITIFS (une action reprise quatre fois compte une fois) ;
 *   ignorees    par code (désabonné, sans téléphone, conditions, plafond…) ;
 *   reportees   par code (hors heures d'envoi) ;
 *   journal     lignes de l'onglet Journaux (lignes du journal + états de la file sans ligne) ;
 *   en_cours    la fiche a encore une étape en file (maintenant, sans période).
 */
export interface Profil {
  declenchee: 0 | 1;
  envoyees: number;
  actions: number;
  echouees: number;
  ignorees: Record<string, number>;
  reportees: Record<string, number>;
  journal: number;
  en_cours: 0 | 1;
}

const profil = (p: Partial<Profil>): Profil => ({
  declenchee: 1, envoyees: 0, actions: 0, echouees: 0, ignorees: {}, reportees: {}, journal: 1, en_cours: 0, ...p,
});

export interface ClientDuJeu { id: string; nom: string; age_jours: number; profil: Profil }

export interface RegleDuJeu {
  cle: string;
  id: string;
  nom: string;
  issue: Issue;
  /** Le `saute_code` attendu dans `result_data`, quand l'issue est un saut. */
  code?: string;
  /** La raison telle qu'un propriétaire devrait la lire. */
  raison: string;
  clients: ClientDuJeu[];
}

export interface Manifeste {
  construit_le: string;
  orgA: string;
  orgB: string;
  fuseau: string;
  regles: Record<string, RegleDuJeu>;
}

/** Ce qu'une règle doit afficher pour une période de N jours. */
export interface Attendu {
  declenchees: number;
  envoyees: number;
  actions: number;
  echouees: number;
  ignorees: number;
  ignorees_par_code: Record<string, number>;
  reportees: number;
  reportees_par_code: Record<string, number>;
  /** Fiches encore en file : maintenant, quelle que soit la période. */
  en_cours: number;
  /** Lignes des Journaux sur la période. */
  journal: number;
  /** Lignes de l'Historique : un passage par client (un événement écarté à l'entrée a aussi sa ligne). */
  passages: number;
}

const somme = (o: Record<string, number>) => Object.values(o).reduce((s, n) => s + n, 0);
const ajouter = (vers: Record<string, number>, de: Record<string, number>) => {
  for (const [k, n] of Object.entries(de)) vers[k] = (vers[k] ?? 0) + n;
};

/** L'attendu d'une règle sur les `jours` derniers jours (les clients plus anciens sortent). */
export function attendu(r: RegleDuJeu, jours: number): Attendu {
  const a: Attendu = {
    declenchees: 0, envoyees: 0, actions: 0, echouees: 0, ignorees: 0, ignorees_par_code: {},
    reportees: 0, reportees_par_code: {}, en_cours: 0, journal: 0, passages: 0,
  };
  for (const c of r.clients) {
    a.en_cours += c.profil.en_cours;
    if (c.age_jours >= jours) continue;
    a.declenchees += c.profil.declenchee;
    a.envoyees += c.profil.envoyees;
    a.actions += c.profil.actions;
    a.echouees += c.profil.echouees;
    a.ignorees += somme(c.profil.ignorees);
    ajouter(a.ignorees_par_code, c.profil.ignorees);
    a.reportees += somme(c.profil.reportees);
    ajouter(a.reportees_par_code, c.profil.reportees);
    a.journal += c.profil.journal;
    a.passages += 1;
  }
  return a;
}

/** L'attendu de tout le bureau A sur une période (somme des règles du jeu). */
export function attenduTotal(m: Manifeste, jours: number): Attendu & { regles_en_echec: number } {
  const t: Attendu = {
    declenchees: 0, envoyees: 0, actions: 0, echouees: 0, ignorees: 0, ignorees_par_code: {},
    reportees: 0, reportees_par_code: {}, en_cours: 0, journal: 0, passages: 0,
  };
  let regles_en_echec = 0;
  for (const r of Object.values(m.regles)) {
    const a = attendu(r, jours);
    if (a.echouees > 0) regles_en_echec += 1;
    for (const k of ['declenchees', 'envoyees', 'actions', 'echouees', 'ignorees', 'reportees', 'en_cours', 'journal', 'passages'] as const) t[k] += a[k];
    ajouter(t.ignorees_par_code, a.ignorees_par_code);
    ajouter(t.reportees_par_code, a.reportees_par_code);
  }
  return { ...t, regles_en_echec };
}

export function lireManifeste(): Manifeste {
  if (!existsSync(FICHIER_MANIFESTE)) {
    throw new Error(`Manifeste absent (${FICHIER_MANIFESTE}) : lancer d'abord integration/10-jeu-connu.preuve.ts.`);
  }
  return JSON.parse(readFileSync(FICHIER_MANIFESTE, 'utf8')) as Manifeste;
}

type Bureau = Awaited<ReturnType<typeof demarrerMoteur>>;

async function ok<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, quoi: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${quoi} : ${error.message}`);
  return data;
}

/** Remet le bureau A (d) à blanc pour tout ce qui touche aux journaux d'automatisation. */
export async function viderLeBureau(admin: SupabaseClient, org: string): Promise<void> {
  await ok(admin.from('automation_execution_logs').delete().eq('org_id', org), 'ménage des journaux');
  await ok(admin.from('automation_scheduled_tasks').delete().eq('org_id', org), 'ménage de la file');
  await ok(admin.from('automation_rules').delete().eq('org_id', org).like('name', '[QA-D%'), 'ménage des règles');
  await ok(admin.from('envois_simules').delete().eq('org_id', org), 'ménage des envois simulés');
  await ok(admin.from('messages').delete().eq('org_id', org), 'ménage des messages');
  await ok(admin.from('sms_opt_outs').delete().eq('org_id', org), 'ménage des désabonnements');
  await ok(admin.from('notifications').delete().eq('org_id', org), 'ménage des notifications');
  // Les anciens clients du jeu sortent des listes (corbeille) ; leurs lignes ne gênent rien.
  await ok(admin.from('clients').update({ deleted_at: new Date().toISOString() }).eq('org_id', org).eq('first_name', 'Jeu').is('deleted_at', null), 'ménage des clients');
}

export async function construireJeuConnu(): Promise<Manifeste> {
  const b: Bureau = await demarrerMoteur();
  const { admin, orgA, orgB } = b;
  await viderLeBureau(admin, orgA);

  // Les préréglages du bureau réagiraient à « Nouveau prospect » : ils sortent du jeu.
  await ok(admin.from('automation_rules').update({ is_active: false }).eq('org_id', orgA).eq('is_preset', true).eq('trigger_event', 'lead.created'), 'préréglages en brouillon');

  const reglages = await ok(admin.from('company_settings').select('timezone').eq('org_id', orgA).single(), 'fuseau du bureau');
  const fuseau = String((reglages as { timezone: string }).timezone);
  const heureLocale = Number(new Intl.DateTimeFormat('en-GB', { timeZone: fuseau, hour: '2-digit', hour12: false }).format(new Date())) % 24;

  // Numéros fictifs (555-01xx) propres à CETTE passe : le plafond de fréquence compte par numéro.
  const zone = 200 + Math.floor(Math.random() * 700);
  let compteur = 0;
  const numero = () => `+1${zone}55501${String(compteur++).padStart(2, '0')}`;
  const passe = Date.now().toString(36);

  interface OptionsClient { telephone?: boolean; courriel?: boolean; consentement?: boolean }
  const creerClient = async (cle: string, n: number, o: OptionsClient = {}): Promise<{ id: string; nom: string; telephone: string | null }> => {
    const telephone = o.telephone === false ? null : numero();
    const nom = `${cle}${n} ${passe}`;
    const ligne = await ok(admin.from('clients').insert({
      org_id: orgA, created_by: b.users.proprioA, first_name: 'Jeu', last_name: nom, status: 'lead',
      ...(telephone ? { phone: telephone } : {}),
      ...(o.courriel === false ? {} : { email: `jeu-${cle.toLowerCase()}-${n}-${passe}@lume-qa.test` }),
      ...(o.consentement === false ? {} : { sms_consent_at: new Date().toISOString(), email_consent_at: new Date().toISOString() }),
    }).select('id').single(), `client ${nom}`);
    return { id: (ligne as { id: string }).id, nom: `Jeu ${nom}`, telephone };
  };

  const creerRegle = async (cle: string, titre: string, champs: Record<string, unknown>): Promise<{ id: string; nom: string }> => {
    const nom = `${PREFIXE} ${cle} — ${titre}`;
    const ligne = await ok(admin.from('automation_rules').insert({
      org_id: orgA, name: nom, trigger_event: 'lead.created', conditions: {}, delay_seconds: 0,
      is_active: false, is_preset: false, actions: [], ...champs,
    }).select('id').single(), `règle ${cle}`);
    return { id: (ligne as { id: string }).id, nom };
  };

  const publier = (ids: string[], actif: boolean) =>
    ok(admin.from('automation_rules').update({ is_active: actif }).in('id', ids), 'publication');

  const mode = async (m: 'succes' | 'panne') => {
    await ok(admin.from('orgs_envois_simules').update({ mode: m }).eq('org_id', orgA), 'mode du bac à sable');
    (await import('../../../server/lib/bac-a-sable')).oublierBacASable();
  };

  /** Émet « Nouveau prospect » pour chaque client et attend que le bus ait fini de traiter. */
  const emettre = async (clients: string[], metadata: Record<string, unknown> = { source: 'manuel' }, fois = 1) => {
    const depuis = new Date(Date.now() - 5_000).toISOString();
    for (const c of clients) {
      for (let i = 0; i < fois; i++) {
        await b.eventBus.emit('lead.created', { orgId: orgA, entityType: 'client', entityId: c, metadata });
      }
    }
    const traites = await attendre(
      async () => (await admin.from('domain_events').select('id, processed_at').eq('org_id', orgA).eq('type', 'lead.created').in('entity_id', clients).gte('created_at', depuis)).data ?? [],
      (l) => l.length >= clients.length * fois && l.every((x) => x.processed_at),
      60_000,
    );
    if (traites.length < clients.length * fois || traites.some((x) => !x.processed_at)) {
      throw new Error(`événements non traités à temps (${traites.filter((x) => x.processed_at).length}/${clients.length * fois})`);
    }
  };

  /** Les lignes de journal d'une règle, une fois définitives. */
  const journaux = async (ruleId: string, minimum: number) => {
    const lignes = await attendre(
      async () => (await admin.from('automation_execution_logs').select('*').eq('automation_rule_id', ruleId).order('created_at')).data ?? [],
      (l) => l.length >= minimum && l.every((x) => journalDefinitif(x.result_error as string | null)),
      45_000,
    );
    if (lignes.length < minimum) throw new Error(`journaux de ${ruleId} : ${lignes.length}/${minimum} lignes`);
    return lignes as Array<Record<string, unknown>>;
  };

  /** Antidate les journaux ET les tâches d'un client pour une règle. */
  const antidater = async (ruleId: string, clientId: string, jours: number) => {
    if (!jours) return;
    const quand = new Date(Date.now() - jours * JOUR_MS - 3_600_000).toISOString();
    await ok(admin.from('automation_execution_logs').update({ created_at: quand }).eq('automation_rule_id', ruleId).eq('entity_id', clientId), 'antidater le journal');
    await ok(admin.from('automation_scheduled_tasks').update({ created_at: quand }).eq('automation_rule_id', ruleId).eq('entity_id', clientId), 'antidater la tâche');
    // Une tâche close l'a été au même moment que sa dernière ligne de journal : sa date de fin suit.
    await ok(admin.from('automation_scheduled_tasks').update({ completed_at: quand }).eq('automation_rule_id', ruleId).eq('entity_id', clientId).not('completed_at', 'is', null), 'antidater la fin de la tâche');
  };

  const regles: Record<string, RegleDuJeu> = {};
  const texto = (corps: string, type: 'transactionnel' | 'marketing' = 'transactionnel') =>
    [{ type: 'send_sms', config: { body: corps, type_envoi: type } }];

  /** Un scénario simple : une règle, des clients d'âges donnés, le profil de chaque client. */
  const scenario = async (p: {
    cle: string; titre: string; issue: Issue; code?: string; raison: string;
    champs: Record<string, unknown>; ages: number[]; client?: OptionsClient;
    metadata?: Record<string, unknown>; lignesParClient?: number;
    avant?: (clients: Array<{ id: string; telephone: string | null }>) => Promise<void>;
    /** Juste après les événements, règle encore publiée (ex. : épuiser les reprises d'un échec). */
    pendant?: (ruleId: string, clients: Array<{ id: string; age: number }>) => Promise<void>;
    apres?: () => Promise<void>;
    profil: Profil | ((age: number, rang: number) => Profil);
  }): Promise<RegleDuJeu> => {
    const r = await creerRegle(p.cle, p.titre, p.champs);
    const clients: Array<{ id: string; nom: string; telephone: string | null; age: number }> = [];
    for (let i = 0; i < p.ages.length; i++) clients.push({ ...(await creerClient(p.cle, i + 1, p.client)), age: p.ages[i] });
    if (p.avant) await p.avant(clients);
    await publier([r.id], true);
    try {
      await emettre(clients.map((c) => c.id), p.metadata);
      const n = p.lignesParClient ?? 1;
      if (n > 0) await journaux(r.id, clients.length * n);
      if (p.pendant) await p.pendant(r.id, clients);
    } finally {
      await publier([r.id], false);
      if (p.apres) await p.apres();
    }
    for (const c of clients) await antidater(r.id, c.id, c.age);
    const regle: RegleDuJeu = {
      cle: p.cle, id: r.id, nom: r.nom, issue: p.issue, code: p.code, raison: p.raison,
      clients: clients.map((c, i) => ({
        id: c.id, nom: c.nom, age_jours: c.age,
        profil: typeof p.profil === 'function' ? p.profil(c.age, i) : p.profil,
      })),
    };
    regles[p.cle] = regle;
    return regle;
  };

  // ── S : réussies, à six âges ──────────────────────────────────────────────
  await scenario({
    cle: 'S', titre: 'texto réussi', issue: 'reussi', raison: 'Texto envoyé.',
    champs: { actions: texto('Bonjour, merci de votre demande.') },
    ages: [0, 0, 3, 10, 40, 70],
    profil: profil({ envoyees: 1 }),
  });

  // ── E : échouées (fournisseur en panne) ───────────────────────────────────
  // Un échec passager est REPRIS trois fois (5 min, 30 min, 2 h) avant d'être définitif.
  // Pour les clients d'aujourd'hui et d'il y a 10 jours, on fait avancer la file jusqu'au bout
  // (le vrai moteur ; seule l'heure prévue de la reprise est retouchée) : 4 tentatives, UN échec
  // définitif. Le client d'il y a 3 jours garde sa reprise en file : il est « en cours ».
  const ECHEC_DEFINITIF = (age: number) => age !== 3;
  await scenario({
    cle: 'E', titre: 'texto en panne', issue: 'echec', raison: 'Le fournisseur de textos était en panne.',
    champs: { actions: texto('Bonjour, votre demande est bien reçue.') },
    ages: [0, 3, 10],
    avant: () => mode('panne'),
    pendant: async (ruleId, clients) => {
      const garde = clients.filter((c) => !ECHEC_DEFINITIF(c.age)).map((c) => c.id);
      const epuises = clients.filter((c) => ECHEC_DEFINITIF(c.age)).map((c) => c.id);
      await attendre(
        async () => (await admin.from('automation_scheduled_tasks').select('id').eq('automation_rule_id', ruleId)).data ?? [],
        (l) => l.length >= clients.length, 30_000,
      );
      // La reprise à garder : repoussée d'un jour, pour qu'aucun passage de la file ne la prenne.
      await ok(admin.from('automation_scheduled_tasks').update({ execute_at: new Date(Date.now() + JOUR_MS).toISOString() })
        .eq('automation_rule_id', ruleId).in('entity_id', garde), 'reprise gardée en file');
      for (let tour = 0; tour < 6; tour++) {
        const enFile = (await ok(admin.from('automation_scheduled_tasks').select('id, status')
          .eq('automation_rule_id', ruleId).in('entity_id', epuises).in('status', ['pending', 'running']), 'reprises en file')) as Array<{ id: string }>;
        if (!enFile.length) break;
        await ok(admin.from('automation_scheduled_tasks').update({ execute_at: new Date(Date.now() - 1000).toISOString() })
          .in('id', enFile.map((t) => t.id)).eq('status', 'pending'), 'reprise avancée');
        await traiterFile(admin, orgA);
      }
      const reste = (await ok(admin.from('automation_scheduled_tasks').select('status')
        .eq('automation_rule_id', ruleId).in('entity_id', epuises), 'état des reprises')) as Array<{ status: string }>;
      if (reste.some((t) => t.status !== 'failed')) throw new Error(`reprises non épuisées : ${reste.map((t) => t.status).join(', ')}`);
    },
    apres: () => mode('succes'),
    profil: (age) => (ECHEC_DEFINITIF(age)
      // 4 lignes au journal (la tentative immédiate + 3 reprises), UN échec définitif.
      ? profil({ echouees: 1, journal: 4 })
      // 1 ligne (échec passager) + sa reprise en file.
      : profil({ journal: 2, en_cours: 1 })),
  });

  // ── T : ignorée, client sans téléphone ────────────────────────────────────
  await scenario({
    cle: 'T', titre: 'client sans téléphone', issue: 'saute', code: 'sans_telephone', raison: 'Ce client n’a pas de numéro de téléphone.',
    champs: { actions: texto('Bonjour, un petit mot.') }, ages: [0, 10], client: { telephone: false },
    profil: profil({ ignorees: { sans_telephone: 1 } }),
  });

  // ── D : ignorée, client désabonné (STOP) ──────────────────────────────────
  await scenario({
    cle: 'D', titre: 'client désabonné', issue: 'saute', code: 'desabonne', raison: 'Ce client s’est désabonné des textos.',
    champs: { actions: texto('Bonjour, des nouvelles ?') }, ages: [0, 40],
    avant: async (clients) => {
      await ok(admin.from('sms_opt_outs').insert(clients.map((c) => ({ org_id: orgA, phone: c.telephone, reason: 'STOP (jeu connu)' }))), 'désabonnements');
    },
    profil: profil({ ignorees: { desabonne: 1 } }),
  });

  // ── C : ignorée, pas de consentement pour un envoi commercial ─────────────
  await scenario({
    cle: 'C', titre: 'sans consentement', issue: 'saute', code: 'sans_consentement', raison: 'Aucun consentement enregistré pour ce client.',
    champs: { actions: texto('Promo du mois : 15 % sur le grand ménage.', 'marketing') }, ages: [0, 3], client: { consentement: false },
    profil: profil({ ignorees: { sans_consentement: 1 } }),
  });

  // ── N : ignorée, client sans courriel ─────────────────────────────────────
  await scenario({
    cle: 'N', titre: 'client sans courriel', issue: 'saute', code: 'sans_courriel', raison: 'Ce client n’a pas d’adresse courriel.',
    champs: { actions: [{ type: 'send_email', config: { subject: 'Votre demande', body: 'Bonjour, nous avons bien reçu votre demande.', type_envoi: 'transactionnel' } }] },
    ages: [0], client: { courriel: false },
    profil: profil({ ignorees: { sans_courriel: 1 } }),
  });

  // ── K : écartée par ses conditions (hors ciblage) : ignorée, PAS déclenchée ─
  await scenario({
    cle: 'K', titre: 'conditions non remplies', issue: 'ecarte', code: 'conditions', raison: 'Hors ciblage : la source du prospect n’est pas « site web ».',
    champs: { actions: texto('Bonjour, merci pour votre demande en ligne.'), conditions: { source: { eq: 'site_web' } } },
    ages: [0, 0, 10],
    profil: profil({ declenchee: 0, ignorees: { conditions: 1 } }),
  });

  // ── A : action interne (notification), pas un envoi au client ─────────────
  await scenario({
    cle: 'A', titre: 'notification interne', issue: 'reussi', raison: 'Notification créée pour l’équipe.',
    champs: { actions: [{ type: 'create_notification', config: { title: 'Nouveau prospect (jeu connu)', body: 'À rappeler.' } }] },
    ages: [0],
    profil: profil({ actions: 1 }),
  });

  // ── H : hors heures d'envoi (reportée, rien n'est parti) ──────────────────
  {
    const h = await scenario({
      cle: 'H', titre: 'hors heures d’envoi', issue: 'reporte', raison: 'Hors des heures d’envoi : reporté à la prochaine fenêtre.',
      champs: { actions: texto('Bonjour, rappel de votre soumission.'), settings: { fenetre: { debut: 0, fin: Math.max(1, heureLocale - 1) } } },
      ages: [0], lignesParClient: 0,
      profil: profil({ reportees: { hors_heures: 1 }, journal: 1, en_cours: 1 }),
    });
    // Le moteur corrigé écrit une LIGNE au premier report (code `hors_heures`) : les Journaux
    // montrent alors la ligne ET la tâche en attente. L'ancien n'écrit rien : la tâche seule.
    const lignes = (await ok(admin.from('automation_execution_logs').select('id').eq('automation_rule_id', h.id), 'lignes du report')) as unknown[];
    if (lignes.length) h.clients[0].profil.journal = 2;
  }

  // ── X : doublon (le même événement, deux fois dans la minute) ─────────────
  {
    const r = await creerRegle('X', 'doublon', { actions: texto('Bonjour, confirmation de votre demande.') });
    const c = await creerClient('X', 1);
    await publier([r.id], true);
    let lignes: Array<Record<string, unknown>> = [];
    try {
      await emettre([c.id], { source: 'manuel' }, 2);
      lignes = await journaux(r.id, 1);
    } finally {
      await publier([r.id], false);
    }
    // Le moteur corrigé trace le second passage (code `doublon`) ; l'ancien ne l'écrit nulle part
    // (constat D-04). Dans les deux cas : UN déclenchement, UN envoi.
    const trace = lignes.filter((l) => (l.result_data as Record<string, unknown> | null)?.saute_code === 'doublon').length;
    regles.X = {
      cle: 'X', id: r.id, nom: r.nom, issue: 'doublon', raison: 'Doublon : le même événement est arrivé deux fois, un seul envoi.',
      clients: [{ id: c.id, nom: c.nom, age_jours: 0, profil: profil({ envoyees: 1, ignorees: trace ? { doublon: trace } : {}, journal: 1 + trace }) }],
    };
  }

  // ── F : plafond de fréquence (4 règles commerciales, le même client) ──────
  {
    const c = await creerClient('F', 1);
    const quatre: Array<{ id: string; nom: string }> = [];
    for (let i = 1; i <= 4; i++) {
      quatre.push(await creerRegle(`F${i}`, i < 4 ? `offre ${i}` : 'plafond de fréquence', { actions: texto(`Offre numéro ${i} : profitez-en cette semaine.`, 'marketing') }));
      // L'ordre d'exécution suit `created_at` : une milliseconde d'écart suffit, on en laisse vingt.
      await new Promise((ok2) => setTimeout(ok2, 20));
    }
    await publier(quatre.map((r) => r.id), true);
    try {
      await emettre([c.id]);
      for (const r of quatre) await journaux(r.id, 1);
    } finally {
      await publier(quatre.map((r) => r.id), false);
    }
    quatre.forEach((r, i) => {
      const plafond = i === 3;
      regles[`F${i + 1}`] = {
        cle: `F${i + 1}`, id: r.id, nom: r.nom, issue: plafond ? 'saute' : 'reussi',
        code: plafond ? 'plafond_frequence' : undefined,
        raison: plafond ? 'Ce client a déjà reçu 3 messages commerciaux aujourd’hui.' : 'Texto envoyé.',
        // L'ancien moteur écrit le plafond comme un ÉCHEC « Frequency cap reached… », le nouveau comme
        // un envoi ignoré (`plafond_frequence`) : les statistiques rangent les deux sous « ignorées ».
        clients: [{ id: c.id, nom: c.nom, age_jours: 0, profil: plafond ? profil({ ignorees: { plafond_frequence: 1 } }) : profil({ envoyees: 1 }) }],
      };
    });
  }

  // ── P : parcours à étapes (courriel → attendre 3 jours → texto) ───────────
  {
    const r = await creerRegle('P', 'parcours en deux temps', {
      steps: [
        { id: 'e1', type: 'action', action: { type: 'send_email', config: { subject: 'Votre demande', body: 'Bonjour, nous préparons votre soumission.', type_envoi: 'transactionnel' } }, suivant: 'e2' },
        { id: 'e2', type: 'attendre', delai_secondes: 3 * 86_400, suivant: 'e3' },
        { id: 'e3', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour, avez-vous des questions sur la soumission ?', type_envoi: 'transactionnel' } }, suivant: null },
      ],
    });
    const c1 = await creerClient('P', 1);
    const c2 = await creerClient('P', 2);
    await publier([r.id], true);
    try {
      await emettre([c1.id, c2.id]);
      // La première étape est dans la file : on la dépile (bureau A seulement).
      await attendre(
        async () => (await admin.from('automation_scheduled_tasks').select('id').eq('automation_rule_id', r.id)).data ?? [],
        (l) => l.length >= 2, 30_000,
      );
      await traiterFile(admin, orgA);
      await journaux(r.id, 2);
      await attendre(
        async () => (await admin.from('automation_scheduled_tasks').select('id, step_id, status').eq('automation_rule_id', r.id).eq('step_id', 'e3')).data ?? [],
        (l) => l.length >= 2, 30_000,
      );
    } finally {
      await publier([r.id], false);
    }
    // Par client : le courriel de l'étape 1 est parti (1 ligne), le texto de l'étape 3 attend (1 tâche).
    const p = profil({ envoyees: 1, journal: 2, en_cours: 1 });
    regles.P = {
      cle: 'P', id: r.id, nom: r.nom, issue: 'reussi', raison: 'Courriel envoyé ; le texto part dans 3 jours.',
      clients: [{ id: c1.id, nom: c1.nom, age_jours: 0, profil: p }, { id: c2.id, nom: c2.nom, age_jours: 0, profil: p }],
    };
  }

  const manifeste: Manifeste = { construit_le: new Date().toISOString(), orgA, orgB, fuseau, regles };
  mkdirSync(DOSSIER_SORTIES, { recursive: true });
  writeFileSync(FICHIER_MANIFESTE, JSON.stringify(manifeste, null, 1));
  return manifeste;
}

// ── La vérité de la base, calculée sans passer par le code du produit ─────────

export interface VeriteRegle {
  lignes: number;
  reussis: number;
  sautes: number;
  echecs: number;
  ecartes: number;
  en_reservation: number;
  fiches_journal: number;
  taches: number;
  taches_en_attente: number;
  fiches_en_attente: number;
  codes: Record<string, number>;
  erreurs: string[];
  motifs: string[];
}

/** Compte, pour une règle et une fenêtre, ce que la base contient. */
export async function veriteRegle(admin: SupabaseClient, ruleId: string, jours: number): Promise<VeriteRegle> {
  const depuis = new Date(Date.now() - jours * JOUR_MS).toISOString();
  const lignes = (await ok(admin.from('automation_execution_logs')
    .select('entity_id, action_type, result_success, result_error, result_data, created_at')
    .eq('automation_rule_id', ruleId).gte('created_at', depuis), 'vérité : journaux')) as Array<Record<string, unknown>>;
  const taches = (await ok(admin.from('automation_scheduled_tasks')
    .select('entity_id, status, created_at').eq('automation_rule_id', ruleId), 'vérité : tâches')) as Array<Record<string, unknown>>;
  const v: VeriteRegle = {
    lignes: lignes.length, reussis: 0, sautes: 0, echecs: 0, ecartes: 0, en_reservation: 0,
    fiches_journal: 0, taches: 0, taches_en_attente: 0, fiches_en_attente: 0, codes: {}, erreurs: [], motifs: [],
  };
  const fiches = new Set<string>();
  for (const l of lignes) {
    const donnees = (l.result_data ?? {}) as Record<string, unknown>;
    if (l.action_type === 'conditions') { v.ecartes += 1; v.codes.conditions = (v.codes.conditions ?? 0) + 1; v.motifs.push(String(donnees.saute ?? '')); continue; }
    fiches.add(String(l.entity_id));
    if (l.result_success === false && l.result_error === 'en cours') { v.en_reservation += 1; continue; }
    if (l.result_success === false) { v.echecs += 1; v.erreurs.push(String(l.result_error ?? '')); continue; }
    if (typeof donnees.saute === 'string' && donnees.saute) {
      v.sautes += 1;
      const code = String(donnees.saute_code ?? '(sans code)');
      v.codes[code] = (v.codes[code] ?? 0) + 1;
      v.motifs.push(donnees.saute);
      continue;
    }
    v.reussis += 1;
  }
  v.fiches_journal = fiches.size;
  const dansFenetre = taches.filter((t) => String(t.created_at) >= depuis);
  v.taches = dansFenetre.length;
  const enAttente = taches.filter((t) => t.status === 'pending' || t.status === 'running');
  v.taches_en_attente = enAttente.length;
  v.fiches_en_attente = new Set(enAttente.map((t) => String(t.entity_id))).size;
  return v;
}
