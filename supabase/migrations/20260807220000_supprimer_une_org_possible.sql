-- ═══════════════════════════════════════════════════════════════
--  Rendre la suppression d'une organisation possible
--
--  Il restait un dernier verrou. Le déclencheur d'audit sur
--  `memberships` journalise chaque retrait de membre dans
--  security_events, avec OLD.org_id. Quand on supprime une org, la
--  cascade retire ses memberships → le déclencheur tente d'insérer une
--  ligne qui référence l'org… déjà effacée dans la même instruction.
--  Violation de clé étrangère, suppression impossible.
--
--  Journaliser « membre retiré » pendant l'effacement de l'org entière
--  n'a aucun sens de toute façon : la ligne serait supprimée en
--  cascade l'instant d'après (security_events.org_id est ON DELETE
--  CASCADE). On saute donc l'écriture quand l'org n'existe plus.
--
--  Tous les retraits réels — un membre qu'on retire d'une org vivante —
--  restent journalisés exactement comme avant. Aucune trace perdue.
--
--  Contexte : trouvé en essayant de nettoyer 45 orgs de test le
--  2026-08-07 (voir 20260807200000). Sans ça, personne ne peut honorer
--  une demande d'effacement complet (loi 25, RGPD).
-- ═══════════════════════════════════════════════════════════════

create or replace function public.trg_membership_change_audit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' and old.role != new.role then
    insert into security_events (org_id, user_id, event_type, severity, source, details)
    values (new.org_id, auth.uid(), 'role_change',
      case when new.role = 'owner' then 'high' else 'medium' end, 'auth',
      jsonb_build_object('target_user_id', new.user_id, 'old_role', old.role,
                         'new_role', new.role, 'changed_by', auth.uid()));
  end if;

  if tg_op = 'DELETE' then
    -- Seul ajout : ne journaliser que si l'organisation existe encore.
    -- Sinon on est dans la cascade de sa propre suppression, et la ligne
    -- ne pourrait ni être insérée (clé étrangère) ni survivre (cascade).
    if exists (select 1 from public.orgs where id = old.org_id) then
      insert into security_events (org_id, user_id, event_type, severity, source, details)
      values (old.org_id, auth.uid(), 'member_removed', 'medium', 'auth',
        jsonb_build_object('removed_user_id', old.user_id, 'removed_role', old.role,
                           'removed_by', auth.uid()));
    end if;
    return old;
  end if;

  return new;
end;
$function$;
