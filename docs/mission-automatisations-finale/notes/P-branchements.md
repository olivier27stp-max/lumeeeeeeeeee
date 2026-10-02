# Branchements de l'agent P — ciblage, doublons, « Insérer un champ », simplicité

Branche `mission/auto-finale-p` (arbre `D:/lume-final/wt-p`), tête `e096f5ba`, partie de `886d5f42`.
Phase 1 = FICHIERS NEUFS seulement : 14 fichiers de produit, 13 fichiers de test, **aucun fichier existant modifié**.
Ce document dit, pour chaque fichier existant, quoi poser, où, et quel test passe au vert. Les ancres sont des
TEXTES à chercher (les numéros de ligne bougent avec les agents M, U, S, L).

Rejouer mes tests :

```
# 236 tests sans base (fonctions pures, composants jsdom, routes sur fausse base) — ils sont AUSSI dans `npm test`
npx vitest run --maxWorkers=2 tests/automations-finale/p
# 15 tests contre la VRAIE base (pile locale, bureaux « (p) » en bac à sable ; se sautent ailleurs)
QA_AUTO_SUFFIXE=p npx vitest run --maxWorkers=2 --config tests/automations-finale/p/vitest.config.ts
# types, bornés à mes fichiers (le `tsc` complet manque de mémoire sur le poste) — tsconfig.p.json, NON commité
NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit -p tsconfig.p.json
```

---

## 0. À poser AVANT toute fusion vers main — sinon la prod ne démarre pas

`tests/dockerfile-imports-src.test.ts` est ROUGE sur ma branche (un seul test, « aucun import src/ orphelin »).
C'est la conséquence directe de « fichiers neufs seulement » : mes fichiers serveur importent trois fichiers neufs
de `src/lib/` que l'image ne copie pas. À ajouter au `Dockerfile`, à côté de `COPY src/lib/automationMotifs.ts …` :

```dockerfile
# « Qui est ciblé » : le cœur pur partagé par l'éditeur et le moteur (ciblageOk, conflits, essai).
COPY src/lib/automationCiblage.ts ./src/lib/automationCiblage.ts
# Le catalogue unique des variables d'un message (détecteur, valeur de remplacement, essai).
COPY src/lib/automationVariables.ts ./src/lib/automationVariables.ts
# Le contrat de « Tester avec un client » (types seulement).
COPY src/lib/automationEssai.ts ./src/lib/automationEssai.ts
```

Si le serveur se met à importer `src/lib/automationControles.ts` (branchement § 4.3) ou `automationResume.ts`
(Lumi, § 5) : une ligne de plus pour chacun. Leurs imports sont tous déjà copiés (`automationCatalogue`,
`sequenceTypes`, `champs/*`) ou listés ci-dessus — le second test du fichier (imports indirects) le vérifiera.

---

## 1. Ce qui est livré

| Pièce | Commit | Fichiers | Tests (nombre) |
|---|---|---|---|
| A1 ciblage pur + schéma | `89abca70` | `src/lib/automationCiblage.ts`, `server/lib/automations-ciblage-schema.ts` | `p/ciblage-pur.test.ts` (29) |
| A2 ciblage serveur | `3e583302` | `server/lib/automations-ciblage.ts` | `p/ciblage-serveur.test.ts` (23) |
| A3 section de l'éditeur | `6cf05093` | `src/components/automations/SectionCiblage.tsx`, `src/lib/automationCiblageApi.ts` | `p/section-ciblage.test.tsx` (20) |
| B1 garde d'envoi | `be166100` | `server/lib/actions/doublons.ts` | `p/doublons.test.ts` (27) |
| B2 avertissement | `73d93e5b` | `server/lib/automations-conflits.ts` | `p/conflits.test.ts` (15) |
| C1 catalogue des variables | `a873d3c4` | `src/lib/automationVariables.ts` | `p/variables.test.ts` (32), `p/variables-parite.test.ts` (11) |
| C2 palette | `fb5acc33` | `src/components/automations/PaletteChamps.tsx` | `p/palette-champs.test.tsx` (18) |
| D1 résumé | `79e701b9` | `src/lib/automationResume.ts` | `p/resume.test.ts` (22) |
| D2 contrôles | `f40c13b8` | `src/lib/automationControles.ts` | `p/controles.test.ts` (18) |
| E routes + essai | `79c28a2f` | `server/routes/automation-ciblage.ts`, `server/lib/automations-essai.ts`, `src/lib/automationEssai.ts` | `p/routes-ciblage.test.ts` (21) |
| vraie base | `90617f9e` | `p/integration/p-reel.test.ts`, `p/vitest.config.ts` | 15 (pile locale) |

Chaque pièce a été éprouvée « défaut remis » : j'ai cassé le code (exclusion non prioritaire, bureau non filtré,
seuil à 0,5, clé de réservation par règle, insertion à la fin, compteur sans délai, droit non vérifié…) et vu les
tests rougir, puis remis le code.

Écarts par rapport à ta consigne, à connaître :

1. **Le schéma Zod du ciblage n'est PAS dans `src/lib/automationCiblage.ts`** mais dans
   `server/lib/automations-ciblage-schema.ts` (`ciblageSchema`, `regleCiblageSchema`). Aucun fichier de `src/`
   n'importe Zod : l'y mettre l'aurait embarqué dans le JavaScript du navigateur. L'éditeur juge sa saisie avec
   `fautesDuCiblage` (pur) ; un test garde les deux d'accord. Le fichier n'importe pas `validation.ts` (qui
   l'importera) : la forme d'une condition de champ y est redite, et un test la compare à `conditionChampSchema`.
2. **`ciblageOk` rend un objet, pas un booléen** : `{ cible, raison, phrase, code: 'hors_ciblage', erreur? }` — le
   moteur a besoin de la phrase du journal, et de savoir si « hors ciblage » vient d'une lecture ratée (`erreur`).
3. **« Tester avec un client » est une SIMULATION, écrite en entier, sans toucher au moteur** — pas une exécution
   en bac à sable forcé. Voir § 7 (décision) et § 2.5 (ce que le moteur doit exporter pour la rendre exacte partout).
4. **Les trois routes lisent avec la session de l'utilisateur (RLS)**, comme `POST /rules/:id/apercu` depuis le
   2026-09-28 : un membre à portée restreinte voit le compte de SES clients. Voir § 7.

---

## 2. MOTEUR (agent M) — `server/lib/automationEngine.ts`, `server/lib/actions/index.ts`

### 2.1 Ciblage au déclenchement — `handleEvent` — tests [E-03], [E-04] (le premier), [E-07]

a) `evaluateConditions` doit SAUTER la clé `ciblage` (sinon elle est comparée aux métadonnées de l'événement et
écarte tout le monde — c'est le symptôme de [E-03]). À côté de `if (cleBrute === CLE_CONDITIONS_CHAMPS) continue;` :

```ts
import { CLE_CIBLAGE } from '../../src/lib/automationCiblage';
// « Qui est ciblé » : jugé à part, sur la fiche du client (ciblageOk).
if (cleBrute === CLE_CIBLAGE) continue;
```

b) `journaliserRegleEcartee` reçoit l'issue toute faite (5e paramètre facultatif) :

