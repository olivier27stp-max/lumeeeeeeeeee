// Livrables du lot « actions » dans leur DERNIER ÉTAT CONNU (staging en panne le 2026-10-01 :
// la plupart des specs sont écrites mais n'ont pas pu être exécutées).
//   node D:/lume-uiaudit/outils/actions/etat-connu.mjs
// Lit la liste des tests écrits (liste-brute.txt, produite par `playwright test --list`),
// applique les états relevés pendant les passes du 2026-10-01, écrit constats.jsonl et couverture.md.
// Aucun accès à l'app ni à la base.
import { readFileSync, writeFileSync } from 'node:fs';

const SORTIES = 'D:/lume-uiaudit/sorties/actions';
const tests = readFileSync(`${SORTIES}/liste-brute.txt`, 'utf8').split('\n')
  .filter((l) => l.includes('[bureau]'))
  .map((l) => {
    const m = l.match(/actions\\([^:]+):\d+:\d+ › (.*)$/);
    const morceaux = m[2].split(' › ');
    return { fichier: m[1], titre: morceaux[morceaux.length - 1].trim(), groupe: morceaux.slice(0, -1).join(' › ') };
  });

// ── États relevés le 2026-10-01 (passes de 11 h 23 à 12 h 28, heure de l'Est) ──
const VERT = 'vert (exécuté le 2026-10-01)';
const PANNE = 'rouge — panne ou lenteur de staging, à relancer';
const JAMAIS = 'écrit, jamais exécuté';
const estCatalogue = (t) => t.fichier === '02-catalogue-actions.spec.ts' && t.titre.includes('ajoutée par le tiroir');
const act = (t) => t.titre.match(/^\[(ACT-\d+)\]/)?.[1];

function etat(t) {
  if (t.fichier !== '02-catalogue-actions.spec.ts') return JAMAIS;
  if (t.titre.includes('le catalogue du produit porte exactement')) return VERT;
  if (estCatalogue(t)) {
    const a = act(t);
    if (['ACT-03', 'ACT-04', 'ACT-06', 'ACT-07', 'ACT-10', 'ACT-11', 'ACT-19'].includes(a)) return VERT;
    if (['ACT-01', 'ACT-14', 'ACT-15', 'ACT-16', 'ACT-18', 'ACT-20'].includes(a)) {
      return `${PANNE} (toutes les attentes du test ont passé — écran, base, rechargement ; seul le moniteur a relevé des erreurs d’environnement : « Lock broken », 403 POST orgs, 500 / 504 Supabase)`;
    }
    if (a === 'ACT-02') return `${PANNE} (attentes passées jusqu’à l’enregistrement en base ; après rechargement l’app a affiché la fenêtre « Passer à Scale » — forfait illisible, voir actions-05)`;
    return `${PANNE} (interrompu avant l’écran : « statement timeout », « schema cache », session ou bureau de test non créés)`;
  }
  if (t.groupe.includes('textes proposés')) return `${PANNE} (interrompu avant l’écran)`;
  if (t.groupe.includes('options des menus')) {
    return /\[CHA-(06|11|18|28|31)\]/.test(t.titre) ? `${PANNE} (interrompu avant l’écran)` : JAMAIS;
  }
  return JAMAIS;
}

const titre = (fragment) => {
  const t = tests.find((x) => x.titre.includes(fragment));
  if (!t) throw new Error(`test introuvable : ${fragment}`);
  return `${t.fichier} › ${t.titre}`;
};

