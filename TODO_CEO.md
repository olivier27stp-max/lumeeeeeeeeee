# TODO CEO — ce qu'il reste à faire pour être 100% légal

**Généré :** 2026-04-21
**Pour :** toi (propriétaire Lume CRM)

Tout ce que je pouvais faire sans toi est fait. Ce qui suit **nécessite une action humaine** (créer un compte, signer un contrat, remplir un nom, activer un toggle).

Cochez au fur et à mesure.

---

## 🔴 BLOQUANT — à faire AVANT d'accepter un client québécois

### 1. Désigner un DPO (5 min)
- [ ] Décider qui : **toi-même** (acceptable pour PME) ou externe
- [ ] Noter le nom dans un endroit public (About page, footer)
- Référence : Loi 25 art. 3.1

### 2. Créer l'email `privacy@lumecrm.ca` (15 min)
- [ ] Option A — Gmail Google Workspace : ~8$/mois, redirige vers ton email principal
- [ ] Option B — Alias sur ton fournisseur de domaine (gratuit)
- [ ] Option C — Zoho Mail gratuit (jusqu'à 5 users)
- [ ] Tester que tu reçois bien les emails

### 3. Créer l'email `legal@lumecrm.ca` (idem, 15 min)
- [ ] Même méthode que #2

### 4. Remplir les placeholders dans les docs (30 min)
Cherche `[COMPANY LEGAL NAME]`, `[STREET ADDRESS]`, `[À DÉSIGNER]`, `[DPO]` dans :
- [ ] `src/pages/Privacy.tsx`
- [ ] `src/pages/Terms.tsx`
- [ ] `docs/legal/privacy_policy.md` (si tu l'utilises)
- [ ] `docs/legal/terms_of_service.md`
- [ ] `docs/legal/dpa_template.md`
- [ ] `docs/legal/breach_response_plan.md`
- [ ] `docs/legal/efvp_supabase_us_east.md`
- [ ] `docs/compliance/ropa.md`
- [ ] `docs/operations/sop_dsr_response.md`

Astuce : VS Code → Ctrl+Shift+F (recherche globale) → `[COMPANY LEGAL NAME]` → remplacer par le vrai nom.

### 5. Activer `pg_cron` dans Supabase (1 min)
- [ ] https://supabase.com/dashboard → ton projet → Database → Extensions
- [ ] Chercher `pg_cron` → Enable
- [ ] Sans ça, les purges auto (rétention, failed_logins, audit_events) NE TOURNENT PAS

### 6. Tester `run_retention_job()` (1 min)
Dans SQL Editor :
```sql
select public.run_retention_job();
```
Doit renvoyer un JSON avec 6 compteurs (tous à 0 si DB vide = normal).

### 7. Pousser la migration email consent (2 min)
Contenu dans `supabase/migrations/20260625000005_email_consent.sql`. Colle dans SQL Editor :

```
alter table public.clients
  add column if not exists email_consent_at      timestamptz,
  add column if not exists email_opt_out_at      timestamptz,
  add column if not exists email_opt_out_reason  text;

alter table public.leads
  add column if not exists email_consent_at      timestamptz,
  add column if not exists email_opt_out_at      timestamptz,
  add column if not exists email_opt_out_reason  text;

create table if not exists public.email_opt_outs (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid references public.orgs(id) on delete cascade,
  email          text not null,
  opted_out_at   timestamptz not null default now(),
  reason         text,
  unique (org_id, email)
);

create index if not exists idx_email_opt_outs_email on public.email_opt_outs(email);
alter table public.email_opt_outs enable row level security;

drop policy if exists email_opt_outs_service on public.email_opt_outs;
create policy email_opt_outs_service on public.email_opt_outs for all to service_role using (true) with check (true);

drop policy if exists email_opt_outs_select_org on public.email_opt_outs;
create policy email_opt_outs_select_org on public.email_opt_outs for select
  using (org_id is null or public.has_org_membership(auth.uid(), org_id));

create or replace function public.record_email_opt_out(
  p_email text, p_org_id uuid default null, p_reason text default null
) returns void language sql security definer set search_path = public, pg_temp as $FUNC$
  insert into public.email_opt_outs(org_id, email, reason)
  values (p_org_id, lower(trim(p_email)), p_reason)
  on conflict (org_id, email) do update set opted_out_at = now(), reason = excluded.reason;
  update public.clients set email_opt_out_at = now(), email_opt_out_reason = p_reason
   where lower(email) = lower(trim(p_email)) and (p_org_id is null or org_id = p_org_id);
  update public.leads set email_opt_out_at = now(), email_opt_out_reason = p_reason
   where lower(email) = lower(trim(p_email)) and (p_org_id is null or org_id = p_org_id);
$FUNC$;
revoke all on function public.record_email_opt_out(text, uuid, text) from public;
grant execute on function public.record_email_opt_out(text, uuid, text) to authenticated, service_role;

create or replace function public.is_email_opted_out(p_email text, p_org_id uuid default null)
returns boolean language sql stable security definer set search_path = public, pg_temp as $FUNC$
  select exists (select 1 from public.email_opt_outs
     where email = lower(trim(p_email))
       and (p_org_id is null or org_id = p_org_id or org_id is null));
$FUNC$;
revoke all on function public.is_email_opted_out(text, uuid) from public;
grant execute on function public.is_email_opted_out(text, uuid) to authenticated, service_role;
```

---

## 🟠 À FAIRE DANS LA SEMAINE

### 8. Rédiger l'EFVP (2-4h)
- [ ] Ouvrir `docs/legal/efvp_supabase_us_east.md`
- [ ] Remplir toutes les sections entre `[crochets]`
- [ ] Trancher §9 : rester sur US-East OU migrer vers `ca-central-1`
- [ ] Signer §10
- [ ] **Conserver** ce document — à produire sur demande de la CAI

### 9. Installer Sentry (20 min)
- [ ] Suivre `docs/operations/sentry_setup.md`
- [ ] Créer compte sentry.io (gratuit 5k events/mois)
- [ ] Créer 2 projets : `lume-frontend` (React) + `lume-backend` (Node.js)
- [ ] Copier les 2 DSN dans `.env.local` (SENTRY_DSN + VITE_SENTRY_DSN)
- [ ] `npm install @sentry/react @sentry/node`
- [ ] Déployer et vérifier qu'une erreur apparaît dans le dashboard Sentry

### 10. Valider les templates par un avocat (3-5k CAD)
- [ ] Trouver un avocat spécialisé droit du numérique (QC : Fasken, BCF, BLG, De Grandpré Chait, Miller Thomson)
- [ ] Lui envoyer tous les `.md` sous `docs/legal/`
- [ ] Lui envoyer `compliance_audit.md`
- [ ] Demander revue + modifications
- [ ] Après validation : publier les pages `/privacy`, `/terms`, `/subprocessors`

### 11. Documenter astreinte 24/7 (30 min)
- [ ] Créer un Google Doc privé : « Astreinte incident Lume »
- [ ] Inscrire : qui répond (toi au début), numéro perso, email, protocole
- [ ] Référencer dans `docs/legal/breach_response_plan.md §2`

### 12. Révoquer ton token Supabase (10 sec)
- [ ] https://supabase.com/dashboard/account/tokens
- [ ] Trouver `sbp_059348...` → Revoke

---

## 🟡 À FAIRE DANS LE MOIS

### 13. Test restore backup (1h, mensuel ensuite)
- [ ] Supabase → Database → Backups
- [ ] Tester une restauration dans un projet sandbox
- [ ] Documenter la date du test (RGPD art. 32 "résilience")

### 14. CSP production sans `unsafe-inline`
- [ ] Chercher `unsafe-inline` dans `server/index.ts`
- [ ] Bouger les scripts inline vers des fichiers séparés ou utiliser nonces
- [ ] Optionnel mais recommandé (défense XSS)

### 15. ProfitWell Metrics (10 min, optionnel)
- [ ] https://www.profitwell.com/ — compte gratuit
- [ ] Connecter ton Stripe
- [ ] Tu auras MRR / churn / LTV auto

### 16. UptimeRobot (5 min, optionnel)
- [ ] https://uptimerobot.com — compte gratuit
- [ ] Monitor sur ton domaine principal → alerte email si down
- [ ] Monitor aussi sur `/api/health`

---

## Vérification finale avant d'accepter un vrai client payant

Quand les items 1-7 sont cochés, tu peux lancer en version beta.
Quand 1-12 sont cochés, tu es prêt pour la GA (production publique).

Référence complète : `compliance_checklist.md`.

---

## Fichiers utiles

| Pour savoir... | Lis... |
|---|---|
| Ce qui a été livré et pourquoi | `compliance_audit.md` |
| Comment répondre à une demande DSAR | `docs/operations/sop_dsr_response.md` |
| Comment réagir à un incident | `docs/legal/breach_response_plan.md` |
| Point d'entrée équipe | `COMPLIANCE_README.md` |
| Checklist détaillée pré-prod | `compliance_checklist.md` |
