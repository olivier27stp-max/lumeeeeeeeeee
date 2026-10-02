def editer(p, remplacements):
    s = open(p, encoding='utf8').read()
    for o, n in remplacements:
        assert s.count(o) == 1, (p, o[:70], s.count(o))
        s = s.replace(o, n)
    open(p, 'w', encoding='utf8', newline='\n').write(s)


editer('server/lib/lumi/deja-publiees.ts', [
    ("/** Les types d'action d'une règle, format d'origine (`actions`) ou parcours (`steps`). */\nfunction typesDAction(",
     "/** Les types d'action d'une règle, format d'origine (`actions`) ou parcours (`steps`). */\nexport function typesDAction("),
    ("""/** La note ajoutée sous la réponse de Lumi. Vide s'il n'y a rien à signaler. */
export function noteDejaPubliees(regles: DejaPubliee[], declencheur: string, langue: 'fr' | 'en'): string {
  if (!regles.length) return '';
""",
     """/**
 * La note ajoutée sous la réponse de Lumi. Vide s'il n'y a rien à signaler.
 *
 * `actionsNouvelles` : les types d'action du parcours qu'on vient de bâtir.
 * On ne cite que les automatisations qui font LA MÊME CHOSE (au moins un type
 * d'action en commun) : sur « Devis envoyé », cinq relances par texto et
 * courriel ne sont pas un doublon d'une notification interne — les lister
 * noyait l'information utile (constaté sur lumecrm.net le 2026-10-01).
 */
export function noteDejaPubliees(toutes: DejaPubliee[], declencheur: string, langue: 'fr' | 'en', actionsNouvelles: string[]): string {
  const regles = toutes.filter((r) => r.actions.some((t) => actionsNouvelles.includes(t)));
  if (!regles.length) return '';
"""),
    ("""    ? `\\n\\nÀ savoir : tu as déjà ${n > 1 ? 'des automatisations publiées' : 'une automatisation publiée'} sur ce même déclencheur (« ${quand} ») :\\n${lignes.join('\\n')}\\nVérifie qu’elles ne font pas double emploi avant de publier celle-ci.`
    : `\\n\\nGood to know: you already have ${n > 1 ? 'published automations' : 'a published automation'} on this same trigger (“${quand}”):\\n${lignes.join('\\n')}\\nCheck they do not overlap before publishing this one.`;""",
     """    ? `\\n\\nÀ savoir : tu as déjà ${n > 1 ? 'des automatisations publiées qui font' : 'une automatisation publiée qui fait'} la même chose sur ce déclencheur (« ${quand} ») :\\n${lignes.join('\\n')}\\nVérifie ${n > 1 ? 'qu’elles ne font' : 'qu’elle ne fait'} pas double emploi avant de publier celle-ci.`
    : `\\n\\nGood to know: you already have ${n > 1 ? 'published automations that do' : 'a published automation that does'} the same thing on this trigger (“${quand}”):\\n${lignes.join('\\n')}\\nCheck ${n > 1 ? 'they do' : 'it does'} not overlap before publishing this one.`;"""),
])

editer('server/routes/automation-rules.ts', [
    ("import { lireDejaPubliees, noteDejaPubliees } from '../lib/lumi/deja-publiees';",
     "import { lireDejaPubliees, noteDejaPubliees, typesDAction } from '../lib/lumi/deja-publiees';"),
    ("    resultat.parcours.resume += noteDejaPubliees(dejaLa, resultat.parcours.trigger_event, langue);",
     "    resultat.parcours.resume += noteDejaPubliees(dejaLa, resultat.parcours.trigger_event, langue, typesDAction({ steps: verdict.data }));"),
])

editer('tests/lumi-deja-publiees.test.ts', [
    ("    expect(noteDejaPubliees([], 'quote.viewed', 'fr')).toBe('');",
     "    expect(noteDejaPubliees([], 'quote.viewed', 'fr', ['create_notification'])).toBe('');"),
    ("""    const note = noteDejaPubliees([{ nom: 'Me notifier quand un client ouvre sa soumission', actions: ['create_notification'] }], 'quote.viewed', 'fr');
    expect(note).toContain('À savoir : tu as déjà une automatisation publiée sur ce même déclencheur («');""",
     """    const note = noteDejaPubliees([{ nom: 'Me notifier quand un client ouvre sa soumission', actions: ['create_notification'] }], 'quote.viewed', 'fr', ['create_notification']);
    expect(note).toContain('À savoir : tu as déjà une automatisation publiée qui fait la même chose sur ce déclencheur («');"""),
    ("    expect(note).toContain('Vérifie qu’elles ne font pas double emploi avant de publier celle-ci.');",
     "    expect(note).toContain('Vérifie qu’elle ne fait pas double emploi avant de publier celle-ci.');"),
    ("""    const note = noteDejaPubliees(six, 'quote.sent', 'fr');
    expect(note).toContain('tu as déjà des automatisations publiées');""",
     """    const note = noteDejaPubliees(six, 'quote.sent', 'fr', ['send_sms']);
    expect(note).toContain('tu as déjà des automatisations publiées qui font la même chose');
    expect(note).toContain('Vérifie qu’elles ne font pas double emploi');"""),
    ("""    const note = noteDejaPubliees([{ nom: 'Notify me', actions: ['create_notification'] }], 'quote.viewed', 'en');
    expect(note).toContain('Good to know: you already have a published automation on this same trigger');""",
     """    const note = noteDejaPubliees([{ nom: 'Notify me', actions: ['create_notification'] }], 'quote.viewed', 'en', ['create_notification']);
    expect(note).toContain('Good to know: you already have a published automation that does the same thing on this trigger');"""),
    ("    expect(noteDejaPubliees([{ nom: 'X', actions: ['action_inconnue'] }], 'quote.viewed', 'fr')).toContain('• « X »\\n');",
     """    expect(noteDejaPubliees([{ nom: 'X', actions: ['action_inconnue'] }], 'quote.viewed', 'fr', ['action_inconnue'])).toContain('• « X »\\n');
  });

  it('seules les automatisations qui font LA MÊME CHOSE sont citées — vu sur lumecrm.net : 5 relances par texto et courriel listées pour une simple notification', () => {
    const relances = [
      { nom: 'Suivi de devis — 1 jour', actions: ['send_sms', 'send_email'] },
      { nom: 'Suivi de devis — 7 jours', actions: ['send_email'] },
      { nom: 'Suivi de devis — 21 jours (final)', actions: ['send_email', 'create_notification'] },
    ];
    // Le nouveau parcours ne fait qu'une notification interne : une seule fait la même chose.
    const note = noteDejaPubliees(relances, 'quote.sent', 'fr', ['create_notification']);
    expect(note).toContain('• « Suivi de devis — 21 jours (final) »');
    expect(note).not.toContain('Suivi de devis — 1 jour');
    expect(note).not.toContain('Suivi de devis — 7 jours');
    // Aucune ne fait la même chose : aucune note, plutôt qu'une fausse alerte de doublon.
    expect(noteDejaPubliees(relances.slice(0, 2), 'quote.sent', 'fr', ['create_notification'])).toBe('');"""),
    ("resultat\\.parcours\\.resume \\+= noteDejaPubliees\\(/);",
     "resultat\\.parcours\\.resume \\+= noteDejaPubliees\\(dejaLa, resultat\\.parcours\\.trigger_event, langue, typesDAction\\(\\{ steps: verdict\\.data \\}\\)\\);/);"),
])
print('ok')
