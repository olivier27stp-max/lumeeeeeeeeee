-- Hygiène sécurité : fixer search_path sur les 2 dernières fonctions qui ne
-- l'avaient pas (advisor function_search_path_mutable). SECURITY INVOKER
-- toutes deux (faible risque), mais un search_path figé évite qu'un schéma
-- temporaire malicieux détourne un appel de fonction non qualifié.
-- ALTER ... SET search_path ne touche pas le corps de la fonction.

alter function public.job_agreements_enforce_job_only() set search_path = public;
alter function public.normalize_phone_digits(text) set search_path = public;