```ts
async function journaliserRegleEcartee(supabase, rule, event, quoi: string | null, issue?: { saute: string; saute_code: string }) {
  …
  result_data: issue ?? {
    saute: quoi ? `Conditions non remplies : ${quoi}` : 'Conditions non remplies',
    saute_code: 'conditions',
    ...(quoi ? { condition: quoi } : {}),
  },
```

c) Remplacer le bloc « Seulement si le client a / n'a pas l'étiquette » (l'appel `conditionsEtiquettesOk` suivi de
`journaliserRegleEcartee(…, 'étiquette du client')`) par :

```ts
import { ciblageOk } from './automations-ciblage';
// « Qui est ciblé » : la fiche du CLIENT de l'entité — étiquettes, champs, fiche. Relit aussi les deux anciennes clés d'étiquette.
const verdictCiblage = await ciblageOk(engineConfig.supabase, event.orgId, event.entityType, event.entityId, rule.conditions);
if (!verdictCiblage.cible) {
  await journaliserRegleEcartee(engineConfig.supabase, rule, event, null, { saute: verdictCiblage.phrase!, saute_code: verdictCiblage.code! });
  continue;
}
```

(La variable locale `ciblage` existe déjà dans cette portée — `separerCiblage` — d'où `verdictCiblage`.)
`conditionsEtiquettesOk` reste utilisé par l'étape « si ».

Le témoin `[E-01 témoin]` attend aujourd'hui le motif « Conditions non remplies : étiquette du client » : il devra
suivre (« Ignoré : hors ciblage — … », code `hors_ciblage`) — c'est ce que demande [E-07]. À dire à l'agent E / à toi.

### 2.2 Ciblage avant chaque envoi différé — `processScheduledTasks` — test [E-05]

Juste après le calcul de `shouldStop` (bloc « Check stop conditions before executing »), pour une action qui écrit
au client (`send_sms`, `send_email`, `request_review`, `envoyer_facture`, `envoyer_soumission`) :

```ts
const versClient = ['send_sms', 'send_email', 'request_review', 'envoyer_facture', 'envoyer_soumission'].includes(actionType);
if (versClient) {
  const v = await ciblageOk(supabase, task.org_id, task.entity_type, task.entity_id, task.automation_rules?.conditions);
  if (!v.cible && !v.erreur) {
    // Tâche close « annulée », parcours arrêté, journal « Ignoré : hors ciblage — … ».
    //   automation_scheduled_tasks : status 'cancelled', last_error v.phrase, action_config.motif_code 'hors_ciblage'
    //   automation_execution_logs  : action_type = actionType, result_success true, result_data { saute: v.phrase, saute_code: v.code }
    //   + annulerSequence(...) pour les étapes suivantes du même parcours
    continue;
  }
  // v.erreur (lecture ratée) : laisser la tâche pour la reprise — ne pas clore sur une panne.
}
```

Il faut que la requête des tâches sélectionne `automation_rules.conditions` (vérifier le `select` de la file).
Seul le CIBLAGE est rejoué — pas l'occurrence (`days_overdue`…), comme le dit la conception. Même zone que la
revalidation du point 9 : une seule main.

### 2.3 « Démarrer une automatisation » — `demarrerRegle` — test [E-06]

Avant `await lancerRegle(rule as AutomationRule, event, engineConfig);` :

```ts
const verdictCiblage = await ciblageOk(engineConfig.supabase, cible.orgId, cible.entityType, cible.entityId, (rule as AutomationRule).conditions);
if (!verdictCiblage.cible) {
  await journaliserRegleEcartee(engineConfig.supabase, rule as AutomationRule, event, null, { saute: verdictCiblage.phrase!, saute_code: verdictCiblage.code! });
  return { ok: true, nom: String((rule as AutomationRule).name ?? '') }; // rien ne démarre ; ce n'est pas un échec de l'action qui démarrait
}
```

### 2.4 Doublons — `server/lib/actions/index.ts` — tests [E-20], [E-21], [E-22], [E-27]

a) `ActionContext` : trois champs de plus (mêmes noms que `ContexteDoublon`, on passe `ctx` tel quel) :

```ts
/** Le déclencheur de la règle en cours (`invoice.overdue`…) : garde des doublons. */
declencheur?: string | null;
/** Le nom de la règle en cours : le journal de l'AUTRE automatisation la nomme (« doublon de « … » »). */
nomRegle?: string | null;
/** Fuseau de l'entreprise (heure écrite au journal des doublons). */
fuseau?: string | null;
```

b) `CodeSaut` : ajouter `'doublon'` (et `'hors_ciblage'` si une action l'émet un jour).

c) `executeSendSms` — garder le texte AVANT la mention STOP (deux automatisations au même texte, l'une commerciale
et l'autre non, envoient le même message), puis, à l'endroit de la garde « déjà envoyé » :

```ts
import { gardeDoublon } from './doublons';
…
let body = sansPrenomVide(…);
const texteSansMention = body;                       // ← avant `avecMentionCommerciale`
…
if (dejaParti) return saute(DEJA_ENVOYE, 'deja_envoye');
const garde = await gardeDoublon(ctx, 'sms', to, texteSansMention);
if (garde.doublon) return saute(garde.phrase!, 'doublon');
try {
  …
  const sent = await ctx.twilio.client.messages.create({ … });
  …
} catch (err: any) {
  await garde.liberer();                             // le fournisseur a refusé : la place est rendue
  …
}
```

d) `executeSendEmail` — après la garde « déjà envoyé », avant `sendEmail` :

