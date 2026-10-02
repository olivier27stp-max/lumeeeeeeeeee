def editer(p, remplacements):
    s = open(p, encoding='utf8').read()
    for o, n in remplacements:
        assert s.count(o) == 1, (p, o[:90], s.count(o))
        s = s.replace(o, n)
    open(p, 'w', encoding='utf8', newline='\n').write(s)

# ── Le libellé du bouton d'une entité, sans lecture en base (pour l'aperçu) ──
editer('server/lib/courriels/bouton-automatisation.ts', [(
"""/**
 * L'adresse publique de l'app.
""",
"""/**
 * Le libellé du bouton que porterait un courriel d'automatisation sur ce type
 * d'entité, ou `null` s'il n'en porterait aucun (prospect, rendez-vous, job…).
 * Sans lecture en base : c'est ce que l'APERÇU montre, pour ne pas inventer un
 * bouton de paiement sur un courriel qui n'en aura pas.
 */
export function texteBoutonParDefaut(entityType: string | null | undefined, langue: LangueBouton = 'fr'): string | null {
  const page = entityType ? PAGES[entityType] : undefined;
  return page ? page.texte[langue] : null;
}

/**
 * L'adresse publique de l'app.
""")])

# ── La route d'aperçu : un courriel d'automatisation n'a ni montant ni bouton de paiement ──
editer('server/routes/emails.ts', [
("import { remplacerParExemples } from '../../src/lib/variablesCourriel';",
 "import { remplacerParExemples } from '../../src/lib/variablesCourriel';\nimport { ENTITE_PAR_DECLENCHEUR } from '../../src/lib/automationCatalogue';\nimport { texteBoutonParDefaut } from '../lib/courriels/bouton-automatisation';"),
("""    const fr = langueEntreprise(company) === 'fr';
    const html = rendreCourrielClient({
      langue: langueEntreprise(company),
      marque: marqueDepuis(company),
      corpsHtml: avecExemples(assainirHtmlCourriel(corps)),
      montant: { libelle: fr ? 'Montant à payer' : 'Amount due', valeur: fr ? '1 220,17 $' : '$1,220.17' },
      bouton: {
        texte: fr ? 'Voir et payer' : 'View and pay',
        url: 'https://lumecrm.net/',
        sousBouton: fr ? 'Carte de crédit · aucun compte à créer' : 'Credit card · no account needed',
      },
      signature: null,
    });
""",
"""    const fr = langueEntreprise(company) === 'fr';
    /*
     * Un courriel d'AUTOMATISATION (`type` absent) n'a ni bloc de montant ni
     * bouton de paiement : à l'envoi, il porte seulement le bouton de l'entité
     * que son déclencheur fait arriver (« Approuver la soumission », « Payer la
     * facture »), ou aucun (prospect, rendez-vous, job) — voir
     * `boutonPourEntite`. L'aperçu « réel » montrait pourtant « Montant à
     * payer — 1 220,17 $ » et « Voir et payer » sur n'importe quel courriel
     * d'automatisation (audit du 2026-10-01), et « M'envoyer un essai »
     * envoyait ce même rendu : on validait une image fausse.
     */
    const declencheur = typeof req.body?.declencheur === 'string' ? req.body.declencheur : '';
    const automatisation = !type;
    const texteBouton = automatisation ? texteBoutonParDefaut(ENTITE_PAR_DECLENCHEUR[declencheur], fr ? 'fr' : 'en') : null;
    const html = rendreCourrielClient({
      langue: langueEntreprise(company),
      marque: marqueDepuis(company),
      corpsHtml: avecExemples(assainirHtmlCourriel(corps)),
      montant: automatisation ? null : { libelle: fr ? 'Montant à payer' : 'Amount due', valeur: fr ? '1 220,17 $' : '$1,220.17' },
      bouton: automatisation
        ? (texteBouton ? { texte: texteBouton, url: 'https://lumecrm.net/' } : null)
        : {
          texte: fr ? 'Voir et payer' : 'View and pay',
          url: 'https://lumecrm.net/',
          sousBouton: fr ? 'Carte de crédit · aucun compte à créer' : 'Credit card · no account needed',
        },
      signature: null,
    });
"""),
])

# ── Le client : l'éditeur dit quel déclencheur porte ce courriel ──
editer('src/lib/emailTemplatesApi.ts', [
("export async function apercuCourriel(corpsHtml: string, type?: string): Promise<string | null> {",
 "export async function apercuCourriel(corpsHtml: string, type?: string, declencheur?: string): Promise<string | null> {"),
("      body: JSON.stringify({ corpsHtml, type }),",
 "      body: JSON.stringify({ corpsHtml, type, declencheur }),"),
("export async function envoyerEssaiCourriel(corpsHtml: string, objet: string, type?: string): Promise<string | null> {",
 "export async function envoyerEssaiCourriel(corpsHtml: string, objet: string, type?: string, declencheur?: string): Promise<string | null> {"),
("      body: JSON.stringify({ corpsHtml, objet, type, envoyer: true }),",
 "      body: JSON.stringify({ corpsHtml, objet, type, declencheur, envoyer: true }),"),
])
editer('src/components/automations/EmailPreviewEditor.tsx', [
("  typeCourriel?: string;\n",
 "  typeCourriel?: string;\n  /** Le déclencheur de l'automatisation : l'aperçu montre le bouton que CE courriel portera (ou aucun). */\n  declencheur?: string;\n"),
("  ruleId, ruleName, body, subject, fr, onClose, onSaved, enregistrerTexte, typeCourriel,",
 "  ruleId, ruleName, body, subject, fr, onClose, onSaved, enregistrerTexte, typeCourriel, declencheur,"),
("      const adresse = await envoyerEssaiCourriel(texteVersHtml(blocsEnTexte(blocs)), objet, typeCourriel);",
 "      const adresse = await envoyerEssaiCourriel(texteVersHtml(blocsEnTexte(blocs)), objet, typeCourriel, declencheur);"),
("    void apercuCourriel(texteVersHtml(blocsEnTexte(blocs)), typeCourriel)",
 "    void apercuCourriel(texteVersHtml(blocsEnTexte(blocs)), typeCourriel, declencheur)"),
])
editer('src/components/automations/MessageEditor.tsx', [
("  /** Rechargement de la liste après enregistrement. */\n  onSaved: () => void;\n}",
 "  /** Rechargement de la liste après enregistrement. */\n  onSaved: () => void;\n  /** Le déclencheur de la règle, pour un aperçu fidèle du courriel (bouton de l'entité). */\n  declencheur?: string;\n}"),
("export default function MessageEditor({ ruleId, ruleName, actionType, body, subject, fr, onSaved }: Props) {",
 "export default function MessageEditor({ ruleId, ruleName, actionType, body, subject, fr, onSaved, declencheur }: Props) {"),
("            onClose={() => setEditeurOuvert(false)}\n            onSaved={onSaved}\n          />",
 "            onClose={() => setEditeurOuvert(false)}\n            onSaved={onSaved}\n            declencheur={declencheur}\n          />"),
])
editer('src/pages/Automations.tsx', [
("                                      fr={fr}\n                                      onSaved={load}\n                                    />",
 "                                      fr={fr}\n                                      onSaved={load}\n                                      declencheur={rule.trigger_event}\n                                    />"),
])
print('ok')
