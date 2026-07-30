-- ============================================================================
-- N3.7 — Numerotation par tenant : securisation du chemin de repli
-- ============================================================================
-- DEUX CORRECTIONS D'UN CONSTAT D'AUDIT INITIAL :
--
-- 1. « Aucun verrou sur la numerotation » — FAUX pour le chemin principal.
--    invoice_next_number(uuid), appelee par server/lib/invoice-numbering.ts,
--    recurringInvoicesEngine.ts et scheduler.ts, serialise correctement via
--    pg_advisory_xact_lock par org. Verifie en prod : 0 doublon
--    (org_id, invoice_number) sur les lignes vivantes.
--
-- 2. « crm_next_invoice_number est inutilisee, on peut la supprimer » — FAUX.
--    Un garde-fou place dans la premiere version de cette migration a revele
--    qu'elle est appelee par :
--      - crm_invoices_ensure_number()  -> TRIGGER ACTIF sur public.invoices
--      - create_or_get_invoice_from_job(uuid, uuid)
--    La supprimer aurait casse la creation de factures en production.
--
-- LE VRAI PROBLEME est donc plus grave qu'annonce : le fallback `max(...)+1`
-- de crm_next_invoice_number s'execute sur un CHEMIN VIVANT, sans aucun verrou.
-- Deux insertions simultanees sans invoice_number explicite peuvent recevoir le
-- meme numero. Le fallback n'est atteint que si invoice_next_number() renvoie
-- NULL ou vide, ce qui explique l'absence de collision constatee a ce jour.
--
-- CORRECTIF : on ne supprime rien. On rend le fallback sur en le serialisant
-- avec le MEME verrou consultatif que le chemin principal, de sorte que les
-- deux chemins ne puissent jamais attribuer un numero en parallele.
-- ============================================================================

create or replace function public.crm_next_invoice_number(p_org_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_next text;
  v_max_num bigint := 0;
begin
  if p_org_id is null then
    raise exception 'p_org_id is required' using errcode = '22023';
  end if;

  -- N4.6 — L'invariant « lire puis ecrire » exige un verrou explicite.
  -- MEME cle que invoice_next_number() : les deux chemins se serialisent
  -- mutuellement par org. Verrou de transaction : libere au commit/rollback.
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':invoice', 0));

  -- Chemin nominal : la fonction officielle, deja verrouillee et testee.
  if to_regprocedure('public.invoice_next_number(uuid)') is not null then
    execute 'select public.invoice_next_number($1)' into v_next using p_org_id;
    if v_next is not null and btrim(v_next) <> '' then
      return v_next;
    end if;
  end if;

  -- Repli : max + 1, desormais sous verrou (auparavant en lecture sale).
  -- Ne compte que les factures vivantes, coherent avec l'index unique partiel
  -- invoices_org_number_uniq ... where deleted_at is null (20260751100300).
  select coalesce(max(
           case
             when regexp_replace(coalesce(i.invoice_number, ''), '[^0-9]', '', 'g') <> ''
               then regexp_replace(i.invoice_number, '[^0-9]', '', 'g')::bigint
             else 0
           end), 0)
    into v_max_num
    from public.invoices i
   where i.org_id = p_org_id
     and i.deleted_at is null;

  return (v_max_num + 1)::text;
end $$;

comment on function public.crm_next_invoice_number(uuid) is
  'N3.7/N4.6 — Chemin de REPLI appele par le trigger crm_invoices_ensure_number '
  'et par create_or_get_invoice_from_job. Delegue a invoice_next_number() et '
  'partage son verrou consultatif par org. NE PAS supprimer : trigger actif.';

comment on function public.invoice_next_number(uuid) is
  'N3.7 — CHEMIN OFFICIEL de numerotation des factures. Serialise par org via '
  'pg_advisory_xact_lock. Source de verite : invoice_sequences. '
  'Toute nouvelle numerotation DOIT passer par ici.';

comment on function public.claim_next_invoice_number(uuid) is
  'Compteur alternatif (org_invoice_sequences), utilise par les tests de '
  'concurrence. Sur (UPDATE..RETURNING atomique) mais constitue une 2e source '
  'de verite. Ne pas utiliser en production : preferer invoice_next_number().';

-- ----------------------------------------------------------------------------
-- N7.10 — Invariant verifiable : aucun doublon de numero vivant par org.
-- ----------------------------------------------------------------------------
create or replace function public.check_invoice_numbering_invariant()
returns table (org_id uuid, invoice_number text, occurrences bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.org_id, i.invoice_number, count(*)
    from public.invoices i
   where i.deleted_at is null
     and i.invoice_number is not null
   group by i.org_id, i.invoice_number
  having count(*) > 1;
$$;

revoke all on function public.check_invoice_numbering_invariant() from public, anon, authenticated;

comment on function public.check_invoice_numbering_invariant() is
  'N7.10 — Doit retourner 0 ligne. A executer en cron ; toute ligne = collision '
  'de numero de facture dans une org.';