```ts
const garde = await gardeDoublon(ctx, 'email', to, `${subject}\n${body}`);
if (garde.doublon) return saute(garde.phrase!, 'doublon');
const result = await sendEmail({ … });
if (!result.sent) { await garde.liberer(); return { success: false, error: messageEchecCourriel(result.error) }; }
```
et `await garde.liberer()` dans le `catch` final (déclarer `garde` hors du `try`, ou appeler `liberer` là où il est
en portée). Une demande d'avis passe par ces deux fonctions : couverte.

e) `server/lib/automationEngine.ts` — les deux contextes d'action (`executeRuleActions`, `const ctx: ActionContext = {`
et, dans `processScheduledTasks`, l'objet qui porte `ruleId: task.automation_rule_id`) :

```ts
declencheur: event.type,                 // tâches : actionConfig.trigger_event ?? task.automation_rules?.trigger_event
nomRegle: rule.name,                     // tâches : task.automation_rules?.name  (l'ajouter au `select` de la file)
fuseau,                                  // déjà calculé juste après (`fuseauOrg`) dans executeRuleActions
```

Sans `ruleId`, la garde ne s'applique pas ; sans `nomRegle`, la phrase est « doublon d'un message envoyé à 14 h 02
par une autre automatisation ».

f) **La ligne technique `action_type = 'reservation'`** (`ACTION_RESERVATION`, exporté par `doublons.ts`) : une par
envoi réel, dans `automation_execution_logs`, `result_success: true`, `scheduled_task_id: null`,
`execution_key: doublon:<canal>:<empreinte destinataire>:<empreinte texte>:<jour UTC>`. Tout ce qui COMPTE des
lignes de ce journal doit l'ignorer comme `'conditions'` : `rafaleDeTextos` (filtre déjà sur `send_sms` : OK),
`dejaPasseRecemment`, la relance de facture par 20 h, les statistiques et l'onglet Journaux (§ 3). Elle ne garde ni
le numéro ni le texte tel qu'écrit (empreinte + texte normalisé rogné à 600 caractères) ; elle part avec la purge à
90 jours des journaux.

g) Interrupteur : `AUTOMATION_FENETRE_DOUBLON_HEURES` (défaut 24, plafond 168 ; **0 coupe la garde**).

### 2.5 « Aucune demande d'avis » — `aiguillerAction` — test [E-17]

Remplacer la condition `isReviewPreset(ctx.presetKey)` :

```ts
import { estDemandeDAvis } from '../automations-ciblage';   // ou '../../../src/lib/automationCiblage'
if ((actionType === 'send_sms' || actionType === 'send_email') && estDemandeDAvis({ preset_key: ctx.presetKey }, { type: actionType, config })) {
```
(attention au cycle d'import : `automations-ciblage.ts` importe `./actions` pour `clientDeLEntite` — importer la
fonction pure depuis `src/lib/automationCiblage`, pas depuis `automations-ciblage.ts`.)

### 2.6 Valeur de remplacement — `resolveTemplate` — tests [E-44] (les trois)

`appliquerRemplacement` (`src/lib/automationVariables.ts`) rend EXACTEMENT comme `resolveTemplate` pour un gabarit
sans `|` (prouvé sur 150+ gabarits fournis, texte et HTML : `p/variables-parite.test.ts`) et ajoute `[cle|texte]`,
`{cle|texte}`, `{{cle|texte}}`, `{{objet.cle|texte}}`. Le corps de `resolveTemplate` devient :

```ts
import { appliquerRemplacement } from '../../../src/lib/automationVariables';
export function resolveTemplate(template, vars, options: { html?: boolean } = {}): string {
  return appliquerRemplacement(template, vars, { html: options.html, htmlDeConfiance: VARIABLES_HTML_DE_LUME });
}
```
`sansPrenomVide` reste appliqué par les appelants, APRÈS (le repli du prénom — compagnie, nom complet — joue avant
le remplacement puisqu'il est dans la valeur elle-même).

**Ne pas monter le bouton « Si vide : … » de la palette avant que [E-44] soit vert** (prop `avecRemplacement`).

### 2.7 Variables à créer — `resolveEntityVariables` — tests [E-37], [E-39], [E-32]

| Variable | Valeur | Où |
|---|---|---|
| `company_email` | `company_settings.email` | bloc entreprise (ajouter `email` au `select`) |
| `invoice_balance` | `invoices.balance_cents`, formaté comme `invoice_total` | bloc `invoice` |
| `invoice_days_overdue` | aujourd'hui − `due_date`, fuseau de l'entreprise ; vide si pas en retard | bloc `invoice` |
| `technician_name` | `schedule_events.assigned_user`, sinon `jobs.assigned_user_id`, sinon l'équipe | blocs `job` et `schedule_event` |
| champs de fiche sur un rendez-vous | `refs.job = evt.job_id`, `refs.client = job.client_id` dans le bloc `const liens` | [E-37] |

Dès qu'elles existent, **`p/variables-parite.test.ts` rougit et dit quoi basculer** dans
`src/lib/automationVariables.ts` : retirer `enAttente: true` de l'entrée (la palette l'offre, le détecteur la
reconnaît), passer `CHAMPS_DE_FICHE_SUR_RENDEZ_VOUS` à `true`. C'est voulu : une variable offerte que le moteur laisse
vide est le défaut qu'on corrige.

### 2.8 Pour rendre « Tester avec un client » exact partout (facultatif)

`server/lib/automations-essai.ts` accepte deux fonctions injectées, que la route ne passe pas aujourd'hui :
`etatDeLaFiche(entityType, entityId)` et `evaluerEtat(conditions, metadonnees)`. Il suffit d'EXPORTER
`metadonneesFraiches` du moteur, puis dans la route :

