Trois constats de l'audit du 2026-10-01, hors de l'écran Automatisations lui-même. Chacun a son test, rouge sur l'ancien code.

## 1. Le diagnostic ne montre plus les identifiants de la plateforme
`GET /api/automations/test` renvoyait à l'admin de n'importe quel bureau le début du SID Twilio, le numéro et l'identifiant SMTP de Lume. Il répond maintenant « Configured » ou non, sans identifiant. Aucun écran n'appelle cette route.

## 2. Un forfait illisible n'affiche plus le mur de vente à un client qui paie
Observé pendant l'audit : `GET /api/billing/plans` en panne (500) → l'éditeur d'automatisations d'un bureau Autopilot remplacé par « Passer à Scale », état gardé en cache. Abonnement présent + forfait introuvable est maintenant traité comme une lecture ratée : on laisse passer (le serveur revérifie les droits à chaque appel, `subscription-guard`), rien n'est mis en cache, le montage suivant relit.

Inchangé : aucun abonnement → mur de vente ; forfait lu qui n'inclut pas la fonction → mur de vente.

## 3. L’éditeur de courriel ne signale plus comme inexistante une variable que le moteur remplit
Vu sur lumecrm.net en ouvrant le courriel de l’automatisation fournie « Confirmation de rendez-vous » : « Cette variable n’existe pas : [appointment_address] ». L’éditeur ne connaissait que les huit raccourcis de sa palette. Pour une automatisation, toutes les variables que le moteur remplit sont connues (y compris {{soumission.total}}…). Une faute de frappe reste signalée ; un modèle de courriel garde sa liste stricte.

## Vérifications
- `tests/automatisations-diagnostic-sans-identifiants.test.ts` (3), `tests/forfait-inconnu-pas-de-mur-de-vente.test.tsx` (5), `tests/emails/editeur-variable-existante-pas-signalee.test.tsx` (6).
- Aucune migration.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
