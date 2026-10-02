p = 'server/routes/automation-rules.ts'
s = open(p, encoding='utf8').read()


def rep(o, n):
    global s
    assert s.count(o) == 1, (o[:70], s.count(o))
    s = s.replace(o, n)


rep("import { genererParcours } from '../lib/lumi/generer-parcours';",
    "import { genererParcours } from '../lib/lumi/generer-parcours';\n"
    "import { lireDejaPubliees, noteDejaPubliees } from '../lib/lumi/deja-publiees';")

rep("""  /*
   * La conversation est gardée AVEC l'automatisation : fermer l'éditeur ne
   * fait plus oublier à Lumi ce qui a été dit""",
    """  /*
   * « Tu en as déjà une » : au PREMIER tour d'une conversation, on signale
   * les automatisations publiées du bureau sur le même déclencheur — Lumi ne
   * les voit pas, et en bâtir une seconde fait un doublon silencieux (rep
   * notifié deux fois, client relancé deux fois). Aux tours suivants, la
   * note serait du bruit : elle a déjà été dite.
   */
  if (!echanges?.length) {
    const dejaLa = await lireDejaPubliees(auth.client, auth.orgId, resultat.parcours.trigger_event, ruleIdEnvoye, langue);
    resultat.parcours.resume += noteDejaPubliees(dejaLa, resultat.parcours.trigger_event, langue);
  }

  /*
   * La conversation est gardée AVEC l'automatisation : fermer l'éditeur ne
   * fait plus oublier à Lumi ce qui a été dit""")
open(p, 'w', encoding='utf8', newline='\n').write(s)

p = 'Dockerfile'
s = open(p, encoding='utf8').read()
rep("COPY src/lib/sequenceTypes.ts ./src/lib/sequenceTypes.ts\n",
    "COPY src/lib/sequenceTypes.ts ./src/lib/sequenceTypes.ts\n"
    "# Les noms français des préréglages (semés en anglais en base) : Lumi cite\n"
    "# les automatisations déjà publiées par le nom que l'écran affiche.\n"
    "COPY src/lib/automationNames.ts ./src/lib/automationNames.ts\n")
open(p, 'w', encoding='utf8', newline='\n').write(s)
print('ok')
