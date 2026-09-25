# Migration accompagnée — mode d'emploi de l'admin en six gestes

Console : Creator Space › Migrations (l'ancienne URL `/admin/migrations` redirige). La carte « Marche à suivre » de l'onglet Résumé reprend ces six gestes et allume l'étape courante.

1. **Confier au bot.** Onglet Résumé › carte Bot. Il relit les correspondances, tranche les doublons évidents et lance l'import test. S'il s'arrête, il dit pourquoi dans son rapport.
2. **Rejets.** Onglet Imports › `rejects.csv`. Chaque ligne exclue porte la référence manquante (par exemple `job introuvable : « #4512 »`). Les numéros de job absents se lisent directement dans la colonne `erreur`.
3. **Approbation.** Demandez l'approbation au client depuis la console, ou approuvez en son nom avec son accord écrit.
4. **Import final.** Saisissez le nom exact du workspace pour confirmer. L'import tourne en arrière-plan, la progression s'affiche dans Imports. Dès ce moment le bureau est en communications gelées.
5. **Vérification.** Dans le CRM du client : Clients, Jobs, Calendrier (visites aux bonnes dates), Factures, Devis. Comparez aux compteurs du rapport final.
6. **Activer le compte.** Lève le gel : courriels, SMS et automatisations repartent vers les clients. Seulement après la vérification.

## Ce qu'il faut savoir

- **Reprendre après un échec** : depuis « Échouée », bouton Reprendre l'import final, puis relancer. C'est idempotent, jamais de doublon. Ne pas faire Rollback pour ça.
- **Rollback** : annule tous les lots finaux (créés supprimés, valeurs d'avant restaurées, pins de carte purgés). Ensuite « Reprendre après rollback » remet la migration en correspondance.
- **Import test déjà en cours** : la console répond « Un import test est déjà en cours » si le bot ou un autre admin en a lancé un. Attendre la fin dans Imports.
- **Message du gel** vu par l'utilisateur qui essaie d'envoyer un devis ou un SMS avant l'activation : « Communications gelées : les données viennent d'être importées et le compte n'est pas encore activé. Cliquez « Activer le compte » dans la console des migrations. »

## Périmètre au lancement, à dire tel quel aux utilisateurs

- Notes, pièces jointes, étiquettes, champs personnalisés et demandes de service ne s'importent pas.
- Les plans récurrents deviennent des jobs récurrents, sans contrat de service.
- Excel : seule la première feuille est lue.
- Un fichier dépasse rarement 20 000 lignes. Au-delà, le scinder (maximum absolu 50 000 lignes par fichier).

## Message de lancement retenu

« Import accompagné » : l'équipe Lume fait la migration avec le client, à partir de ses exports, et l'active quand tout est vérifié. Pas « importez vous-même ». Le libre-service (approbation et import par le client, sans nous) est un chantier séparé de quelques jours, voir `docs/audits/AUDIT_IMPORT_CSV_GHL_2026-09-24.md`.
