-- ── Expand invoice template layout types ──────────────────────
-- Allow bold, executive, contractor in addition to classic, modern, minimal

alter table invoice_templates
  drop constraint if exists chk_tpl_layout_type;

alter table invoice_templates
  add constraint chk_tpl_layout_type
  check (layout_type in ('classic','modern','minimal','bold','executive','contractor'));

-- Insert system templates for new layouts (if not already present)
insert into invoice_templates (id, org_id, created_by, name, title, description, line_items, taxes, payment_terms, client_note, branding, payment_methods, email_subject, email_body, is_default, layout_type)
select
  gen_random_uuid(), '00000000-0000-0000-0000-000000000000', null,
  v.name, 'Invoice', v.description, '[]'::jsonb, '[]'::jsonb, '', '', '{}'::jsonb, '{}'::jsonb, '', '', false, v.layout_type
from (values
  ('Bold',       'Dark sidebar, high-impact layout',    'bold'),
  ('Executive',  'Elegant serif with gold accents',     'executive'),
  ('Contractor', 'High-contrast with large totals',     'contractor')
) as v(name, description, layout_type)
where not exists (
  select 1 from invoice_templates t where t.layout_type = v.layout_type and t.org_id = '00000000-0000-0000-0000-000000000000'
);
