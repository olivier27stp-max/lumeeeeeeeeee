-- ═══════════════════════════════════════════════════════════════
-- Loi 25 — purger l'IP et le navigateur en clair des vues de documents
--
-- `quote_views` gardait l'adresse IP et le navigateur complet de chaque
-- client qui ouvrait un devis ou une facture. Rien dans l'app ne s'en sert :
-- ni l'affichage, ni les automatisations, ni les rapports (vérifié par grep
-- le 2026-09-28 — seules les deux routes d'écriture y touchaient). La Loi 25
-- exige de ne garder que le nécessaire : on garde QUE la vue a eu lieu, et
-- quand ; plus QUI par son IP.
--
-- Décidé par Rafba le 2026-09-28 (« occupe-toi en »). Les nouvelles lignes
-- n'en portent déjà plus (20260929210000 + routes des factures).
--
-- ⚠ IRRÉVERSIBLE par nature : une IP effacée ne se reconstitue pas. C'est le
-- but. Les lignes elles-mêmes sont GARDÉES (compteurs et historique des vues
-- intacts). L'org_id manquant est rempli depuis le document.
-- ═══════════════════════════════════════════════════════════════

begin;

update public.quote_views v
set org_id = coalesce(v.org_id, q.org_id)
from public.quotes q
where v.quote_id = q.id and v.org_id is null;

update public.quote_views v
set org_id = coalesce(v.org_id, i.org_id)
from public.invoices i
where v.invoice_id = i.id and v.org_id is null;

update public.quote_views
set ip_address = null, user_agent = null
where ip_address is not null or user_agent is not null;

commit;
