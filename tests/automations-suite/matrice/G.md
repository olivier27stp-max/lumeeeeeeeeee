# Matrice G — Conformité LCAP / Loi 25 et marque (suffixe `secu`)

Fichier : `integration/30-fgh-conformite.test.ts`.

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| G-001 | courriel marketing différé | drapeau `auto_desabonnement_canal` éteint | lien `/api/unsubscribe/<jeton>` + `List-Unsubscribe` + One-Click | PASS |
| G-002 | courriel marketing immédiat | drapeau éteint | idem | PASS après dd6000e1 (FAIL avant : aucun lien, aucun en-tête) |
| G-003 | courriel transactionnel immédiat | — | aucun lien de désabonnement (voulu) | PASS |
| G-004 | courriel marketing immédiat | drapeau allumé | lien + en-têtes | PASS |
| G-010 | désabonné courriel + STOP | drapeau éteint | aucun courriel ni texto, commercial ET transactionnel (étapes « sautées ») | PASS |
| G-011 | désabonné courriel + STOP | drapeau allumé | commercial sauté, transactionnel part | PASS |
| G-012 | texto marketing immédiat | drapeau éteint | « <Entreprise> - Répondez STOP pour ne plus recevoir. » ajouté | PASS |
| G-013 | request_review | client désabonné + STOP | rien ne part | PASS |
| G-014 | courriel marketing immédiat, client sans consentement ni relation | drapeau éteint | mesure : il part | PASS (mesure) |
| G-015 | idem | idem | ne devrait pas partir | ROUGE ATTENDU — décision requise : consentement et plafond de fréquence ne sont vérifiés que si `ctx.commercial` (envoi différé ou drapeau allumé). Proposition : `commercial = marketing` aussi en immédiat drapeau éteint (ou activer le drapeau pour toutes les entreprises) |
| G-020 | marque | logo + `brand_color` + nom | `<img alt=nom>`, couleur, nom ; nom d'expéditeur = entreprise | PASS |
| G-021 | traces de Lume | contenu VISIBLE (HTML sans `<style>` ni classes, texte, objet, Reply-To) | aucun « Lume », « Powered by », « Envoyé avec » | PASS — restent, invisibles au lecteur : classes CSS `lume-fond` / `lume-texte` du gabarit (source HTML) |
| G-022 | petit mascot Lume en bas du courriel | — | présent | ROUGE ATTENDU — décision requise : exigence de Rafba vs norme « marque blanche côté client » du 2026-09-30 (mascot retiré le 2026-09-29, `server/lib/courriels/gabarit.ts`) |
| G-023 | adresse d'expédition | entreprise sans domaine vérifié | pas `@lumecrm.net` | ROUGE ATTENDU — décision requise : contrainte technique (SPF/DKIM de la plateforme) ; seul un domaine vérifié par l'entreprise (`senderForOrg`, PR #524) l'évite. Les liens publics (désabonnement, /quote, /invoice, /survey) sont aussi sur le domaine de Lume (PUBLIC_URL) |
