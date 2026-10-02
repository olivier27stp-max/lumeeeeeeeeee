def editer(p, remplacements):
    s = open(p, encoding='utf8').read()
    for o, n in remplacements:
        assert s.count(o) == 1, (p, o[:90], s.count(o))
        s = s.replace(o, n)
    open(p, 'w', encoding='utf8', newline='\n').write(s)

editer('src/pages/Automations.tsx', [
("import React, { useState, useEffect, useCallback, useRef } from 'react';\n",
 "import React, { useState, useEffect, useCallback, useRef } from 'react';\nimport { createPortal } from 'react-dom';\n"),

("  const [menuLigne, setMenuLigne] = useState<string | null>(null);\n",
 """  const [menuLigne, setMenuLigne] = useState<string | null>(null);
  /**
   * Où dessiner le menu « ⋮ » d'une ligne, en coordonnées de la FENÊTRE.
   *
   * Le menu était en `absolute` dans la carte du tableau, qui est en
   * `overflow-hidden` (et son conteneur en `overflow-x-auto`, donc coupé aussi
   * en hauteur) : sur les dernières lignes, ou dans une liste de 1 à 3 lignes,
   * on n'en voyait qu'un liseré (audit du 2026-10-01). Il est maintenant rendu
   * dans `document.body`, ancré au bouton, et s'ouvre VERS LE HAUT quand la
   * place manque en bas.
   */
  const [posMenuLigne, setPosMenuLigne] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
"""),

("    const fermer = () => { setMenuCreer(false); setMenuLigne(null); setSousMenuDossier(null); };\n",
 "    const fermer = () => { setMenuCreer(false); setMenuLigne(null); setSousMenuDossier(null); };\n"),

("    document.addEventListener('click', fermer);\n    document.addEventListener('keydown', auClavier);\n    return () => {\n      document.removeEventListener('click', fermer);\n      document.removeEventListener('keydown', auClavier);\n    };",
 """    document.addEventListener('click', fermer);
    document.addEventListener('keydown', auClavier);
    // Le menu d'une ligne est ancré à la fenêtre : il ne suivrait pas un
    // défilement ou un redimensionnement. On le ferme plutôt que de le laisser flotter.
    const auDefilement = () => { if (menuLigne) fermer(); };
    window.addEventListener('scroll', auDefilement, true);
    window.addEventListener('resize', auDefilement);
    return () => {
      document.removeEventListener('click', fermer);
      document.removeEventListener('keydown', auClavier);
      window.removeEventListener('scroll', auDefilement, true);
      window.removeEventListener('resize', auDefilement);
    };"""),

("                                  onClick={(e) => { e.stopPropagation(); setMenuLigne((m) => (m === rule.id ? null : rule.id)); }}\n",
 """                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const r = e.currentTarget.getBoundingClientRect();
                                    // ~260 px : la hauteur du menu avec son sous-menu de dossiers.
                                    const versLeHaut = window.innerHeight - r.bottom < 260 && r.top > 260;
                                    setPosMenuLigne(versLeHaut
                                      ? { bottom: window.innerHeight - r.top + 4, right: window.innerWidth - r.right }
                                      : { top: r.bottom + 4, right: window.innerWidth - r.right });
                                    setMenuLigne((m) => (m === rule.id ? null : rule.id));
                                  }}
"""),

("""                                {menuLigne === rule.id && (
                                  <div
                                    role="menu"
                                    tabIndex={-1}
                                    onClick={(e) => e.stopPropagation()}
                                    className="absolute right-0 z-30 mt-1 w-[210px] overflow-hidden rounded-xl border border-border bg-surface-card p-1.5 shadow-lg"
                                  >""",
 """                                {menuLigne === rule.id && posMenuLigne && createPortal(
                                  <div
                                    role="menu"
                                    tabIndex={-1}
                                    onClick={(e) => e.stopPropagation()}
                                    style={posMenuLigne}
                                    className="fixed z-[60] max-h-[70vh] w-[210px] overflow-y-auto rounded-xl border border-border bg-surface-card p-1.5 shadow-lg"
                                  >"""),

("""                                    </>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>""",
 """                                    </>
                                    )}
                                  </div>,
                                  document.body,
                                )}
                              </div>
                            </div>
                          </td>"""),
])
print('ok')
