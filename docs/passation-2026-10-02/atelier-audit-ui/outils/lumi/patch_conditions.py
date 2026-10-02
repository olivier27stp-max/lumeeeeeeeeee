def editer(p, remplacements):
    s = open(p, encoding='utf8').read()
    for o, n in remplacements:
        assert s.count(o) == 1, (p, o[:80], s.count(o))
        s = s.replace(o, n)
    open(p, 'w', encoding='utf8', newline='\n').write(s)

# 1. La règle partagée (interface + serveur).
editer('src/lib/automationCatalogue.ts', [(
"""export function trouverDeclencheur(cle: string): DeclencheurCatalogue | undefined {""",
"""/**
 * Les `conditions` d'une règle qui CHANGE de déclencheur.
 *
 * Les réglages d'un déclencheur vivent dans `conditions` (« première
 * ouverture seulement », le champ date à surveiller, l'étiquette visée…).
 * En changer en gardant tout laissait ceux de l'ancien en base, invisibles :
 * passer par « Devis ouvert par le client » puis choisir un autre déclencheur
 * gardait `{ ouverture: 'premiere' }`, que le moteur compare à un événement
 * qui n'a pas d'« ouverture » — l'automatisation, même publiée, ne partait
 * JAMAIS, sans un mot (audit du 2026-10-01).
 *
 * On garde donc seulement ce qui a le MÊME sens des deux côtés :
 *  · un réglage que l'ancien ET le nouveau déclencheur déclarent tous deux
 *    (les filtres d'étiquettes du client, par exemple) ;
 *  · les filtres sur les champs de la fiche, si la fiche est de même nature ;
 * et on pose les réglages d'office du nouveau déclencheur.
 */
export function conditionsApresChangement(
  ancien: string,
  nouveau: string,
  conditions: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const source = trouverDeclencheur(ancien);
  const cible = trouverDeclencheur(nouveau);
  const sortie: Record<string, unknown> = { ...(cible?.conditions_defaut ?? {}) };
  if (!source || !cible) return sortie;
  const communs = new Set((cible.champs ?? []).map((c) => c.cle).filter((cle) => (source.champs ?? []).some((c) => c.cle === cle)));
  for (const [cle, valeur] of Object.entries(conditions ?? {})) {
    if (communs.has(cle)) sortie[cle] = valeur;
  }
  if (source.entite === cible.entite && Array.isArray(conditions?.champs_perso)) sortie.champs_perso = conditions.champs_perso;
  return sortie;
}

export function trouverDeclencheur(cle: string): DeclencheurCatalogue | undefined {"""
)])

# 2. L'éditeur : le tiroir, et le déclencheur proposé par Lumi.
editer('src/pages/AutomationBuilderPage.tsx', [
("""      // Réglages posés d'office par ce déclencheur (ex. « première ouverture
      // seulement ») — sans écraser ce que la règle portait déjà.
      const defaut = DECLENCHEURS.find((d) => d.cle === cle)?.conditions_defaut;
      const maj = await ecrire(defaut
        ? { trigger_event: cle, conditions: { ...defaut, ...((regle.conditions ?? {}) as Record<string, unknown>) } }
        : { trigger_event: cle });
      setRegle(maj);""",
"""      // Les réglages de l'ANCIEN déclencheur partent avec lui ; ceux du
      // nouveau sont posés d'office (voir `conditionsApresChangement`).
      const maj = await ecrire({
        trigger_event: cle,
        conditions: conditionsApresChangement(regle.trigger_event, cle, (regle.conditions ?? {}) as Record<string, unknown>),
      });
      setRegle(maj);"""),
("""        ecrire({ trigger_event: propose.trigger_event }).catch((e: unknown) => {""",
"""        // Un déclencheur CHANGÉ par Lumi emporte les réglages de l'ancien, comme au tiroir.
        const conditionsLumi = propose.trigger_event !== declencheurEnBase
          ? { conditions: conditionsApresChangement(declencheurEnBase, propose.trigger_event, (regle.conditions ?? {}) as Record<string, unknown>) }
          : {};
        if ('conditions' in conditionsLumi) setRegle((r) => (r ? { ...r, conditions: conditionsLumi.conditions } : r));
        ecrire({ trigger_event: propose.trigger_event, ...conditionsLumi }).catch((e: unknown) => {"""),
])

# 3. Le serveur : dernier filet, pour tout client (outils Lumi, API, ancien navigateur).
editer('server/routes/automation-rules.ts', [(
"""  const fr = langueDe(req) === 'fr';
  const probleme = verifierCoherence({
    trigger_event: patch.trigger_event ?? existante.trigger_event,
    delay_seconds: patch.delay_seconds ?? existante.delay_seconds,
    actions: patch.actions,
  }, fr);""",
"""  /*
   * Changer de déclencheur SANS dire quoi faire des conditions : les réglages
   * de l'ancien ne doivent pas rester (une règle qui garde « première
   * ouverture » sur « Étiquette ajoutée » ne part jamais). L'éditeur envoie
   * déjà les bonnes conditions ; ceci couvre tout autre client.
   */
  if (typeof patch.trigger_event === 'string' && patch.trigger_event !== existante.trigger_event && !('conditions' in patch)) {
    patch.conditions = conditionsApresChangement(
      existante.trigger_event, patch.trigger_event, (existante.conditions ?? {}) as Record<string, unknown>,
    );
  }

  const fr = langueDe(req) === 'fr';
  const probleme = verifierCoherence({
    trigger_event: patch.trigger_event ?? existante.trigger_event,
    delay_seconds: patch.delay_seconds ?? existante.delay_seconds,
    actions: patch.actions,
  }, fr);"""
)])
print('ok')
