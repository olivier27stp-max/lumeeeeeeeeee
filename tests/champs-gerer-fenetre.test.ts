/**
 * « Gérer les champs » dans les fenêtres de création (modèle « Customize form »
 * de GoHighLevel, analyse Muse du 2026-09-25). Vérifié au navigateur : retirer
 * un champ l'enregistre (config.masque_creation) et la fenêtre ne l'affiche plus.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const lire = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

describe('gérer les champs d’une fenêtre', () => {
  it('le serveur accepte et conserve masque_creation', () => {
    expect(lire('server/lib/validation.ts')).toContain('masque_creation: z.boolean().optional(),');
    expect(lire('server/lib/champs/service.ts')).toContain('...(c.masque_creation ? { masque_creation: true } : {}),');
  });
  it('la fenêtre de création n’affiche pas un champ retiré, et propose « Gérer les champs » au propriétaire/admin', () => {
    const c = lire('src/components/champs/creation.tsx');
    expect(c).toContain('tousActifs.filter((c) => !c.config?.masque_creation)');
    expect(c).toContain("role === 'owner' || role === 'admin'");
    expect(c).toContain('<GererChampsFenetre');
  });
});

describe('gérer les champs d’une fiche', () => {
  it('masque_fiche accepté et conservé, la fiche l’applique, le panneau sort en portail', () => {
    expect(lire('server/lib/validation.ts')).toContain('masque_fiche: z.boolean().optional(),');
    expect(lire('server/lib/champs/service.ts')).toContain('...(c.masque_fiche ? { masque_fiche: true } : {}),');
    expect(lire('src/components/champs/CustomFieldsPanel.tsx')).toContain('data.fields.filter((x) => !x.config?.masque_fiche)');
    expect(lire('src/components/champs/GererChampsFenetre.tsx')).toContain('createPortal(');
  });
});
