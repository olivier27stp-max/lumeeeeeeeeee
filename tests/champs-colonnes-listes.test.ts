/**
 * Colonnes de champs dans les listes (Clients, Jobs, Devis, Factures) : même
 * disposition que « Manage fields » de GoHighLevel. Vérifié au navigateur :
 * « Colonnes affichées (2 sur 4) », ordre retenu dans le navigateur de la personne.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const s = readFileSync(join(__dirname, '..', 'src/components/champs/liste.tsx'), 'utf8');

describe('colonnes des listes', () => {
  it('colonnes affichées réordonnables (glisser) et compteur', () => {
    expect(s).toContain('<SortableContext items={affichees}');
    expect(s).toContain('arrayMove(affichees');
    expect(s).toContain('Colonnes affichées (${affichees.length} sur ${MAX_COLONNES})');
  });
  it('ajouter des colonnes avec recherche, créer un champ réservé au propriétaire/admin', () => {
    expect(s).toContain("Ajouter des colonnes");
    expect(s).toContain("role === 'owner' || role === 'admin'");
  });
});
