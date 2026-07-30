# Storage — chemins legacy sans org

La migration `20260729120000_storage_org_scoped_policies.sql` cloisonne
`storage.objects` par organisation. Elle laisse volontairement une porte
ouverte en **lecture seule** : `public.lume_storage_is_legacy_path()`.

Ce document liste ce qu'il reste à faire pour la refermer.

> **Appliquée en production le 2026-07-29.** Les deux fonctions vivent dans
> `public` et non `storage` : Supabase refuse la création de fonctions dans
> le schéma `storage` via l'API (`42501: permission denied for schema
> storage`). Noms réels : `public.lume_storage_object_org(text)` et
> `public.lume_storage_is_legacy_path(text)`.
>
> Couverture vérifiée après application — 47 objets sur 48 :
>
> | Bucket | org-scopé | legacy (lecture tolérée) |
> |---|---|---|
> | `attachments` | 14 | 20 |
> | `job-photos` | 9 | 4 |
> | `company-logos` | 8 | — |
>
> Le 48ᵉ est `company-logos/default/1773367648164.png`, produit par le
> fallback `path={orgId || form.org_id || 'default'}` de
> [CompanySettings.tsx:367](../src/pages/CompanySettings.tsx#L367). Il n'est
> référencé par aucune ligne de `company_settings` ni de `orgs` — résidu de
> test de mars 2026. Le bucket étant public il reste lisible ; seule sa
> suppression via l'API est désormais refusée. À nettoyer côté service_role,
> et à corriger en supprimant le fallback `'default'`.

## Pourquoi cette porte existe

Les chemins d'upload n'ont jamais été uniformes. Au 2026-07-29, sur les 34
objets de `attachments` et 13 de `job-photos` :

| Préfixe | Org dans le chemin | Objets | Site d'upload |
|---|---|---|---|
| `measurements/{orgId}/{quoteId}/` | oui (2e segment) | 2 | [measurementApi.ts:130](../src/lib/measurementApi.ts#L130) |
| `request-forms/{orgId}/` | oui (2e segment) | 9 | [request-forms.ts](../server/routes/request-forms.ts) |
| `{orgId}/{jobId}/` (job-photos) | oui (1er segment) | 9 | relais serveur |
| `courses/` + `courses/videos/` | **non** | 16 | [CourseBuilder.tsx:294,461,487](../src/pages/CourseBuilder.tsx#L294) |
| `quotes/photos/` | **non** | 3 | [QuoteNew.tsx:515](../src/pages/QuoteNew.tsx#L515) |
| `note-boards/{boardId}/` | **non** | 3 | `noteBoardsApi.ts` |
| `specific-notes/{type}/{id}/` | **non** | 1 | [specificNotesApi.ts:126](../src/lib/specificNotesApi.ts#L126) |
| `clients/{clientId}/` | **non** | 0 | [ClientDetails.tsx:230](../src/pages/ClientDetails.tsx#L230) |
| `jobs/{jobId}/` | **non** | 0 | [JobDetails.tsx:279](../src/pages/JobDetails.tsx#L279) |
| `checklists/{jobId}/` | **non** | 0 | [JobChecklistsSection.tsx:139](../src/components/JobChecklistsSection.tsx#L139) |
| `avatars/` (dans job-photos) | **non** | 4 | mal rangé, devrait être dans `avatars` |

Appliquer un filtre org strict d'emblée aurait rendu ~25 fichiers de
production inaccessibles. D'où le `or storage.lume_is_legacy_path(name)`
sur les policies SELECT — et **seulement** sur SELECT : écrire ou supprimer
sous un préfixe legacy est déjà refusé.

## Risque résiduel assumé

Un utilisateur authentifié de n'importe quelle org peut encore **lire** les
objets sous préfixe legacy s'il en devine le chemin. Ce n'est plus du
listing libre de tout le bucket, mais ce n'est pas nul : `quotes/photos/`
et `note-boards/` contiennent des photos liées à des clients.

Les chemins legacy contiennent des UUID (`note-boards/{boardId}/{uuid}.png`)
ou un timestamp + suffixe aléatoire (`quotes/photos/1783646681278-5xepxk.png`),
donc non énumérables en pratique — mais l'accès n'est pas *vérifié*, il est
seulement *difficile à deviner*. À refermer.

## Étapes pour refermer

1. **Préfixer les nouveaux uploads par l'org** dans les 7 sites du tableau
   ci-dessus. Le format cible est `{orgId}/{contexte}/...`, cohérent avec
   `job-photos` et avec la garde du relais serveur
   ([storage-upload.ts:33](../server/routes/storage-upload.ts#L33)).
2. **Déplacer les objets existants** (`storage.objects` supporte
   `UPDATE ... SET name = ...` côté service_role, ou l'API `move()`).
   Mettre à jour en parallèle les URL persistées en base : `job.attachments`,
   les photos de devis, `note_boards`, `specific_notes`.
3. **Supprimer** `storage.lume_is_legacy_path` et les deux `or
   storage.lume_is_legacy_path(name)` des policies SELECT.

## Point connexe : `getPublicUrl` sur buckets privés

`attachments` et `job-photos` sont privés depuis
`20260717250000_private_storage_buckets.sql`, dont le commentaire affirme
« aucun flux légitime ne casse ». C'est inexact : ces sites construisent
encore des URL publiques qui renvoient 400 sur un bucket privé.

- [JobDetails.tsx:282](../src/pages/JobDetails.tsx#L282)
- [storage.ts:78,133](../src/lib/storage.ts#L78)
- [specificNotesApi.ts:135](../src/lib/specificNotesApi.ts#L135)
- [request-forms.ts:351](../server/routes/request-forms.ts#L351)
- [storage-upload.ts:52](../server/routes/storage-upload.ts#L52)

Le bon pattern existe déjà dans [measurementApi.ts:138](../src/lib/measurementApi.ts#L138)
(`createSignedUrl`, TTL 1 h). À généraliser.

Cas à part : [OnboardingWizard.tsx:80](../src/components/OnboardingWizard.tsx#L80)
signe pour **1 an** (`60 * 60 * 24 * 365`). Une URL signée d'un an est une
URL publique permanente et non révocable — à ramener à quelques heures et
resigner à l'affichage.
