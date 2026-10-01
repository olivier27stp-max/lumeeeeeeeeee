-- Audit commissions 2026-09-30 — approuvée par Rafba le 2026-09-30 (« enlever les démos »).
--
-- Met à la CORBEILLE (suppression douce, deleted_at) les 27 commissions de démonstration
-- de « Coquin lavage » : juillet 2026, sans facture ni job, sur « [DEMO] Commission 10% ».
-- Total : 7156 $. Aucune vraie commission n'est touchée (garde : invoice_id et
-- job_id nuls, org et ids explicites). Sauvegarde avant : prod-20261001-0010.dump.
--
-- Retour arrière :
--   update public.fs_commission_entries set deleted_at = null
--    where org_id = '4d885f6c-e076-4ed9-ab09-23637dbee6cd' and id in (<mêmes ids>);
begin;
update public.fs_commission_entries
   set deleted_at = now(), updated_at = now()
 where org_id = '4d885f6c-e076-4ed9-ab09-23637dbee6cd'
   and invoice_id is null and job_id is null and deleted_at is null
   and id in (
  '683b492f-9ba6-465b-a96a-e4cd3f1a6655',
  '41797476-33e1-4fb1-948c-0c4015d85bcc',
  'ba542e17-ec03-41fd-a58e-343c28c5f9dd',
  '508beabd-3638-4035-9fd8-cd0958550ed7',
  '87928a63-2d1b-46cd-a95a-2a5c247f8279',
  '06ed7f4f-30f4-4426-872d-683fe976dcc8',
  'abe92dbd-f05b-4b07-a96f-fd10f9e4eb4e',
  'ac929ed8-c923-4e68-a064-117a4238dfb4',
  '9938c3ba-5786-425f-80c9-0db1edc50661',
  '39c1cccb-2ec6-4057-907a-66bda2997950',
  '30800d77-b441-44f2-b3df-54722d033bc9',
  '21af0510-a2d2-4afe-9b11-f5859cada739',
  '91b262e5-41e0-48f8-ae64-38254fc415bc',
  'b73bb139-f07f-43dc-9597-cb7b9fc14e37',
  '69668695-8296-4cb3-b87b-2e97bb0047c9',
  'a2926ea5-1d97-41bb-acb5-8f41331a24a1',
  '5ea2bff5-2435-41be-9d23-fd3114027cf1',
  'f85988d4-e492-4a44-94ff-61ba3766b10e',
  '86fcf154-7fa7-45f3-a773-73fd40d23a39',
  '2c8fc91e-fca2-402c-835a-3fad17ce12f4',
  'bc58762c-ad28-4d27-a0c0-9a11b400634b',
  '71c72441-dd1b-4aab-95f6-f35dead0a644',
  '58d016e7-6dfd-41da-8e57-5fabbc3301a6',
  'f3ad77aa-e05f-4fa9-91e6-5911a3c26a50',
  'ab26bc0b-e1ad-4143-9a1d-83a94ad2bedc',
  '3ec8f6b9-fc23-4615-8d8b-cbf8d2c66ed9',
  '412eaded-6bfd-4707-9746-8ca9456d90d1'
   );
commit;
