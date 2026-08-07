-- ═══════════════════════════════════════════════════════════════
--  « Contrat signé » — la confirmation qui manquait au client
--
--  Quand un client signait son contrat, il ne recevait rien. L'org
--  avait une notification dans l'app, lui n'avait aucun accusé et
--  aucune copie. Il n'existait tout simplement aucun déclencheur
--  d'automatisation sur la signature.
--
--  Le serveur émet maintenant `agreement.signed` depuis la route de
--  signature publique, et ce preset y répond. Trois variables lui sont
--  propres (server/lib/actions/index.ts → resolveSignedContractVars) :
--    [signed_contract_link] la copie signée
--    [deposit_amount]       le dépôt restant, formaté
--    [deposit_line]         la phrase complète, VIDE si rien n'est dû
--
--  Actif par défaut : c'est la réponse à un geste du client, pas une
--  relance commerciale. Débrayable dans Automatisations comme les autres.
-- ═══════════════════════════════════════════════════════════════

create or replace function public.seed_agreement_signed_preset(p_org_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.automation_rules
    (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  select
    o.id,
    'Contract Signed',
    'Confirm to the client that their contract is signed',
    'agreement.signed',
    '{}'::jsonb,
    0,
    '[{"type":"send_sms","config":{"body":"Merci [client_first_name]! Votre contrat avec [company_name] est signé. Votre copie : [signed_contract_link]\n[deposit_line]"}},
      {"type":"send_email","config":{"subject":"[company_name] — Contrat signé","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Merci [client_first_name],</h2><p>Votre contrat avec [company_name] est signé. Vous pouvez le consulter en tout temps ici :</p><p><a href=\"[signed_contract_link]\">[signed_contract_link]</a></p><p>[deposit_line]</p><p>À bientôt!<br/>[company_name]</p></div>"}}]'::jsonb,
    true,
    true,
    'agreement_signed'
  from public.orgs o
  where p_org_id is null or o.id = p_org_id
  -- L'index unique est PARTIEL (where preset_key is not null) : le ON CONFLICT
  -- doit répéter la même clause, sinon Postgres ne reconnaît pas l'index.
  on conflict (org_id, preset_key) where preset_key is not null do nothing;
end;
$$;

revoke all on function public.seed_agreement_signed_preset(uuid) from public, anon, authenticated;

-- ── Les orgs existantes ──
select public.seed_agreement_signed_preset(null);

-- ── Les orgs à venir : même point d'accroche que les autres patchs ──
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
  perform public.seed_agreement_signed_preset(new.id);
  return new;
exception when others then
  -- Ne jamais bloquer la création d'une org sur un échec de seed.
  raise warning 'seed automations failed for org %: %', new.id, sqlerrm;
  return new;
end;
$$;
