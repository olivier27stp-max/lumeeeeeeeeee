-- Paiement manuel (« Marquer payée ») : numéro de référence + détails libres.
-- Les deux sont facultatifs. Le code client tolère leur absence tant que cette
-- migration n'est pas appliquée (réinsertion sans ces colonnes).
alter table public.payments add column if not exists reference text;
alter table public.payments add column if not exists notes text;
