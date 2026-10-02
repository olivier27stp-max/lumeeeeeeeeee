-- M-01 (agent M, PROPOSÉE — non appliquée hors de la pile locale)
-- Point 10 de la mission : activer une automatisation n'a pas d'effet rétroactif.
--
-- Le moteur a besoin de savoir DEPUIS QUAND une règle est active, pour ignorer
-- ce qui était déjà dormant / inactif avant (« Opportunité qui dort »,
-- « Client inactif ») et ne rattraper un balayage manqué de « Date atteinte »
-- que pour les jours où la règle tournait déjà.
--
-- Aucune colonne existante ne le dit : `updated_at` est réécrit à CHAQUE
-- modification (renommage, message, conversation Lumi enregistrée sur la
-- règle). Le moteur s'en sert comme repli tant que cette migration n'est pas
-- appliquée (server/lib/automations-activation.ts) : jamais d'effet rétroactif,
-- mais un cas franchi entre l'activation et une modification est ignoré.
--
-- La date est écrite PAR LA BASE, quel que soit le chemin qui publie (éditeur,
-- liste, Lumi, préréglages semés, copie vers un autre bureau) : cinq chemins
-- écrivent `is_active`, un seul trigger les couvre tous.
--
-- Non destructive : une colonne nullable, un trigger. Aucune donnée retirée.

BEGIN;

ALTER TABLE public.automation_rules
  ADD COLUMN IF NOT EXISTS activee_le timestamptz;

COMMENT ON COLUMN public.automation_rules.activee_le IS
  'Dernier passage de is_active à vrai (écrit par trigger). Le moteur ignore les cas déjà dans l''état visé avant cette date (activation sans effet rétroactif).';

CREATE OR REPLACE FUNCTION public.automation_rules_dater_activation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
begin
  if tg_op = 'INSERT' then
    if new.is_active and new.activee_le is null then
      new.activee_le := now();
    end if;
  elsif new.is_active and not old.is_active then
    -- Republier après un passage en brouillon : on repart de maintenant.
    new.activee_le := now();
  end if;
  return new;
end;
$$;

-- Une fonction de trigger n'a pas à être appelable par l'API : sans ce REVOKE elle garde l'ACL
-- par défaut de Supabase (anon et authenticated ont EXECUTE). Revue du coordinateur, 2026-10-02.
REVOKE ALL ON FUNCTION public.automation_rules_dater_activation() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_automation_rules_dater_activation ON public.automation_rules;
CREATE TRIGGER trg_automation_rules_dater_activation
  BEFORE INSERT OR UPDATE OF is_active ON public.automation_rules
  FOR EACH ROW EXECUTE FUNCTION public.automation_rules_dater_activation();

-- Reprise de l'existant : la meilleure date connue d'une règle déjà active est
-- sa dernière modification (toute publication la réécrit). Le trigger
-- `updated_at` est coupé le temps de la reprise : sinon toutes les règles
-- actives afficheraient « modifiée aujourd'hui ».
ALTER TABLE public.automation_rules DISABLE TRIGGER trg_automation_rules_updated;
UPDATE public.automation_rules
   SET activee_le = updated_at
 WHERE is_active AND activee_le IS NULL;
ALTER TABLE public.automation_rules ENABLE TRIGGER trg_automation_rules_updated;

COMMIT;
