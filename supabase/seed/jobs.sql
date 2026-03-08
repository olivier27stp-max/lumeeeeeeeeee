insert into public.jobs (
  org_id,
  title,
  client_name,
  property_address,
  scheduled_at,
  status,
  total_cents,
  currency,
  job_type,
  notes
)
values
  (auth.uid(), 'Window cleaning', 'Annie Beauregard', '14 Impasse Belmont, Granby, Quebec J2H 1T7', now() - interval '5 days', 'Late', 8500, 'USD', 'Cleaning', 'Client requested exterior only.'),
  (auth.uid(), 'Gutter service', 'Plomberie Guy Martel', '2865 Boulevard Lemire, Drummondville, Quebec J2B 7M2', now() + interval '12 days', 'Action Required', 20500, 'USD', 'Maintenance', null),
  (auth.uid(), 'Exterior wash', 'Marylene Pare', '115 Rue Fernet Saint-Nicéphore, Drummondville, Quebec J2A 1R8', now() + interval '25 days', 'Requires Invoicing', 17000, 'USD', 'Pressure Wash', null),
  (auth.uid(), 'Seasonal inspection', null, '90 Rue Jetté, Trois-Rivières, Quebec', null, 'Unscheduled', 0, 'USD', 'Inspection', 'Awaiting client confirmation.');
