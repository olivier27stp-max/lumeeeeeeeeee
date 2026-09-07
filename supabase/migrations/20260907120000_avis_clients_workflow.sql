-- Workflow « Avis clients » : job terminée → sondage d'étoiles immédiat →
-- 1-3 étoiles = formulaire de commentaires interne, 4-5 étoiles = redirection
-- vers Google / Facebook avec un message d'invitation.
--
-- 1. Réglages : lien Facebook + message d'invitation, à côté du lien Google
--    déjà présent (google_review_url, review_enabled).
alter table public.company_settings
  add column if not exists facebook_review_url text default null,
  add column if not exists review_invite_message text default null;

comment on column public.company_settings.facebook_review_url is
  'Page Facebook (onglet Avis) vers laquelle un client satisfait (4-5 étoiles) est redirigé.';
comment on column public.company_settings.review_invite_message is
  'Message affiché au client satisfait avant la redirection vers Google/Facebook. NULL = texte par défaut de l''app.';

-- 2. Sondage en deux temps : la note d'abord, le commentaire ensuite (note
--    basse seulement). La tâche de suivi est créée dès la note ; on garde son
--    id pour y ajouter le commentaire quand il arrive.
alter table public.satisfaction_surveys
  add column if not exists feedback_submitted_at timestamptz default null,
  add column if not exists followup_task_id uuid references public.tasks(id) on delete set null;

-- 3. Le sondage part immédiatement à la fin de la job (était : 2 h après).
--    Seules les règles encore sur la valeur du seed (7200) sont touchées : un
--    délai personnalisé par l'entreprise est conservé.
update public.automation_rules
set delay_seconds = 0,
    name = 'Sondage d''avis — dès la fin de la job',
    description = 'Envoie le sondage d''étoiles (courriel + SMS) dès que la job est marquée terminée'
where preset_key = 'google_review'
  and delay_seconds = 7200;
