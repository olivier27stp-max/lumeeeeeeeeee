-- Avis clients : tous les textes envoyés/affichés au client deviennent
-- personnalisables (NULL = texte par défaut de l'app, server/lib/reviews.ts).
alter table public.company_settings
  add column if not exists review_sms_body text default null,
  add column if not exists review_email_subject text default null,
  add column if not exists review_email_body text default null,
  add column if not exists review_survey_question text default null,
  add column if not exists review_low_rating_message text default null,
  add column if not exists review_thank_you_message text default null;

comment on column public.company_settings.review_sms_body is 'SMS envoyé avec le lien du sondage. Variables [client_first_name] [client_name] [company_name] [job_name] [survey_url].';
comment on column public.company_settings.review_email_subject is 'Objet du courriel du sondage (mêmes variables).';
comment on column public.company_settings.review_email_body is 'Corps du courriel du sondage, texte brut ; [survey_url] devient un bouton, ajouté à la fin s''il est absent.';
comment on column public.company_settings.review_survey_question is 'Question affichée au-dessus des étoiles sur /survey/:token.';
comment on column public.company_settings.review_low_rating_message is 'Message affiché au client qui note 4 étoiles ou moins, au-dessus du formulaire de commentaires.';
comment on column public.company_settings.review_thank_you_message is 'Message de remerciement après l''envoi des commentaires.';
