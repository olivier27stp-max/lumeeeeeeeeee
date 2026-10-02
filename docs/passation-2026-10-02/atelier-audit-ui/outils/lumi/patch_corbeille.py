def editer(p, remplacements):
    s = open(p, encoding='utf8').read()
    for o, n in remplacements:
        assert s.count(o) == 1, (p, o[:80], s.count(o))
        s = s.replace(o, n)
    open(p, 'w', encoding='utf8', newline='\n').write(s)

# ── Serveur : une règle à la corbeille ne se modifie pas, ne se duplique pas si elle est purgée ──
editer('server/routes/automation-rules.ts', [
("""    .select('id, is_preset, is_active, trigger_event, delay_seconds, modele_id, conditions, steps, actions')
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId)
    .maybeSingle();

  if (lectureErr) {
    logger.error('[automation-rules] lecture avant modification échouée', { message: lectureErr.message });
    return res.status(500).json({ error: 'Impossible de lire l\'automatisation.' });
  }
  if (!existante) return res.status(404).json({ error: 'Automatisation introuvable.' });
""",
"""    .select('id, is_preset, is_active, trigger_event, delay_seconds, modele_id, conditions, steps, actions, deleted_at')
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId)
    .is('purged_at', null)
    .maybeSingle();

  if (lectureErr) {
    logger.error('[automation-rules] lecture avant modification échouée', { message: lectureErr.message });
    return res.status(500).json({ error: 'Impossible de lire l\'automatisation.' });
  }
  if (!existante) return res.status(404).json({ error: 'Automatisation introuvable.' });
  /*
   * À LA CORBEILLE : on restaure d'abord. L'éditeur s'ouvrait par son adresse
   * sur une règle supprimée et la laissait réécrire (texte d'une étape changé
   * en base, audit du 2026-10-01) — on modifiait sans le savoir une
   * automatisation qui ne partira plus.
   */
  if (existante.deleted_at) {
    return res.status(409).json({
      error: langueDe(req) === 'fr'
        ? 'Cette automatisation est à la corbeille : restaurez-la pour la modifier.'
        : 'This automation is in the bin: restore it to edit it.',
    });
  }
"""),
])

# ── Éditeur : un écran clair, avec « Restaurer » ──
editer('src/pages/AutomationBuilderPage.tsx', [
("""  /** Le panneau de Lumi, replié par l'utilisateur (le fil est gardé). */
  const [lumiReduit, setLumiReduit] = useState(false);
""",
"""  /** Le panneau de Lumi, replié par l'utilisateur (le fil est gardé). */
  const [lumiReduit, setLumiReduit] = useState(false);
  /** « Restaurer » en cours, depuis l'écran d'une automatisation à la corbeille. */
  const [restauration, setRestauration] = useState(false);
"""),
("""  const ONGLETS: Array<{ cle: Onglet; fr: string; en: string }> = [""",
"""  /*
   * À LA CORBEILLE : ni canevas ni panneaux. L'éditeur s'ouvrait par son
   * adresse (lien gardé, onglet resté ouvert) sur une automatisation
   * supprimée comme sur une autre, sans le dire, et la laissait modifier
   * (audit du 2026-10-01). On dit où elle est, et on offre de la restaurer.
   */
  if (regle.deleted_at) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-surface px-6 text-center">
        <p className="text-base font-semibold text-text-primary">{nom || regle.name}</p>
        <p className="max-w-md text-sm text-text-secondary">
          {fr
            ? 'Cette automatisation est à la corbeille : elle ne se déclenche plus et ne se modifie pas. Restaurez-la pour la retravailler — elle reviendra en brouillon.'
            : 'This automation is in the bin: it no longer runs and cannot be edited. Restore it to work on it — it comes back as a draft.'}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={restauration}
            onClick={() => {
              setRestauration(true);
              restaurerAutomatisation(regle.id)
                .then((maj) => {
                  setRegle((r) => (r ? { ...r, deleted_at: maj.deleted_at ?? null, is_active: maj.is_active } : maj));
                  toast.success(fr ? 'Automatisation restaurée, en brouillon.' : 'Automation restored, as a draft.');
                })
                .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))
                .finally(() => setRestauration(false));
            }}
            className="rounded-lg bg-text-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {restauration ? (fr ? 'Restauration…' : 'Restoring…') : (fr ? 'Restaurer' : 'Restore')}
          </button>
          <button
            type="button"
            onClick={() => void quitterEditeur()}
            className="rounded-lg border border-outline px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {fr ? 'Mes automatisations' : 'My automations'}
          </button>
        </div>
      </div>
    );
  }

  const ONGLETS: Array<{ cle: Onglet; fr: string; en: string }> = ["""),
])
print('ok')
