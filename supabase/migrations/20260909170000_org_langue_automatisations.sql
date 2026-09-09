-- Langue des messages d'automatisation, par organisation.
-- Les 35 presets étaient écrits en français en dur : une PME anglophone
-- envoyait du français à ses clients sans le savoir. On stocke une langue par
-- org ; le moteur choisit la version FR ou EN du message à l'envoi. Défaut
-- 'fr' (marché initial Québec) — aucune org existante ne change de
-- comportement tant qu'elle ne bascule pas explicitement.
alter table public.company_settings
  add column if not exists default_language text not null default 'fr'
    check (default_language in ('fr', 'en'));

comment on column public.company_settings.default_language is
  'Langue des communications automatiques (SMS/courriels d''automatisation) envoyées aux clients de cette org : ''fr'' ou ''en''. Le moteur d''automatisation sélectionne la version correspondante du message.';
