-- Remove the 3 prefab quote presets that were auto-seeded per org
-- (Classic Blue / Detailed Red / Modern Bold). Presets are user-created
-- only from now on — the POST /quote-templates/seed endpoint is removed.
-- Match on name + the exact seeded description so a user-created or
-- renamed preset is never touched. Soft delete, per project convention.

UPDATE quote_templates
SET deleted_at = now()
WHERE deleted_at IS NULL
  AND (
    (name = 'Classic Blue' AND description = 'Professional navy blue layout with clean corporate styling.')
    OR (name = 'Detailed Red' AND description = 'Detailed estimate with full cost breakdown, signature line, and service information.')
    OR (name = 'Modern Bold' AND description = 'Vibrant contemporary design with bold orange accents and modern styling.')
  );