// ── Constats : UNIQUEMENT ce qui a été observé à l'écran ou en base ──
const CAP = `${SORTIES}/captures`;
const constats = [
  {
    id: 'actions-01', ids_carte: ['CHA-33', 'CHA-32', 'ACT-14'],
    ecran: 'Éditeur d’automatisation › panneau d’étape « Déplacer l’opportunité » (déclencheur « Devis envoyé »)',
    element: 'champ « L’étape visée * », affiché quand « Vers » = « Une étape précise » (ou vide)',
    attendu: 'un menu des étapes du pipeline du bureau, par leur nom (« Pipeline de ventes · Contacté »…), comme le menu « L’opportunité est à l’étape » du déclencheur « Devis ouvert »',
    observe: 'un champ de TEXTE libre (40 caractères). Pour rendre l’étape enregistrable, le test a dû y taper l’identifiant technique de l’étape (d470679a-bdea-4f52-b3d5-2337611d65b7), que seul un accès à la base permet de connaître ; cet identifiant est enregistré tel quel dans steps[].action.config.stage_id et réaffiché tel quel après rechargement. Un utilisateur ne peut pas régler cette action.',
    gravite: 'majeur', capture: `${CAP}/catalogue-move_deal_stage.png`,
    test: titre('« L’étape visée » est un menu des étapes du pipeline'),
    observe_par: `${titre('[ACT-14][CHA-32][CHA-33]')} — exécuté le 2026-10-01 à 11 h 49 (capture prise par ce test ; le test @defaut ci-dessus est écrit, pas encore exécuté)`,
    cause_probable: 'src/lib/automationCatalogue.ts:980 — `stage_id` est déclaré `type: \'texte\'` ; src/components/automations/PanneauEtape.tsx:514-523 ne transmet aucune liste d’étapes à ChampAction (le type `etape_pipeline` existe, mais n’est alimenté que pour les réglages du déclencheur)',
  },
  {
    id: 'actions-02', ids_carte: ['CHA-09', 'ACT-03'],
    ecran: 'Éditeur d’automatisation › carte et panneau d’une étape « Notifier l’équipe » qu’on vient d’ajouter',
    element: 'titre proposé à la création de l’étape',
    attendu: '« Suivi à faire pour [client_name] » (avec l’accent)',
    observe: 'la carte du canevas affiche « Suivi a faire pour [client_name] » : faute de français dans un texte que Lume écrit lui-même et qui part tel quel dans la notification si on ne le retouche pas',
    gravite: 'cosmetique', capture: `${CAP}/catalogue-create_notification.png`,
    test: titre('[CHA-09][ACT-03] « Notifier l’équipe » naît complète'),
    observe_par: `${titre('[ACT-03][CHA-09]')} — exécuté le 2026-10-01 à 11 h 35 (la carte, à gauche du panneau, porte encore le texte de départ)`,
    cause_probable: 'src/lib/automationCatalogue.ts:751 — `defaut_fr: \'Suivi a faire pour [client_name]\'` (même faute ligne 800 pour « Envoyer dans Slack », non observée : l’action est indisponible)',
  },
  {
    id: 'actions-03', ids_carte: ['CHA-28', 'EDT-076'],
    ecran: 'Éditeur d’automatisation › panneau d’étape « Créer une tâche »',
    element: 'menu « Priorité (facultatif) », option vide',
    attendu: 'une option vide qui dit ce que « vide » veut dire pour une tâche qu’on CRÉE (« — Aucune — », « — Par défaut — »)',
    observe: 'l’option vide s’appelle « — Inchangé — » : il n’existe encore aucune priorité à laisser inchangée (libellé générique de tous les menus « choix »)',
    gravite: 'cosmetique', capture: `${CAP}/explo-tache-relu.png`,
    test: titre('[CHA-28][EDT-076] « Créer une tâche » : chaque menu offre les options'),
    observe_par: 'relevé d’écran du 2026-10-01 à 10 h 44 (étape « Créer une tâche » ajoutée par le tiroir, enregistrée, page rechargée)',
    cause_probable: 'src/components/automations/ChampAction.tsx:110 — `champ.vide_fr ?? \'— Inchangé —\'` ; le champ `priorite` (automationCatalogue.ts:910-917) ne définit pas `vide_fr`',
  },
  {
    id: 'actions-04', ids_carte: ['EDT-133', 'CHA-07'],
    ecran: 'Éditeur d’automatisation › panneau d’étape « Envoyer un texto »',
    element: 'compteur sous « Texte du message »',
    attendu: 'le nombre de caractères ET le nombre de SMS facturés (« 200 / 1600 · 2 SMS »)',
    observe: 'le compteur affiche seulement « 98 / 1600 » : rien ne dit combien de SMS seront facturés. Corrigé par #840 sur `main`, absent de cette copie (commit c402ad57).',
    gravite: 'mineur', capture: `${CAP}/catalogue-send_sms.png`,
    test: titre('[EDT-133][CHA-07] le texto affiche le nombre de SMS facturés'),
    observe_par: `${titre('[ACT-02][CHA-07][CHA-08]')} — exécuté le 2026-10-01 à 11 h 29 (capture)`,
    cause_probable: 'src/components/automations/ChampAction.tsx:90-103 — compteur sans segments ; corrigé par le commit 39f6ffc2 (#840), pas encore fusionné dans la branche testée',
  },
  {
    id: 'actions-05', ids_carte: [],
    ecran: 'HORS LOT (garde d’accès de l’éditeur, état E01 de la carte) — /automations/:id après rechargement de la page',
    element: 'fenêtre « Fonctionnalité premium — Automatisations — Passer à Scale, 249 $/mois »',
    attendu: 'quand le forfait ne peut pas être lu (serveur lent ou en erreur), un message d’erreur et un bouton pour réessayer — jamais une offre de mise à niveau montrée à un bureau qui a déjà Autopilot',
    observe: 'bureau de test sous forfait Autopilot ; GET /api/billing/plans a répondu 500 (« canceling statement due to statement timeout ») ; l’éditeur a été remplacé par la fenêtre de vente « Passer à Scale » et y est resté (3 minutes, jusqu’à la fin du test)',
    gravite: 'majeur', capture: `${CAP}/hors-lot-paywall-quand-le-forfait-est-illisible.png`,
    test: '',
    observe_par: `${titre('[ACT-02][CHA-07][CHA-08]')} — exécuté le 2026-10-01 à 11 h 40, pendant la saturation de staging`,
    cause_probable: 'src/hooks/usePlanFeature.ts:75-76 — `fetchPlans().catch(() => [])` : un échec de lecture est traité comme « aucun forfait » ; src/components/PlanFeatureGate.tsx:29-33 ouvre alors la fenêtre de mise à niveau',
  },
  {
    id: 'actions-06', ids_carte: [],
    ecran: 'HORS LOT (démarrage de l’app) — toute page, au chargement',
    element: 'vérification « l’utilisateur a-t-il un bureau ? »',
    attendu: 'quand la lecture des adhésions échoue, l’app le dit ou réessaie ; elle ne conclut pas que l’utilisateur n’a aucun bureau',
    observe: 'pendant la saturation de staging, l’app a tenté de CRÉER un bureau pour un propriétaire qui en a déjà un : « 403 POST …/rest/v1/orgs?select=id » relevé par le moniteur dans 8 tests (2 fois par chargement), toujours après des exceptions « Lock broken by another request with the \'steal\' option ». Ici la RLS a refusé (403) ; rien d’autre n’a été vu à l’écran.',
    gravite: 'mineur', capture: `${SORTIES}/preuves/passe-02-catalogue-interrompue-20261001.log`,
    test: '',
    observe_par: 'sorties du moniteur des tests ACT-01, 02, 14, 15, 18, 20 de 02-catalogue-actions.spec.ts (2026-10-01, 11 h 23 à 12 h 10)',
    cause_probable: 'src/App.tsx:550-565 — `count` nul (requête en échec ou sans session) est lu comme « aucune adhésion », puis `supabase.from(\'orgs\').insert(…)`',
  },
  {
    id: 'actions-07', ids_carte: [],
    ecran: 'HORS LOT (API) — éditeur ouvert sur une automatisation qui n’existe plus',
    element: 'PATCH /api/automations/rules/:id et l’enregistrement automatique de l’éditeur',
    attendu: 'le serveur répond « Automatisation introuvable. » (404) ou « Votre rôle ne permet pas… » (403) ; l’éditeur le dit une fois et cesse de réessayer',
    observe: 'la règle avait été supprimée en base pendant que l’éditeur était encore ouvert (ménage de fin de test) : le serveur a répondu 500 « Impossible de modifier l’automatisation. » (erreur PostgREST PGRST116, « Cannot coerce the result to a single JSON object »), et l’éditeur a affiché « Enregistrement impossible pour le moment — nouvel essai automatique. (Impossible de modifier l’automatisation.) » — un nouvel essai qui ne peut jamais réussir',
    gravite: 'mineur', capture: `${SORTIES}/preuves/api-patch-500-regle-disparue.txt`,
    test: '',
    observe_par: 'journal de l’API locale (D:/lume-uiaudit/sorties/serveurs/api.log, lignes 1054-1055, 1153-1156, 1890-1891) ; texte du toast relevé dans l’arbre de la page d’un test du 2026-10-01 à 10 h 49',
    cause_probable: 'server/routes/automation-rules.ts:556-570 — `.update(…).select(COLONNES).single()` : zéro ligne (règle disparue ou filtrée par la RLS) donne PGRST116, traité comme une panne (500) ; src/pages/AutomationBuilderPage.tsx:1028-1048 réessaie tout échec sans distinguer le statut',
  },
];
writeFileSync(`${SORTIES}/constats.jsonl`, constats.map((c) => JSON.stringify(c)).join('\n') + '\n');