```ts
etatDeLaFiche: (t, id) => metadonneesFraiches(getServiceClient(), { entity_type: t, entity_id: id, org_id: auth.orgId }, {}),
evaluerEtat: (c, m) => evaluateConditions(c, { type: regle.trigger_event, orgId: auth.orgId, entityType: '', entityId: '', metadata: m } as CRMEvent),
```
Sans elles, une condition « si » sur l'état de la fiche (statut du devis…) est « non jugée » et les DEUX branches
sont montrées (l'essai le dit). Non rejoués non plus, et dits dans la réponse : consentement commercial, plafond de
fréquence, heures d'envoi, doublons (`consentementCommercial` n'est pas exporté).

---

## 3. LISTE, STATISTIQUES, JOURNAUX (agent S)

- **Ignorer `action_type = 'reservation'`** partout où `'conditions'` (`ACTION_REGLE_ECARTEE`) l'est déjà :
  compteurs, « envoyées », onglet Journaux, historique d'un client. Constante : `ACTION_RESERVATION`
  (`server/lib/actions/doublons.ts`).
- Un doublon ignoré : `result_data = { saute: 'Ignoré : doublon de « <nom> », envoyé à 14 h 02', saute_code: 'doublon' }`,
  `result_success: true`, `action_type` = celui de l'action. Un client hors ciblage : `saute_code: 'hors_ciblage'`,
  `saute: 'Ignoré : hors ciblage — exclu par l’étiquette « Ne pas relancer »'` ; `action_type: 'conditions'` au
  déclenchement, celui de l'action pour une tâche différée.
- **`src/pages/Automations.tsx`** — la phrase-résumé sous le nom de chaque automatisation :
  `resumeAutomatisation(regle, fr, { champs, etapes })` (`src/lib/automationResume.ts`). `resumeEnMorceaux` rend
  `{ quand, si, qui, alors, phrase }` pour la structure « Quand… → Si… → Qui… → Alors… ».
- Avertissement de doublon au basculement depuis la liste : la route de publication rendra `avertissements`
  (§ 4.4) ; à défaut, `conflitsDeLaRegle(id)` (`src/lib/automationCiblageApi.ts`) rend `{ conflits, lignes }` —
  `lignes` sont prêtes à afficher (trois nommées, puis « … et N autres »).

---

## 4. VALIDATION / SERVEUR (coordinateur)

### 4.1 `server/lib/validation.ts` — `conditionsAutomatisation` — test [E-03] (la moitié « enregistrable »)

```ts
import { ciblageSchema } from './automations-ciblage-schema';
…
    z.union([
      valeurCondition,
      z.object({ eq: …, … }).strict().refine(…),
      // Clé réservée `champs_perso` : conditions sur les champs personnalisés.
      z.array(conditionChampSchema).min(1).max(10),
      // Clé réservée `ciblage` : « Qui est ciblé ».
      ciblageSchema,
    ]),
  )
  …
  .refine(
    (c) => Object.entries(c).every(([k, v]) => {
      if (k === 'ciblage') return ciblageSchema.safeParse(v).success;
      return !(v && typeof v === 'object' && !Array.isArray(v) && ('inclure' in v || 'exclure' in v));
    }),
    'Un ciblage ne va que sous « ciblage ».',
  );
```
(`ciblageSchema` est `.strict()` : il ne se confond pas avec l'objet d'opérateurs `{ eq, in… }`, mais l'ordre dans
l'union compte pour le message d'erreur — le garder en dernier.) Même ajout pour les conditions d'une étape « si »
si elles partagent ce schéma : un `ciblage` n'y a pas de sens, le second `refine` le refuse hors de la clé.

### 4.2 Montage — `server/index.ts`

```ts
import automationCiblageRouter from './routes/automation-ciblage';
…
app.use('/api', automationStatsRouter);
// « Touche X clients », conflits, « Tester avec un client » — trois lectures.
app.use('/api', automationCiblageRouter);
```
`/api/automations/rules/:id/…` est déjà sous `reglesLimiter`. `/api/automations/ciblage/apercu` est appelé à chaque
modification du ciblage (300 ms après la dernière) : lui donner une limite qui ne gêne pas la frappe (ex. 60 / min
par utilisateur), séparée de celle des écritures. Les schémas `apercuCiblageSchema` et `essaiSchema` sont exportés
du fichier de route, à déplacer dans `validation.ts`.

### 4.3 `server/lib/route-permissions.ts`

```ts
  // « Qui est ciblé » : compteur et liste (les noms exigent aussi clients.read, vérifié dans la route).
  'POST /api/automations/ciblage/apercu': 'automations.read',
  // Avertissement de doublon avant de publier.
  'GET /api/automations/rules/:id/conflits': 'automations.read',
  // « Tester avec un client » : simulation, rien n'est envoyé ni écrit. La route exige aussi clients.read.
  'POST /api/automations/rules/:id/tester': 'automations.read',
```
La route revérifie `automations.read` elle-même (comme `automation-messages.ts`) : elle est sûre même montée avant
la table.

### 4.4 `server/lib/automations-publication.ts` — tests [E-28], [E-45], [E-47]

a) **Avertir** — dans `changerPublication`, après les contrôles bloquants et avant l'écriture, quand `actif` :

```ts
import { conflitsDePublication, avertissementsDeConflit, type AvertissementConflit } from './automations-conflits';
…
const avertissements = actif ? avertissementsDeConflit(await conflitsDePublication(client, orgId, regle, fr ? 'fr' : 'en'), fr) : [];
…
return { ok: true, id: ligne.id, is_active: ligne.is_active, name: ligne.name, …, ...(avertissements.length ? { avertissements } : {}) };
```
`ResultatPublication` (branche `ok: true`) gagne `avertissements?: AvertissementConflit[]` (`{ regle_id, nom, canaux,
meme_message, message }`). Le `select` de la règle doit porter `preset_key`. La route
(`server/routes/automation-publication.ts`) relaie le champ dans sa réponse (unitaire et lot). Jamais bloquant : une
lecture ratée rend `[]` et une trace.

