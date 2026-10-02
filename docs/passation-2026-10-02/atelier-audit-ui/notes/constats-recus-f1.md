# Constats reçus de la session f1 (tournée prod du 2026-10-01, 1440x1000, FR) — À REVÉRIFIER
1. Liste → « Voir les messages » : aperçu COURRIEL rendu avec exemples, aperçu TEXTO montre les variables brutes. Incohérent.
2. /automations/nouvelle (Créer → Partir de zéro) affiche « Enregistré » alors qu'aucune ligne n'existe en base. Carte « Choisir le déclencheur » avec « Devis envoyé » déjà inscrit dessous.
3. « Anniversaire client » : sous-titre « Nouveau prospect · 12 mois après » (anniversaire calé sur la création du prospect).
4. Action SAUTÉE journalisée result_success=true + result_data.saute : tout code qui compte les succès se trompe (#839 a corrigé l'optimisation de journée).
5. OK : 4 onglets, Filtres avancés, menu Créer (3 choix), Nouveau dossier, Tout arrêter, menu ⋮ (Modifier / Dupliquer / Déplacer), Statistiques, tris, recherche, /automations/apercu, /automations/reglages, redirections hub/builder.
Pièges : signOut portée 'local' ; client supabase-js à part pour verifyOtp ; bannière de témoins à fermer d'abord.
