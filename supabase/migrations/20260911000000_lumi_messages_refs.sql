-- Lumi : les références courtes (ref3 → UUID) que l'assistant utilise pour
-- désigner un client, un devis, un job vivaient uniquement en mémoire du
-- serveur. Un redéploiement les effaçait et une action confirmée juste après
-- échouait (« Quote not found », prod 2026-09-10). L'instantané du mapping
-- est maintenant sauvé avec le dernier message de chaque tour et rejoué au
-- chargement de la conversation. Jamais montré au modèle.
alter table public.lumi_messages
  add column if not exists refs jsonb;

comment on column public.lumi_messages.refs is
  'Instantané réf courte → UUID (voir server/lib/agent/refs.ts), rejoué au chargement de la conversation. Interface/serveur seulement, jamais envoyé au modèle.';
