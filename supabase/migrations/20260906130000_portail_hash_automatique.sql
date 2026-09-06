-- ═══════════════════════════════════════════════════════════════
-- Le hash du jeton de portail se calcule tout seul.
--
-- CONSTAT DU 2026-09-06 (staging, page publique ouverte sans session)
-- Le portail client répondait « Portal unavailable » pour un client
-- fraîchement créé. Cause : l'interface construit le lien avec
-- `clients.portal_token` (rempli par défaut, gen_random_uuid), mais le
-- serveur ne cherche QUE par `portal_token_hash` (audit 2026-07-31, qui
-- a retiré le repli par jeton en clair). Or plus rien ne remplit ce
-- hash : le seul écrivain était le remplissage unique de juillet
-- (20260751103200). Depuis, chaque nouveau client reçoit un jeton sans
-- hash — un lien mort, copié tel quel dans le courriel.
--
-- En prod : 46 clients avec jeton, 3 sans hash (tous créés après le
-- 31 juillet), 43 hash conformes à la formule, 0 non conforme.
--
-- LE CORRECTIF
-- Un trigger BEFORE INSERT OR UPDATE OF portal_token sur clients pose
-- `portal_token_hash = encode(sha256(portal_token), 'hex')` — la formule
-- exacte du serveur (`crypto.createHash('sha256').update(token)`) et du
-- remplissage de juillet. Puis on rattrape les 3 (et ceux de staging).
--
-- Révoquer/faire tourner un jeton continue de fonctionner : changer
-- portal_token recalcule le hash ; le mettre à null vide le hash.
-- ═══════════════════════════════════════════════════════════════

begin;

create or replace function public.clients_portal_token_hash()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.portal_token is null then
    new.portal_token_hash := null;
  elsif tg_op = 'INSERT'
     or new.portal_token_hash is null
     or new.portal_token is distinct from old.portal_token then
    new.portal_token_hash := encode(sha256(convert_to(new.portal_token, 'UTF8')), 'hex');
  end if;
  return new;
end $$;

drop trigger if exists trg_clients_portal_token_hash on public.clients;
create trigger trg_clients_portal_token_hash
  before insert or update of portal_token on public.clients
  for each row execute function public.clients_portal_token_hash();

-- Rattrapage : les clients dont le jeton n'a jamais eu de hash.
update public.clients
   set portal_token_hash = encode(sha256(convert_to(portal_token, 'UTF8')), 'hex')
 where portal_token is not null
   and portal_token_hash is null;

commit;
