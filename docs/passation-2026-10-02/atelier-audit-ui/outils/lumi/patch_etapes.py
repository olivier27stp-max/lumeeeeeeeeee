def editer(p, remplacements):
    s = open(p, encoding='utf8').read()
    for o, n in remplacements:
        assert s.count(o) == 1, (p, o[:80], s.count(o))
        s = s.replace(o, n)
    open(p, 'w', encoding='utf8', newline='\n').write(s)

editer('src/components/automations/PanneauEtape.tsx', [
    ("  automatisations?: Array<{ id: string; nom: string }>;\n  /** Champs personnalisés actifs",
     "  automatisations?: Array<{ id: string; nom: string }>;\n  /** Étapes des pipelines du bureau, pour « Déplacer l’opportunité → Une étape précise ». */\n  etapesPipeline?: Array<{ id: string; label: string }>;\n  /** Champs personnalisés actifs"),
    ("  etape, fr, declencheur, membres, etiquettes, automatisations = [], champsPerso = [], objetChamps = null, stats,",
     "  etape, fr, declencheur, membres, etiquettes, automatisations = [], etapesPipeline = [], champsPerso = [], objetChamps = null, stats,"),
])
editer('src/pages/AutomationBuilderPage.tsx', [
    ("  const besoinEtapes = !!declencheurCourant?.champs?.some((c) => c.type === 'etape_pipeline');",
     "  // … et dès qu'un panneau d'étape est ouvert : « Déplacer l'opportunité » y\n  // offre le menu des étapes, y compris quand on vient de changer d'action\n  // dans le panneau (le parcours enregistré ne le sait pas encore).\n  const besoinEtapes = !!declencheurCourant?.champs?.some((c) => c.type === 'etape_pipeline')\n    || etapeChoisie !== null\n    || steps.some((e) => e.type === 'action' && e.action?.type === 'move_deal_stage');"),
    ("          automatisations={autresAutomatisations}\n          champsPerso={champsPerso}\n          objetChamps={objetRegle}\n          stats={statsEtapes?.[etapeOuverte.id] ?? null}",
     "          automatisations={autresAutomatisations}\n          etapesPipeline={etapesPipeline}\n          champsPerso={champsPerso}\n          objetChamps={objetRegle}\n          stats={statsEtapes?.[etapeOuverte.id] ?? null}"),
])
print('ok')
