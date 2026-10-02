# Durcissement des écritures de `automation_rules` (constats R-01 à R-05, roles-05/06/07)

À faire PAR LE COORDINATEUR, une fois les lots des agents U, L, T intégrés (ils touchent les mêmes fichiers).
Source : lot « rôles » de la session fd (`D:/lume-uiaudit/sorties/triage/roles.md`) et son avis d'auteure de la garde
`20261007300000_automation_rules_garde.sql`.

## Le défaut
Un membre qui a « modifier les automatisations » peut écrire le CONTENU d'une règle directement en base (PostgREST),
sans passer par le serveur : déclencheur hors catalogue, texto de 5 000 caractères, texto vidé sur une règle publiée
(qui reste publiée), brouillon créé sans le forfait. Les routes du serveur écrivent elles-mêmes avec le client de
l'utilisateur (`auth.client`, rôle `authenticated`) : la base ne peut donc pas distinguer « la route » de « un appel direct ».

## La cible
1. UNE seule porte : `server/lib/automations-ecriture.ts` — `insererRegle(orgId, ligne, { auteurId, origine })`,
   `ecrireRegle(orgId, id, patch, { auteurId, origine })`, `supprimerRegle…` (corbeille, restauration, purge).
   Rôle de SERVICE, donc chaque requête porte `.eq('org_id', orgId)` avec un `orgId` VÉRIFIÉ (le rôle de service
   contourne la RLS et la policy restrictive « bureau actif » : sans ce filtre, c'est une écriture entre bureaux).
   Avant d'écrire : contrôle explicite du droit (adhésion ACTIVE à CE bureau + `automations.update`, ce que fait
   `member_has_permission`), validation (Zod `sequenceEtapes`, `verifierCoherence`, déclencheur du catalogue et offert à
   l'entreprise, variables connues, longueurs), `steps` + `actions` remis en accord, journal des modifications
   (`journaliserModification` de l'agent S), relecture de la ligne.
2. Test statique : aucun `.from('automation_rules')` suivi de `insert` / `update` / `delete` / `upsert` hors de ce
   fichier (serveur ET `src/`). Les lectures restent à la session (la RLS les borne).
3. Migration : `revoke insert, update, delete on public.automation_rules from authenticated, anon` (fermé par
   défaut, visible dans l'ACL et dans db:diff ; un écrivain oublié casse bruyamment). La garde par déclencheur de fd
   reste en seconde ceinture. Rappel : un projet neuf redonne ALL à `authenticated` → `db:sync-acl` après tout clonage.
4. R-03 : `automation_webhooks` — plus de DELETE par une session (corbeille ou route) ; R-05 : RLS de `client_tags`
   (table sans `org_id` : passer par `clients.org_id` et la permission `clients.update`).

## Les écrivains de session à convertir (liste de fd, à revérifier par grep au moment de le faire)
- `server/lib/automations-publication.ts` : la « preuve de droit » (UPDATE de `updated_at` par le client de
  l'utilisateur) et la DÉPUBLICATION ; `activerApresEcritureUtilisateur`. → contrôle explicite puis rôle de service.
- `server/lib/automatisations-bureaux.ts` (« Copier vers d'autres bureaux ») : écrit dans chaque bureau cible avec un
  client de l'utilisateur borné à ce bureau. → vérifier soi-même l'adhésion active et la permission dans CHAQUE
  bureau cible.
- `server/routes/automation-rules.ts` : création, PATCH (`folder_id`, `name`, `settings`, contenu), duplication,
  « utiliser un modèle », corbeille, restauration, purge, `lumi_conversation` (≈ l. 528), ménage du brouillon vide
  (≈ l. 331). `server/lib/automations-corbeille.ts`.
- `src/lib/automationRulesApi.ts` (navigateur) → route `server/routes/automation-messages.ts` (agent T).
- `server/lib/agent/tools-reglages.ts` (deux insert, un update par `ctx.client`) → fonction unique (agent L).
- `server/lib/agent/tools-lot-entreprise.ts` ≈ l. 442 (`update({ is_active: false })` en repli) → session a1.

## Preuve
`scripts/qa/verifier-garde-automatisations.mjs --etendue` (fd, branche `qa/audit-auto-lot6`) : rouge avant, vert après,
sur la pile locale, puis staging, puis prod. Plus la suite complète locale et les specs e2e de fd.

## Ordre de passage
Code (a) déployé AVANT la migration (b) — sinon l'app ne peut plus rien enregistrer. Migration : staging, checks
(`check:broken-objects`, `check:db-coherence`, `check:schema-refs`), puis prod, avec l'accord de Rafba pour la série.