b) **Refuser la variable inconnue** — `problemesBloquants` passe par `bloquantsPublication` : le branchement est dans
`src/lib/publicationAutomatisation.ts` (§ 6.3). Côté serveur, il faut lui donner les champs du bureau pour juger un
champ de fiche :

```ts
// à côté de champSurveilleDeLaRegle
const { champs } = await listerChamps(client, orgId, {});          // server/lib/champs/service.ts
problemesBloquants({ ...regle, ...surveille, champs }, fr)
```
`RegleAPublier` gagne `champs?: readonly ChampPourVariables[]`. Les trois appels de `server/routes/automation-rules.ts`
(création publiée, `messagePublieeCassee` à la modification d'une règle publiée) suivent sans autre changement.
**[E-45] et [E-47] visent `automationRuleCreateSchema`** (refus à l'enregistrement d'un BROUILLON) : contraire à la
décision prise (« avertissement en brouillon, refus à la publication ») — à réécrire sur `problemesPublication`,
comme le dit la conception (`E-conception.md`, fin de la Conception 3). Voir § 8.

### 4.5 `server/routes/automation-rules.ts`

- Copie d'une règle (dupliquer, copier vers d'autres bureaux, « Partir d'un modèle ») : `conditions.ciblage` suit
  tel quel — SAUF les règles `type: 'champ'` vers un AUTRE bureau (l'id du champ n'y existe pas : la règle serait
  « invérifiable » et n'enverrait à personne). `server/lib/automatisations-bureaux.ts` doit soit refaire la
  correspondance des champs par clé, soit retirer ces lignes et le dire.
- Changement de déclencheur : `conditionsApresChangement` (`src/lib/automationCatalogue.ts`, à toi) ne garde que
  les clés communes aux deux déclencheurs — `ciblage` doit être GARDÉ dès que le nouveau déclencheur a un client
  (tout sauf `webhook.received`) :
  ```ts
  if (cible.cle !== 'webhook.received' && conditions?.ciblage) sortie.ciblage = conditions.ciblage;
  ```
- Création : appeler `conflitsDePublication` quand la règle est créée publiée, et rendre `avertissements`.

### 4.6 `src/lib/automationCatalogue.ts` (à toi)

- Retirer `CHAMPS_ETIQUETTES_CLIENT` des champs ajoutés d'office à chaque déclencheur (bloc
  `export const DECLENCHEURS = DECLENCHEURS_DE_BASE.map(…)`) AU MÊME MOMENT que `SectionCiblage` est montée : les
  deux listes d'étiquettes deviennent des lignes de la section. `CLES_CONDITIONS_ETIQUETTES` reste (le moteur et la
  lecture de compatibilité s'en servent). Les automatisations existantes ne changent pas : `lireCiblage` relit les
  deux clés, `ecrireCiblage` les réécrit au premier enregistrement de la section.
- Texte par défaut d'un texto (apostrophe typographique, [E-61]) : hors de mon périmètre.

### 4.7 `server/lib/lumi/deja-publiees.ts` — test [E-29]

`lireDejaPubliees(client, orgId, declencheur, saufId, langue, regle?)` — 6e paramètre : la règle en cours de
construction (`{ conditions, steps, actions }`). Ajouter `conditions, preset_key` au `select`, puis ne garder que les
règles que `reglesEnConflit` retient :

```ts
import { reglesEnConflit } from '../automations-conflits';
const lignes = (data ?? []) as RegleComparee[];
const gardees = regle
  ? new Set(reglesEnConflit({ ...regle, id: saufId, trigger_event: declencheur }, lignes, langue).map((c) => c.regle_id))
  : null;
return lignes.filter((r) => !gardees || gardees.has(String(r.id))).map(…);
```
Le test [E-29] passe `{ conditions: { client_sans_etiquette: 'VIP' } }` sans `steps` ni `actions` : `reglesEnConflit`
exige au moins un canal client côté règle en construction — passer les étapes du parcours généré (l'appelant les a :
`verdict.data`), ou, pour ce test, traiter « aucun canal connu » comme « tous les canaux ». À trancher avec l'agent E
(le test, tel qu'écrit, ne donne pas d'actions à la règle neuve).

---

## 5. LUMI (coordinateur / agent L) — `server/lib/lumi/generer-parcours.ts`, `server/lib/agent/tools-reglages.ts`

- **Variables** : la consigne cite `VARIABLES_CONNUES` (« Variables entre crochets : UNIQUEMENT celles-ci »). La
  remplacer par `variablesPourConsigne(fr).join('\n')` (`src/lib/automationVariables.ts`) : mêmes variables que la
  palette, avec les fiches où chacune a une valeur ; stable (aucune valeur variable : reste dans le préfixe mis en
  cache). Ajouter : « valeur de remplacement permise : `[client_first_name|là]` » une fois [E-44] vert.
- **Contrôle des variables inventées** (`variablesInconnues(textesDesMessages(…))` dans `generer-parcours.ts`,
  `problemeDeVariables` dans `tools-reglages.ts`, `automations-ecriture.ts`) : passer au détecteur du catalogue,
  avec le déclencheur — `variablesInconnues(texte, declencheur, champs)` rend `{ ecrit, raison, fr, en }[]` ; il
  couvre « hors contexte » et « mal écrite ». `tools-reglages.ts` tient une 8e liste (`VARIABLES_TOUJOURS`,
  `VARIABLES_PAR_FICHE`) : la dériver de `variablesPour(declencheur).base` + `.plus`.
- **Ciblage** : le générateur accepte `ciblage` dans sa réponse (schéma `ciblageSchema`) et l'écrit par
  `ecrireCiblage(conditions, ciblage)` ; un outil de clavardage « changer le ciblage » passe par la même écriture.
  Le résumé de Lumi cite le compteur : `apercuCiblage(client, orgId, { ciblage, canaux: canauxDeLaRegle(regle), demandeAvis: regleDemandeUnAvis(regle) })`.
  `ciblageEnClair(ciblage, fr, champs)` dit le ciblage en mots.
- **Conflits** : les outils qui publient ou créent (`toggle_automation_rule`, `create_automation_from_text`,
  `create_automation_from_template`) relaient `avertissements[].message` de `changerPublication` (§ 4.4).
- **Résumé avant activation** : `resumeAutomatisation(regle, fr)` (une phrase) à côté de `resumeDeLaRegle` (détaillé).

---

## 6. ÉDITEUR (agent U)

### 6.1 `src/components/automations/PanneauDeclencheur.tsx` — la section « Qui est ciblé »

```tsx
import SectionCiblage from './SectionCiblage';
import { ciblagePourEditeur, ecrireCiblage, canauxDeLaRegle, regleDemandeUnAvis, type Ciblage } from '../../lib/automationCiblage';

const [ciblage, setCiblage] = useState<Ciblage>(() => ciblagePourEditeur(conditions));
// dans l'effet qui recharge le brouillon (clé `declencheur.cle`) : setCiblage(ciblagePourEditeur(conditions));

// … dans le rendu, avant la section « Filtres » — sauf pour un déclencheur sans client :
{declencheur.cle !== 'webhook.received' && (
  <SectionCiblage
    valeur={ciblage} onChange={(c) => { setCiblage(c); setTouche(true); }} fr={fr}
    etiquettes={etiquettes} champsPerso={champsPerso}
    canaux={canauxDeLaRegle(regle)} demandeAvis={regleDemandeUnAvis(regle)}   // `regle` : { steps, actions, preset_key } — prop à ajouter au panneau
  />
)}

// dans `enregistrer`, à la fin :
onEnregistrer(ecrireCiblage(sansConditionsIncompletes(…), ciblage), caseSortie ? arreterSiResolu : undefined);
```
`ecrireCiblage` retire les lignes incomplètes, les doublons, et les deux anciennes clés d'étiquette (devenues des
lignes). Refuser l'enregistrement si `fautesDuCiblage(nettoyerCiblage(ciblage), champsClient).length > 0` (la section
les affiche déjà en `role="alert"`). La section « Filtres » reste, renommée « Seulement si ce devis / cette
facture… ». Le compteur appelle `POST /api/automations/ciblage/apercu` 300 ms après la dernière modification.