// ── Couverture ──
const plage = (prefixe, a, b, n = 3) => Array.from({ length: b - a + 1 }, (_, i) => `${prefixe}-${String(a + i).padStart(n, '0')}`);
const LOT = [
  'EDT-056', 'EDT-057', 'EDT-059', 'EDT-060', 'EDT-061', 'EDT-062', 'EDT-063',
  ...plage('EDT', 75, 86), ...plage('EDT', 100, 133), 'EDT-164',
];
const CATALOGUE = [...plage('ACT', 1, 21, 2), ...plage('CHA', 1, 40, 2)];
const cle = (t) => `${t.fichier} › ${t.titre}`;
const constatsDe = (t) => constats.filter((c) => c.test === cle(t) || (c.tests ?? []).includes(cle(t))).map((c) => c.id);

function etatAffiche(t) {
  const e = etat(t);
  const defaut = / @defaut$/.test(t.titre);
  const ids = constatsDe(t);
  if (e === JAMAIS && defaut) {
    return ids.length
      ? `${JAMAIS} — rouge attendu ; le défaut a été observé à l’écran par ailleurs → ${ids.join(', ')}`
      : `${JAMAIS} — rouge attendu d’après le code (@defaut), à confirmer à l’écran`;
  }
  if (ids.length) return `${e} — le défaut visé a été observé à l’écran par ailleurs → ${ids.join(', ')}`;
  return e;
}

