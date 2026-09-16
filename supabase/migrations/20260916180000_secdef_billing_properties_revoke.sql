-- Deux fonctions de trigger SECURITY DEFINER (20260915000000_billing_properties.sql)
-- sont exécutables par anon et authenticated : le test d'isolation RLS de la CI
-- (scripts/test-rls-isolation.ts) les signale comme fuites depuis le 2026-09-16
-- (« ANON can execute SECURITY DEFINER properties_billing_mirror_to_client() /
-- clients_auto_billing_property() »), ce qui rend la CI de main rouge.
--
-- Ce sont des fonctions `returns trigger` : un trigger s'exécute quel que soit
-- le droit EXECUTE du rôle courant, donc révoquer ne change rien à l'app.
-- Règle du projet (secdef moindre privilège) : révoquer anon et authenticated
-- NOMMÉMENT — revoke à PUBLIC ne suffit pas avec les defaults Supabase.
--
-- NON APPLIQUÉE : staging puis prod après approbation.

begin;

revoke execute on function public.properties_billing_mirror_to_client() from public, anon, authenticated;
revoke execute on function public.clients_auto_billing_property() from public, anon, authenticated;

commit;