### 6.2 `src/components/automations/PanneauEtape.tsx` — la palette — tests [E-30] à [E-36]

Remplacer les deux blocs « Insérer une information du client » (`VARIABLES.map`) et « Insérer un champ »
(`BoutonsVariablesChamps`) par :

```tsx
import PaletteChamps from './PaletteChamps';
import { raccourcisPour, variablesInconnues } from '../../lib/automationVariables';

const refPanneau = useRef<HTMLElement>(null);   // à poser sur l'<aside> du panneau
…
<PaletteChamps declencheur={declencheur} entite={objetChamps} fr={fr} champsPerso={champsPerso} portee={refPanneau}
  avecRemplacement={/* vrai dès que [E-44] est vert */} />
```
La palette écrit dans le champ contrôlé par l'accesseur natif + l'événement `input` : le `onChange` de `ChampAction`
part comme pour une frappe — **rien à changer dans `ChampAction.tsx`**. Elle insère au curseur du dernier champ de
texte actif (objet, aperçu, message, y compris la version anglaise).

- **[E-35] cherche un bouton « Nom du client »** : c'est un raccourci d'aujourd'hui. Garder la ligne de raccourcis,
  mais contextuelle : `raccourcisPour(declencheur, { entite })` rend `{ cle, ecrit, fr, en }[]` (« Nom du client »,
  « Nom de votre entreprise », « Total », « Lien facture », « Lien du devis », « Date du rendez-vous » — seulement
  ceux qui ont une valeur : c'est ce qu'exige [E-31]) ; leur clic doit insérer AU CURSEUR — le plus simple : passer
  ces raccourcis par le même mécanisme (`insererAuCurseur`, exporté par `PaletteChamps.tsx`).
- **Détecteur** ([E-36], [E-46], [E-47]) : remplacer `variablesInconnues(config[champ.cle] ?? '')` (de
  `emailBodyText`) par `variablesInconnues(texte, declencheur, champsPerso, { entite: objetChamps })` ; chaque
  problème porte sa phrase (`p.fr` / `p.en`) — plus besoin de `variableLisible`. Le bandeau reste un avertissement
  en brouillon ; le refus est à la publication (§ 6.3).
- [E-32] : « solde », « jours de retard » et « courriel de l'entreprise » n'apparaîtront qu'une fois le moteur
  capable de les remplir (§ 2.7) — le test reste rouge jusque-là, à dessein.
- `MessageEditor.tsx`, `EmailPreviewEditor.tsx` : même `<PaletteChamps>` (avec `onInserer` si l'éditeur gère son
  texte lui-même), et `rendreAvecExemples(texte, declencheur, champs, fr)` pour « Le client lira : … ».
- `src/components/champs/automatisations.tsx` : `BoutonsVariablesChamps` n'a plus d'appelant.
- `src/lib/champs/types.ts` : `ConfigChamp` gagne `dans_messages?: boolean` (« Proposer dans les messages ») ; écran
  Réglages → Champs personnalisés : la case. Sans elle, les défauts du catalogue s'appliquent (`champPropose`).

### 6.3 `src/lib/publicationAutomatisation.ts` — le branchement en UNE ligne — tests [E-36], [E-45], [E-47] réécrits

```ts
import { enProblemes } from './automationControles';
import type { ChampPourVariables } from './automationVariables';
// RegleAPublier : + champs?: readonly ChampPourVariables[]

export function problemesPublication(regle: RegleAPublier): ProblemePublication[] {
  return [...problemesDeBase(regle), ...enProblemes(regle, { champs: regle.champs })];   // `problemesDeBase` = le corps actuel
}
```
`controlesPublication(regle, { champs })` rend `{ bloquants, avertissements }` (chacun `{ code, fr, en, etapeId? }`) :
variable inconnue / hors contexte / mal écrite / remplacement trop long, message vide une fois la mise en forme
retirée, attente sans durée, condition dont aucune branche ne mène quelque part, étape que rien n'atteint, boucle,
message au client sur « Appel reçu de l'extérieur » ; avertissement au-delà de 25 étapes. Rien de ce que
`problemesAvantPublication` dit déjà n'est redit (test « aucun problème n'est dit deux fois »). Aucun préréglage,
parcours du pack ni modèle fourni n'est bloqué (testé).