function ligne(id) {
  const lies = tests.filter((t) => t.titre.includes(`[${id}]`));
  if (!lies.length) return `| ${id} | — | AUCUN TEST ÉCRIT |`;
  const a = lies.map((t) => `${t.fichier} › ${t.titre.replace(/\|/g, '/')}`).join('<br><br>');
  const b = lies.map((t) => etatAffiche(t)).join('<br><br>');
  return `| ${id} | ${a} | ${b} |`;
}

const compte = (liste) => liste.filter((id) => tests.some((t) => t.titre.includes(`[${id}]`))).length;
const executes = tests.filter((t) => etat(t) !== JAMAIS);
const verts = tests.filter((t) => etat(t) === VERT);
const autres = [...new Set(tests.flatMap((t) => [...t.titre.matchAll(/\[([A-Z]+-N?\d+[a-z]?)\]/g)].map((m) => m[1])))]
  .filter((id) => !LOT.includes(id) && !CATALOGUE.includes(id)).sort();
const parFichier = [...new Set(tests.map((t) => t.fichier))].map((f) => {
  const l = tests.filter((t) => t.fichier === f);
  return `| ${f} | ${l.length} | ${l.filter((t) => / @defaut$/.test(t.titre)).length} | ${l.filter((t) => etat(t) === VERT).length} | ${l.filter((t) => etat(t).startsWith(PANNE)).length} | ${l.filter((t) => etat(t) === JAMAIS).length} |`;
});
const entete = '| ID | Test (fichier › titre) | Dernier état connu |\n|---|---|---|';

