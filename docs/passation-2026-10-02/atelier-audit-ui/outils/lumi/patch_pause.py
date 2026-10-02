def editer(p, remplacements):
    s = open(p, encoding='utf8').read()
    for o, n in remplacements:
        assert s.count(o) == 1, (p, o[:90], s.count(o))
        s = s.replace(o, n)
    open(p, 'w', encoding='utf8', newline='\n').write(s)

editer('src/components/automations/BandeauPause.tsx', [
("""  const [occupe, setOccupe] = useState(false);

  useEffect(() => {
    let vivant = true;
    lireEtatPause()
      .then((e) => { if (vivant) setEnPause(e.paused); })
      // Silence volontaire : si l'état est illisible, on n'affiche rien
      // plutôt qu'une erreur en haut de la page. Le reste fonctionne.
      .catch(() => { if (vivant) setEnPause(null); });
    return () => { vivant = false; };
  }, []);
""",
"""  const [occupe, setOccupe] = useState(false);
  /**
   * La lecture de l'état a échoué. Avant, on n'affichait alors RIEN : le
   * bouton d'urgence « Tout arrêter » disparaissait sans un mot, et un bureau
   * réellement en pause ne le voyait plus (audit du 2026-10-01). On le dit,
   * on offre de réessayer, et l'arrêt d'urgence reste sous la main.
   */
  const [illisible, setIllisible] = useState(false);
  const [essai, setEssai] = useState(0);

  useEffect(() => {
    let vivant = true;
    lireEtatPause()
      .then((e) => { if (vivant) { setIllisible(false); setEnPause(e.paused); } })
      .catch((e: unknown) => {
        console.error('[BandeauPause] état de la pause illisible', e);
        if (vivant) { setEnPause(null); setIllisible(true); }
      });
    return () => { vivant = false; };
  }, [essai]);
"""),
("""      const reel = await basculerPause(vers);
      setEnPause(reel.paused);
""",
"""      const reel = await basculerPause(vers);
      setIllisible(false);
      setEnPause(reel.paused);
"""),
("""  // État inconnu (lecture échouée) : on n'affiche rien.
  if (enPause === null) return null;
""",
"""  // Lecture échouée : on le dit, sans retirer l'arrêt d'urgence.
  if (enPause === null && illisible) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-3 text-[12px] text-text-tertiary" role="status">
        <span>
          {fr
            ? 'Impossible de savoir si vos automatisations sont en pause pour le moment.'
            : 'Cannot tell right now whether your automations are paused.'}
        </span>
        <button
          type="button"
          onClick={() => setEssai((n) => n + 1)}
          className="underline decoration-dotted underline-offset-2 transition-colors hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {fr ? 'Réessayer' : 'Try again'}
        </button>
        <button
          type="button"
          onClick={() => basculer(true)}
          disabled={occupe}
          className="inline-flex items-center gap-1.5 transition-colors hover:text-danger disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <PauseCircle size={13} aria-hidden="true" />
          {fr ? 'Tout arrêter' : 'Pause everything'}
        </button>
      </div>
    );
  }
  // Pas encore lu : rien (l'état arrive en une fraction de seconde).
  if (enPause === null) return null;
"""),
])
print('ok')