### 6.4 `src/pages/AutomationBuilderPage.tsx`

- **Résumé en haut** : `resumeAutomatisation({ trigger_event, conditions, steps, actions, delay_seconds }, fr, { champs, etapes })`,
  recalculé à chaque changement du brouillon (fonction pure, instantanée).
- **Avertissement de doublon avant de publier** — dans le bloc qui bâtit la confirmation (« Publier cette
  automatisation ? », la liste `...avertissements.map((a) => `⚠ ${a.message}`)`) :
  ```ts
  import { conflitsDeLaRegle } from '../lib/automationCiblageApi';
  const { lignes } = await conflitsDeLaRegle(regle.id).catch(() => ({ lignes: [] as string[] }));   // jamais bloquant
  …  ...lignes.map((l) => `⚠ ${l}`),
  ```
  La route lit la version ENREGISTRÉE : enregistrer avant d'ouvrir la confirmation (l'éditeur le fait déjà).
- **« Tester avec un client »** : `testerAvecUnClient(regle.id, { client_id, brouillon: { trigger_event, conditions, steps, actions, delay_seconds } })`
  rend `ResultatEssai` (`src/lib/automationEssai.ts`) : client, fiche utilisée, ciblage, puis une entrée par étape —
  `issue` (`partirait` / `ignoree` / `attente` / `condition` / `fin`), `sur_le_chemin` (`oui` / `non` / `peut_etre`),
  `rendu` (canal, destinataire, objet, texte, html, nombre de SMS), `raison`, `variables_vides`, et
  `avertissements`. Le choix du client : la recherche de clients existante. L'écran (une fenêtre qui liste les
  étapes) reste à écrire — je n'ai pas bâti de composant pour ne pas préjuger de la mise en page du panneau.

---

## 7. Décisions que je te demande

1. **« Tester avec un client » : simulation (livrée) ou exécution en bac à sable forcé ?** J'ai écrit une simulation
   pure : rien n'est exécuté, rien n'est écrit (ni étiquette posée, ni tâche créée, ni journal) — c'est le texte de
   la mission (« simulation étape par étape… SANS rien envoyer »), et c'est la seule forme sûre sur un VRAI client.
   Une exécution réelle « bac à sable forcé » demanderait : `contexteEnvoi` porteur d'un drapeau `forcerSimulation`
   lu par `verdictBacASable` (`server/lib/bac-a-sable.ts`), un point d'entrée du moteur qui joue un parcours en
   mémoire sans file ni journal, et une réponse à « que fait-on des écritures (étiquettes, tâches, statuts) ? ».
   Je recommande de garder la simulation, et d'exporter `metadonneesFraiches` (§ 2.8) pour qu'elle juge toutes les
   conditions.
2. **Le compteur lit avec la session de l'utilisateur.** Pour un propriétaire ou un admin, c'est exactement ce que
   le moteur ciblera. Pour un membre à portée restreinte, c'est le compte de SES clients (le moteur, lui, cible tout
   le bureau). L'autre choix — compter au rôle de service, ne montrer que les noms visibles — dit le vrai nombre à
   tout le monde mais sort un agrégat du bureau à qui n'en voit qu'une partie. J'ai pris le plus prudent.
3. **Avertissement de conflit : beaucoup de noms sur les séries de préréglages.** Les rappels de facture à 1, 3, 7 et
   30 jours sont QUATRE règles sur `invoice.sent` : publier l'une nomme les trois autres (les quatre conditions de la
   conception sont remplies). `meme_message` distingue le cas grave (texte quasi identique : un seul partira) et
   passe en premier ; `lignesDeConflit` en nomme trois puis résume. Si tu veux moins de bruit : n'avertir que quand
   `meme_message` est vrai OU que le délai est le même — une ligne dans `reglesEnConflit`.