const md = [
  '# Couverture — lot « actions »',
  '',
  'État au 2026-10-01, 12 h 30 (heure de l’Est). **Staging est tombé en panne pendant la tournée** (base UNHEALTHY, PostgREST en 503) : les specs sont écrites, mais seule une partie de `02-catalogue-actions.spec.ts` a pu tourner. Tout le reste est à relancer (voir `a-relancer.md`).',
  '',
  `- ID du lot couverts par au moins un test écrit : **${compte(LOT)} / ${LOT.length}** (tiroir Actions, champ générique, panneau d’étape)`,
  `- Catalogue couvert par au moins un test écrit : **${compte(CATALOGUE)} / ${CATALOGUE.length}** (21 actions + 40 champs)`,
  `- Tests écrits : **${tests.length}** dans ${parFichier.length} fichiers, dont ${tests.filter((t) => / @defaut$/.test(t.titre)).length} marqués \`@defaut\` (rouge attendu)`,
  `- Tests réellement exécutés : **${executes.length}** — ${verts.length} verts, ${executes.length - verts.length} rouges, **tous les rouges pour cause de panne ou de lenteur de staging** (aucun rouge « défaut produit » parmi les tests exécutés)`,
  `- Jamais exécutés : **${tests.length - executes.length}**`,
  '',
  'Les quatre états possibles : « vert (exécuté le …) » · « rouge — défaut produit → constat » · « rouge — panne ou lenteur de staging, à relancer » · « écrit, jamais exécuté ». Un test marqué `@defaut` et jamais exécuté est annoncé « rouge attendu » : c’est une prévision tirée du code, pas une observation — sauf quand le défaut a été vu à l’écran par un autre test (le constat est alors cité).',
  '',
  '## Par fichier',
  '',
  '| Fichier | Tests | dont @defaut | Verts | Rouges (staging) | Jamais exécutés |',
  '|---|---|---|---|---|---|',
  ...parFichier,
  '',
  '## ID de la carte (tiroir Actions, champ générique, panneau d’étape)',
  '',
  entete,
  ...LOT.map(ligne),
  '',
  '## Catalogue : une ligne par action et par champ d’action',
  '',
  'Pour les 7 actions dont le test de catalogue est vert, tout a été vérifié de bout en bout : ajout par le tiroir, chaque champ rempli, `automation_rules.steps` égal à ce que l’écran montre, rechargement, panneau relu champ par champ.',
  '',
  entete,
  ...CATALOGUE.map(ligne),
  '',
  '## Autres ID touchés par les tests du lot (hors lot, couverts au passage)',
  '',
  entete,
  ...autres.map(ligne),
  '',
].join('\n');
writeFileSync(`${SORTIES}/couverture.md`, md);
console.log(`tests écrits ${tests.length} · exécutés ${executes.length} (verts ${verts.length}) · ID lot ${compte(LOT)}/${LOT.length} · catalogue ${compte(CATALOGUE)}/${CATALOGUE.length} · @defaut ${tests.filter((t) => / @defaut$/.test(t.titre)).length} · constats ${constats.length}`);
console.log(parFichier.join('\n'));
console.log('ID du lot sans test :', [...LOT, ...CATALOGUE].filter((id) => !tests.some((t) => t.titre.includes(`[${id}]`))).join(', ') || 'aucun');
