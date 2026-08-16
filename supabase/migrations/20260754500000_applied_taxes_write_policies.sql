-- applied_taxes : policies d'écriture manquantes depuis la création de la RLS.
--
-- InvoiceEdit écrit la ventilation des taxes (delete + insert) côté client,
-- mais la table n'avait qu'une policy SELECT : le DELETE était un no-op
-- silencieux et l'INSERT un 42501 jamais lu. Conséquence : applied_taxes
-- toujours vide → factures et PDF sans ventilation TPS/TVQ ni numéros
-- d'enregistrement (exigence fiscale QC).
--
-- Écriture scopée par le document parent (la table n'a pas d'org_id),
-- calquée sur la policy de lecture applied_taxes_tenant_read.

drop policy if exists applied_taxes_tenant_insert on public.applied_taxes;
create policy applied_taxes_tenant_insert on public.applied_taxes
  for insert to authenticated
  with check (
    ((document_type = 'invoice') and exists (
      select 1 from public.invoices i
      where i.id = applied_taxes.document_id
        and i.org_id = (select current_org_id())
    ))
    or
    ((document_type = 'quote') and exists (
      select 1 from public.quotes q
      where q.id = applied_taxes.document_id
        and q.org_id = (select current_org_id())
    ))
  );

drop policy if exists applied_taxes_tenant_delete on public.applied_taxes;
create policy applied_taxes_tenant_delete on public.applied_taxes
  for delete to authenticated
  using (
    ((document_type = 'invoice') and exists (
      select 1 from public.invoices i
      where i.id = applied_taxes.document_id
        and i.org_id = (select current_org_id())
    ))
    or
    ((document_type = 'quote') and exists (
      select 1 from public.quotes q
      where q.id = applied_taxes.document_id
        and q.org_id = (select current_org_id())
    ))
  );