4. **Étape orpheline = bloquant.** La mission le demande (« nœud orphelin ») ; conséquence : modifier une règle
   PUBLIÉE qui porte une étape que rien n'atteint (inerte aujourd'hui) sera refusé tant qu'elle n'est pas reliée ou
   supprimée (`publiee_cassee` ne retient que les problèmes NOUVEAUX : une orpheline déjà là ne bloque pas une
   modification qui n'y touche pas — vérifié dans le code de la route, pas rejoué).
5. **`[côté]`, `[important]` : signalés.** Un mot seul entre crochets est EFFACÉ par le moteur s'il est sans accent
   (`[important]` → vide) et laissé tel quel s'il en a un (`[côté]`). Les deux sont bloquants à la publication
   (« inconnue » / « mal écrite »). « Rabais [50 %] », « voir [ci-dessous] », « [A-1234] » ne le sont pas.
6. **Hors ciblage en cours de parcours** : la conception dit « tâche close annulée, parcours arrêté ». Le code
   `hors_ciblage` est de catégorie « ignorée » dans `automationMotifs.ts` : une tâche ANNULÉE comptée « ignorée »
   dans les statistiques — cohérent avec « doublon » et « plafond » (issue ignorée), mais ici le parcours s'arrête.
   À confirmer avec l'agent S.

---

## 8. Tests de l'agent E

Aucun des tests ROUGES de l'agent E ne peut passer au vert avec des fichiers neufs : tous exercent un fichier
existant (`PanneauEtape`, `resolveTemplate`, `automationRuleCreateSchema`, le moteur, `changerPublication`,
`lireDejaPubliees`). Leurs MÉCANISMES sont prouvés par mes tests, cités ci-dessous ; ils passeront au branchement.

| Test de E | Attend le branchement | Mon test du mécanisme |
|---|---|---|
| [E-03] | § 2.1 a, c + § 4.1 | `ciblage-pur` (schéma), `ciblage-serveur`, `p-reel` |
| [E-04] (le premier) | § 2.1 | `ciblage-serveur` « [mécanisme de E-04] », `p-reel` |
| [E-04] (le second, `champs_perso` d'un autre objet) | à RÉÉCRIRE en refus à l'enregistrement (conception) | — |
| [E-05] | § 2.2 | `ciblage-serveur` « [mécanisme de E-05] » |
| [E-06] | § 2.3 | — (appel de `ciblageOk`, même fonction) |
| [E-07] | § 2.1 b, c | `ciblage-pur` (phrase), `p-reel` |
| [E-11] | décision prise (aucun texto vers un STOP) : `executeSendSms`, retirer la branche `parCanal` — agent M | hors de mes fichiers |
| [E-17] | § 2.5 | `ciblage-serveur` « [mécanisme de E-17] » |
| [E-20], [E-21], [E-22] | § 2.4 | `doublons` « [mécanisme de E-20/21/22] », `p-reel` |
| [E-27] | § 2.4 | `doublons` + `p-reel` (deux consommateurs réellement simultanés, vrai index unique) |
| [E-28] | § 4.4 a | `conflits`, `p-reel` |
| [E-29] | § 4.7 | `conflits` « [mécanisme de E-29] », `p-reel` |
| [E-30] à [E-35] | § 6.2 | `palette-champs`, `variables` |
| [E-32] (solde, jours de retard, courriel de l'entreprise) | § 2.7 puis bascule `enAttente` | `variables-parite` |
| [E-36] | § 6.2 (détecteur) | `variables` « [cible de E-36] » |
| [E-37], [E-39] | § 2.7 | — |
| [E-44] ×3 | § 2.6 | `variables` « [cible de E-44] », parité avec le moteur |
| [E-45], [E-47] | § 4.4 b + réécriture (voir ci-dessous) | `controles` |
| [E-46] | bascule de `emailBodyText.variablesInconnues` vers le catalogue | `variables` « [cible de E-46] » |
| [E-49] | voir ci-dessous | `variables`, `palette-champs` « [cible de E-33] » |
| [E-61], [E-62], [E-63], [E-64], [E-66], [E-52] | point 16, hors de mes pièces | — |

Trois tests de l'agent E me paraissent viser la mauvaise cible — **je n'y ai pas touché** :

- **[E-45] et [E-47]** exigent que `automationRuleCreateSchema` REFUSE une variable inconnue ou hors contexte. Or la
  décision est « avertissement en brouillon, refus à la publication » : refuser au schéma casserait
  l'enregistrement automatique d'un brouillon en cours de frappe (le risque est écrit dans `E-constats.md`, E-36).
  À réécrire sur `problemesPublication` (ou `controlesPublication`) — la conception le dit elle-même.
- **[E-49]** exige que `champsSysteme(objet)` ne contienne ni case à cocher ni note interne. `champsSysteme` est la
  liste des champs des FORMULAIRES (`src/lib/champs/standard.ts`) : elle doit les contenir. La bonne cible est ce que
  la palette OFFRE — `variablesPour(declencheur).plus` — qui, lui, les exclut (testé).
- **[E-29]** : voir § 4.7 — le test n'apporte ni `steps` ni `actions` à la règle en construction.

---

## 9. Codes de résultat, i18n, divers

- **`src/lib/automationMotifs.ts` : aucun code ne manque.** `doublon` et `hors_ciblage` y sont. La ligne technique
  `reservation` n'est pas une issue (pas de `saute_code`) : c'est un `action_type` à ignorer (§ 3).
- **Clés i18n : aucune.** Comme tout le dossier `automations/`, les textes sont en ligne (`fr ? … : …`) ; chaque
  libellé, phrase de journal, faute et avertissement existe dans les deux langues, et les tests le vérifient
  (résumé : chaque déclencheur × chaque action, fr et en ; palette et section : rendu anglais sans mot français).
  Le journal (`result_data.saute`) reste en français, comme les autres motifs (`libelleMotif` montre le libellé du
  code en anglais).
- **`vitest.config.ts`** : rien à faire — `tests/automations-finale/p/**` tourne dans la suite ordinaire (sans
  base) ; `integration/` se saute hors de la pile locale. Pour `test:automations:all` : ajouter le projet
  `tests/automations-finale/p/vitest.config.ts`.
- **`tsconfig.p.json`** (racine de `wt-p`, non commité) : à supprimer avec l'arbre.
- **Pile locale** : mes bureaux « [TEST] QA Automatisations A / B (p) » existent ; mes tests y nettoient ce qu'ils
  créent (clients, étiquettes, règles, réservations, STOP) — vérifié : 0 client, 0 ligne de journal laissés.
- **Pas de migration** : confirmé. La réservation tient sous l'index unique existant
  `idx_execution_logs_immediat_dedup` (prouvé contre la vraie base) ; le compteur se calcule en mémoire.

## 10. Ce que je n'ai PAS fait

- Aucun fichier existant modifié : rien n'est branché, rien n'est visible à l'écran ni actif dans le moteur.
- Pas d'écran pour « Tester avec un client » (la route et le contrat seulement), ni de case « Proposer dans les
  messages » dans Réglages → Champs personnalisés (le catalogue lit déjà `config.dans_messages`).
- Rien au vrai navigateur (Playwright) : mes deux composants sont éprouvés en jsdom ; ils ne sont montés nulle part,
  il n'y a encore rien à ouvrir. À faire dès la phase 2 — en particulier l'insertion au curseur de la palette dans
  Chromium / WebKit / Firefox (le mécanisme « accesseur natif + événement `input` » est standard, mais la position
  du curseur après un re-rendu de React mérite un vrai navigateur).
- `tsc` complet non joué (mémoire insuffisante sur le poste, `tsc` s'arrête au bout de 5 minutes) : types vérifiés
  sur mes fichiers et tout ce qu'ils importent (`tsconfig.p.json`), sans erreur.
- Performance du compteur sous la RLS sur un gros carnet : non mesurée (l'agent E a mesuré 135 à 275 ms au rôle de
  service sur 5 000 clients ; mes bureaux n'ont qu'une poignée de fiches). À mesurer avec la session d'un
  propriétaire sur le bureau B (e) avant de brancher.
