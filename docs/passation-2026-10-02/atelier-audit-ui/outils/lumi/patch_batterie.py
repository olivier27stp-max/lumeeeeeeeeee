p = 'scripts/qa/evaluer-construire-lumi.mts'
s = open(p, encoding='utf8').read()


def rep(o, n):
    global s
    assert s.count(o) == 1, (o[:70], s.count(o))
    s = s.replace(o, n)


# Contrôles nouveaux, à la fin de l'objet C.
rep("  sansNuit: { nom: 'aucun envoi la nuit proposé',",
    """  sansTexteExemple: { nom: 'aucun texte d’exemple de l’éditeur ne reste dans le parcours', ok: ({ apres }: Ctx) => {
    const reste = messages(apres).find((m) => /c’est \\[company_name\\]\\. Merci !|this is \\[company_name\\]\\. Thank you!|^À compléter$|^To complete$/.test(m.texte));
    return !reste || `texte d’exemple gardé : « ${reste.texte.slice(0, 60)} »`;
  } },
  rienAuClient: { nom: 'rien ne part au client (ni texto ni courriel)', ok: ({ apres }: Ctx) => messages(apres).length === 0 || `${messages(apres).length} message(s) au client` },
  notifieLeRep: { nom: 'une notification interne va au responsable (ou au rep assigné)', ok: ({ apres }: Ctx) =>
    (apres?.steps ?? []).some((e) => (e as { action?: { type?: string; config?: { destinataire?: string } } }).action?.type === 'create_notification'
      && ['responsable', 'equipe_du_deal'].includes(String((e as { action?: { config?: { destinataire?: string } } }).action?.config?.destinataire))) || 'pas de notification au responsable' },
  montreNotification: { nom: 'la réponse cite le texte de la notification', ok: ({ r }: Ctx) => /Notification dans Lume, [^\\n]+ : « [^»]+ »/.test(r.parcours?.resume ?? '') || 'texte de la notification absent de la réponse' },
  ditCeQuiEstRetire: { nom: 'la réponse dit que le texto d’exemple est retiré', ok: ({ r }: Ctx) => /Retiré du parcours :\\n• Texto/.test(r.parcours?.resume ?? '') || 'retrait non dit' },
  sansNuit: { nom: 'aucun envoi la nuit proposé',""")

# Départ : une étape « Envoyer un texto » fraîchement ajoutée, texte d'exemple.
rep("const FACTURE: Parcours = {",
    """/** Le canevas de Rafba le 2026-10-01 : déclencheur choisi, une étape texto tout juste ajoutée (texte d'exemple). */
const TEXTO_EXEMPLE: Parcours = {
  trigger_event: 'quote.viewed',
  steps: [
    { id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_name], c’est [company_name]. Merci !' } }, suivant: null },
  ],
};
const FACTURE: Parcours = {""")

rep("  { cle: 'zero-puis-delai', nom: 'Construire de zéro, puis changer le délai',",
    """  { cle: 'rep', nom: 'La vraie demande de Rafba (prod, 2026-10-01) : notifier le rep, canevas avec un texto d’exemple', langue: 'fr', depart: TEXTO_EXEMPLE, tours: [
    { demande: 'fais un message pour notifier le rep en questions qui a envoye le devis', controles: [C.valide, C.variablesConnues, C.sansTexteExemple, C.rienAuClient, C.notifieLeRep, C.montreNotification, C.ditCeQuiEstRetire, C.declencheur(['quote.viewed'])] },
  ] },
  { cle: 'exemple-reecrit', nom: 'Texto d’exemple dans le canevas, demande qui porte sur CE texto : il est réécrit', langue: 'fr', depart: TEXTO_EXEMPLE, tours: [
    { demande: 'écris le texto pour remercier le client d’avoir regardé son devis et lui dire qu’on est là pour ses questions', controles: [...BASE, C.vouvoiement, C.sansTexteExemple, C.smsCourt, C.montreTexte, C.declencheur(['quote.viewed'])] },
  ] },
  { cle: 'zero-puis-delai', nom: 'Construire de zéro, puis changer le délai',""")

open(p, 'w', encoding='utf8', newline='\n').write(s)
print('ok')
