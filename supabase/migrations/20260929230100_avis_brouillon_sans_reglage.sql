-- Les demandes d'avis en brouillon tant que l'entreprise ne les a pas activées.
-- ─────────────────────────────────────────────────────────────────────────────
-- Le préréglage « Demander un avis » (google_review) naît PUBLIÉ — le trigger
-- seed_automation_presets l'insère actif —, alors que
-- company_settings.review_enabled vaut FAUX par défaut et qu'aucun lien Google
-- n'est saisi. L'action request_review refuse alors d'envoyer (« Review
-- requests are disabled ») : chaque job terminée produit un échec, et
-- l'entrepreneur croit que ses demandes d'avis partent.
--
-- Mesuré en prod le 2026-09-28 : une seule vraie entreprise touchée (Vision
-- Lavage : règle publiée, avis désactivés, aucun lien), plus les bureaux de
-- test. Coquin lavage, qui a activé les avis avec un lien, n'est PAS touchée.
--
-- Le code fait désormais le lien dans les deux sens (automationPresetSeeder.ts
-- à la création, SettingsReviews.tsx quand on bascule l'interrupteur). Cette
-- migration remet l'existant d'aplomb : règles d'avis en brouillon là où les
-- avis ne sont pas activés. Activer les avis dans Paramètres › Avis clients
-- republie la demande.
--
-- Données seulement, aucun changement de schéma. Idempotente.

update public.automation_rules r
   set is_active = false,
       updated_at = now()
 where r.preset_key in ('google_review', 'review_reminder_7d')
   and r.is_active
   and r.deleted_at is null
   and not exists (
     select 1 from public.company_settings cs
      where cs.org_id = r.org_id
        and cs.review_enabled
   );
