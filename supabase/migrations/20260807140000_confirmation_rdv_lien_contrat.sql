-- ═══════════════════════════════════════════════════════════════
--  Le lien du contrat dans la confirmation de rendez-vous
--
--  La confirmation de rendez-vous (preset appointment_confirmation)
--  annonçait la date et l'heure, mais pas le contrat à signer : il
--  fallait un second message pour l'envoyer, et la plupart du temps
--  personne ne l'envoyait. Le client confirmait un rendez-vous sans
--  jamais voir le document.
--
--  Le moteur d'automatisation expose maintenant trois variables
--  (server/lib/actions/index.ts → resolveContractVars) :
--    [contract_line]  la phrase complète pour un SMS
--    [contract_html]  le paragraphe équivalent pour un courriel
--    [contract_link]  l'URL nue
--  Toutes vides quand la job n'a pas de contrat en attente de
--  signature — un gabarit qui les contient ne laisse donc pas de trou.
--
--  Cette migration les ajoute aux gabarits déjà semés (toutes les orgs)
--  et branche le même patch sur la création d'une org, comme le fait
--  déjà apply_automation_presets_fr.
-- ═══════════════════════════════════════════════════════════════

-- ── Le patch, idempotent : ne réécrit pas un gabarit qui l'a déjà ──
create or replace function public.apply_appointment_contract_link(p_org_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.automation_rules ar
  set actions = (
    select jsonb_agg(a order by ord)
    from (
      select
        case
          when e->>'type' = 'send_sms'
           and coalesce(e->'config'->>'body', '') <> ''
           and position('[contract_' in (e->'config'->>'body')) = 0
          then jsonb_set(e, '{config,body}',
                 to_jsonb((e->'config'->>'body') || E'\n[contract_line]'))
          when e->>'type' = 'send_email'
           and coalesce(e->'config'->>'body', '') <> ''
           and position('[contract_' in (e->'config'->>'body')) = 0
          then jsonb_set(e, '{config,body}',
                 to_jsonb(
                   -- Glissé à l'intérieur du <div> du gabarit quand il y en a
                   -- un, sinon simplement ajouté à la fin.
                   case
                     when (e->'config'->>'body') ~ '</div>\s*$'
                     then regexp_replace(e->'config'->>'body',
                            '</div>(\s*)$', '[contract_html]</div>\1')
                     else (e->'config'->>'body') || '[contract_html]'
                   end))
          else e
        end as a,
        ord
      from jsonb_array_elements(ar.actions) with ordinality as t(e, ord)
    ) s
  )
  where ar.preset_key = 'appointment_confirmation'
    and jsonb_typeof(ar.actions) = 'array'
    and (p_org_id is null or ar.org_id = p_org_id);
end;
$$;

revoke all on function public.apply_appointment_contract_link(uuid) from public, anon, authenticated;

-- ── Les orgs existantes ──
select public.apply_appointment_contract_link(null);

-- ── Les orgs à venir : même point d'accroche que le patch FR ──
create or replace function public.handle_org_created_seed_automations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_automation_presets(new.id);
  perform public.apply_automation_presets_fr(new.id);
  perform public.apply_appointment_contract_link(new.id);
  return new;
exception when others then
  -- Ne jamais bloquer la création d'une org sur un échec de seed.
  raise warning 'seed automations failed for org %: %', new.id, sqlerrm;
  return new;
end;
$$;
