def editer(p, remplacements):
    s = open(p, encoding='utf8').read()
    for o, n in remplacements:
        assert s.count(o) == 1, (p, o[:80], s.count(o))
        s = s.replace(o, n)
    open(p, 'w', encoding='utf8', newline='\n').write(s)

editer('src/pages/AutomationBuilderPage.tsx', [
    ("  changerPublication,\n  chargerStatistiques,\n", "  changerPublication,\n  chargerStatistiques,\n  restaurerAutomatisation,\n"),
])
editer('tests/automatisations-editeur-launch.test.tsx', [
    ("  stats: vi.fn(async (_id?: string): Promise<any> => ({ par_regle: {}, par_etape: {} })),\n};",
     "  stats: vi.fn(async (_id?: string): Promise<any> => ({ par_regle: {}, par_etape: {} })),\n  restaurer: vi.fn(async (id: string) => ({ ...regle({ id }), deleted_at: null, is_active: false }) as any),\n};"),
    ("  chargerStatistiques: (id?: string) => api.stats(id),\n}));",
     "  chargerStatistiques: (id?: string) => api.stats(id),\n  restaurerAutomatisation: (id: string) => api.restaurer(id),\n}));"),
])
s = open('tests/automatisations-editeur-launch.test.tsx', encoding='utf8').read()
s += """
// ─── Une automatisation à la corbeille ─────────────────────────

describe('une automatisation à la corbeille ne s’édite pas (audit du 2026-10-01)', () => {
  // Observé : ouverte par son adresse, elle s'affichait comme une autre et
  // le texte d'une étape se réécrivait en base.
  beforeEach(() => {
    etat.regles = [regle({ id: 'r-corbeille', name: 'Relance supprimée', deleted_at: '2026-09-30T10:00:00Z' })];
    api.restaurer.mockClear();
  });

  it('l’écran dit qu’elle est à la corbeille, sans canevas ni panneau', async () => {
    await ouvrir('/automations/r-corbeille');
    expect(container.textContent).toContain('Relance supprimée');
    expect(container.textContent).toContain('Cette automatisation est à la corbeille');
    expect(container.textContent).toContain('elle reviendra en brouillon');
    // Rien de ce qui permet de modifier ou de publier.
    expect(bouton('Ajouter')).toBeUndefined();
    expect(container.querySelector('[role="switch"]')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
    expect(api.modifier).not.toHaveBeenCalled();
  });

  it('« Restaurer » la sort de la corbeille et rend l’éditeur', async () => {
    await ouvrir('/automations/r-corbeille');
    cliquer(bouton('Restaurer'));
    await attendre();
    expect(api.restaurer).toHaveBeenCalledWith('r-corbeille');
    expect(container.textContent).not.toContain('Cette automatisation est à la corbeille');
    expect(toasts.succes).toContain('Automatisation restaurée, en brouillon.');
    expect(container.querySelector('[role="switch"]')).not.toBeNull();
  });

  it('« Mes automatisations » ramène à la liste', async () => {
    await ouvrir('/automations/r-corbeille');
    cliquer(bouton('Mes automatisations'));
    await attendre();
    expect(lieu()).toBe('/automations');
  });

  it('une restauration refusée laisse l’écran en place et dit pourquoi', async () => {
    api.restaurer.mockRejectedValueOnce(new Error('Permission refusée'));
    await ouvrir('/automations/r-corbeille');
    cliquer(bouton('Restaurer'));
    await attendre();
    expect(toasts.erreur).toContain('Permission refusée');
    expect(container.textContent).toContain('Cette automatisation est à la corbeille');
  });
});
"""
open('tests/automatisations-editeur-launch.test.tsx', 'w', encoding='utf8', newline='\n').write(s)
print('ok')
