# Registre des incidents de confidentialité — Loi 25, art. 3.8

**Version :** `registre-2026-08-30`
**Dernière mise à jour :** 2026-08-30
**Responsable :** William Hébert (RPRP / DPO) — willhebert30@gmail.com

## 1. Où vit le registre

Le registre officiel est la table **`public.security_incidents`** en production
(voir `docs/legal/breach_response_plan.md`, qui définit le workflow de
détection → triage → notification). Chaque incident de confidentialité au sens
de la Loi 25 y est consigné avec : date de détection, nature
(`incident_type`, `description`), catégories de RP touchés (`data_categories`),
nombre de personnes concernées (`affected_users`, `affected_records`),
évaluation du risque de préjudice sérieux (`risk_serious`, `risk_rationale`),
mesures prises (`containment_actions`, `root_cause`), et avis transmis
(`cai_notified_at`, `affected_notified_at`, `notification_method`).

Le registre est conservé **au moins 5 ans** après la date de connaissance de
chaque incident (délai réglementaire) et peut être produit sur demande de la
CAI :

```sql
select detected_at, incident_type, title, description, data_categories,
       affected_users, affected_records, risk_serious, risk_rationale,
       containment_actions, cai_notified_at, affected_notified_at
  from public.security_incidents
 order by detected_at desc;
```

## 2. État du registre

| Date | Nature | RP touchés | Personnes concernées | Mesures prises | Avis CAI |
|---|---|---|---|---|---|
| — | *Aucun incident de confidentialité à ce jour.* | — | — | — | — |

Un registre vide est un état légitime : les événements de sécurité **bloqués
sans exposition de RP** ne sont pas des incidents de confidentialité (art. 3.6)
et sont consignés en annexe ci-dessous plutôt que dans le registre.

## 3. Annexe — analyses d'événements de sécurité (non-incidents)

Trace écrite des triages conclus « tentative bloquée, aucune donnée exposée ».
Les événements bruts restent dans `public.security_events`.

### 2026-08-30 — Triage des 6 `sql_injection_attempt` du 2026-08-25

- **Événements :** 6 événements `critical` du 2026-08-25 17:22 UTC
  (IPs 152.233.23.193 / .194), plus les vagues identiques des 2026-08-12 et
  2026-08-16 (même plage 152.233.0.0/16).
- **Nature :** scanner WordPress automatisé (signature `wp2sprobe`) visant des
  endpoints `/wp/v2/posts` et `/wp/v2/widgets` avec des payloads d'injection
  sur le paramètre `author_exclude`. Lume n'est pas un WordPress : ces
  endpoints n'existent pas.
- **Comportement du système :** chaque requête a été interceptée par le
  middleware de sanitisation (`server/lib/security.ts`,
  `containsSQLInjection`) et rejetée en **HTTP 400 avant toute requête à la
  base**. Les accès aux données passent par Supabase en requêtes paramétrées ;
  l'IP source a été auto-bloquée 60 minutes (`autoBlockIP`).
- **Conclusion : tentative bloquée, aucune donnée exposée.** Aucun
  renseignement personnel consulté, communiqué ou perdu → pas d'incident de
  confidentialité au sens de l'art. 3.6, pas d'inscription au registre, pas
  d'avis à la CAI ni aux personnes concernées.
- **Suivi :** les événements restent dans `security_events` ; pour les marquer
  triés :

  ```sql
  update public.security_events
     set resolved = true, resolved_at = now()
   where event_type = 'sql_injection_attempt' and resolved = false;
  ```

### 2026-08-30 — Triage du `db_invariant_failure` quotidien (sonde `rls_coverage`)

- **Événements :** un événement `high` par nuit depuis la mise en service de la
  sonde (`run_invariant_checks()`), signalant 4 tables : `job_time_logs`,
  `job_materials`, `client_payment_profiles`, `cron_locks`.
- **Analyse :** vérification directe en prod (2026-08-30) — les 3 premières
  tables ont RLS **activée avec policies** (accès anonyme refusé) ; seul le
  `FORCE ROW LEVEL SECURITY` manquait, ce qui ne concerne que le propriétaire
  de la table (qui a `bypassrls` sur cette instance). `cron_locks` est en
  deny-all sans policy (voulu — accès via fonctions SECURITY DEFINER
  seulement) et ne contient aucun RP.
- **Conclusion : dérive d'hygiène, aucune donnée exposée.** Pas un incident de
  confidentialité.
- **Mesure corrective :** migration
  `20260830000000_rls_force_et_cron_locks_deny_all.sql` (force RLS sur les 4
  tables + commentaire deny-all sur `cron_locks`), qui éteint l'alerte
  quotidienne.
