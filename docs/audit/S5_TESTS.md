# S5 — Campagne d'isolation multi-tenant (exécutée)

- **Date** : 2026-07-31, ~03:00 UTC
- **Cible** : production `bbzcuzqfgsdvjsymfwmr`
- **Résultat** : **0 fuite d'isolation confirmée**

---

## 1. Pourquoi cette campagne a pu être menée sans branche Supabase

Le plan d'audit prévoyait de créer une branche jetable, deux organisations et
deux utilisateurs de test — donc d'écrire. Ce n'était pas nécessaire.

PostgreSQL permet de **se faire passer pour un utilisateur réel** sans rien
créer :

```sql
begin;
select set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true);
set local role authenticated;
select count(*) from <table> where org_id <> '<org du sujet>';
rollback;
```

`auth.uid()` lit `request.jwt.claims`, exactement comme lors d'un appel via
PostgREST. Le `set local role authenticated` fait tomber les privilèges au
niveau d'un utilisateur ordinaire, donc **la RLS s'applique pleinement**.
L'ensemble est enfermé dans `begin … rollback` et n'émet que des `SELECT`.

C'est donc une **mesure réelle sur les données de production**, pas une
simulation sur un jeu de test — et sans aucune écriture.

## 2. Protocole

- **Sujet** : un utilisateur réel, membre d'**une seule** organisation, choisie
  comme étant celle qui porte le plus de données.
- **Pour chaque table portant un `org_id`** :
  1. compter, en tant que `postgres`, les lignes appartenant à **d'autres**
     organisations — c'est ce qui rend le test concluant ou non ;
  2. recompter les mêmes lignes en tant que l'utilisateur simulé.
- **Attendu** : 0. Toute valeur non nulle est une fuite.

Le point 1 est essentiel : **un résultat de 0 sur une table qui ne contient
aucune donnée d'autre organisation ne prouve rien.** Ces cas sont comptés
séparément comme « non concluants », jamais comme des succès.

## 3. Résultats

| Périmètre | Testé de façon concluante | Non concluant | Fuites |
|---|---|---|---|
| Tables portant un `org_id` (170 au total) | **45** | 125 | **0** |
| Vues exposant un `org_id` (11 au total) | **4** | 7 | **0** |

### Preuves positives les plus fortes

| Table | Lignes d'autres orgs | Vues par le sujet |
|---|---|---|
| `audit_events` | 1 937 | **0** |
| `security_events` | 88 | **0** |
| `automation_rules` | 55 | **0** |
| `tracking_points` | 52 | **0** |
| `communication_settings` | 30 | **0** |
| `activity_log` | 27 | **0** |
| `memberships` | 19 | **0** |
| `tracking_events` | 16 | **0** |
| `clients` | 13 | **0** |
| `properties` | 13 | **0** |

`audit_events` est le cas le plus probant : 1 937 lignes appartenant à d'autres
organisations, **aucune visible**.

## 4. Les trois alertes levées — toutes écartées après vérification

### `invoice_templates` — FAUX POSITIF de mon propre test

Le test signalait « 3 lignes sur 6 d'autres orgs visibles ». Vérification :

```
gabarits systeme partages (org_id NULL, is_system_template = true) : 3
lignes org_id NULL non systeme                                     : 3
lignes rattachees a une organisation                               : 0
```

**Aucune ligne de cette table n'appartient à une organisation.** Les 3 lignes
visibles sont les gabarits système, explicitement autorisés par la policy :

```sql
has_org_membership(auth.uid(), org_id) OR (org_id IS NULL AND is_system_template = true)
```

L'erreur venait de mon prédicat `org_id is distinct from '<org>'`, qui compte
les `NULL` comme « une autre organisation ». Corrigé dans la passe sur les vues
(`org_id is not null and org_id <> …`).

> **Effet de bord constaté** : 3 lignes ont `org_id NULL` **sans** être des
> gabarits système. Elles ne sont donc visibles par personne. Problème
> d'hygiène de données, pas de sécurité.

### `org_client_counters` et `org_job_counters` — défaut-refus, pas une erreur

Le script les avait marquées « erreur ». La cause réelle :

```
ERROR 42501: permission denied for table org_client_counters
```

`authenticated` n'a **aucun droit** sur ces tables. C'est le défaut-refus qui
fonctionne — le meilleur résultat possible, pas un échec de test.

## 5. Limite de couverture — à ne pas escamoter

**125 tables sur 170 n'ont pas pu être testées de façon concluante**, faute de
contenir des données appartenant à plus d'une organisation. Ce n'est pas un
défaut du protocole mais du **jeu de données** : la production compte 8 354
lignes au total, et l'essentiel de l'activité tient dans une seule organisation.

Ces 125 tables ne sont donc ni « sûres » ni « à risque » : **non mesurées**.
Le test devient concluant dès qu'une deuxième organisation y écrit — il suffit
de rejouer le script.

Par ailleurs, cette campagne teste la **lecture**. Les tentatives d'écriture
cross-org (`UPDATE`/`DELETE` sur la ligne d'un tiers) ne sont pas couvertes ici ;
rappel important pour qui les ajoutera : **une écriture bloquée par la RLS
retourne 0 ligne sans lever d'erreur**, il faut donc vérifier le nombre de
lignes affectées, jamais l'absence d'exception.

## 6. Conclusion

Sur tout ce qui était mesurable en production, **l'isolation multi-tenant en
lecture tient** : 45 tables et 4 vues testées avec des données réelles
d'organisations tierces, aucune ligne ne franchit la frontière. Les trois
alertes initiales se sont toutes révélées être soit un défaut de mon test, soit
une protection fonctionnant comme prévu.

Cela valide le critère 10 de `REMEDIATION.md` **pour la lecture**, dans la
limite de couverture du §5.
