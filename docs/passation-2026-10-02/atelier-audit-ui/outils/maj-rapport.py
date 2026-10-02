# -*- coding: utf-8 -*-
import io
p = 'D:/lume-uiaudit/wt-lumi/AUTOMATIONS_UI_AUDIT.md'
s = io.open(p, encoding='utf-8', newline='').read()
nl = '\r\n' if '\r\n' in s else '\n'


def rempl(a, b):
    global s
    a = a.replace('\n', nl)
    b = b.replace('\n', nl)
    if s.count(a) != 1:
        raise SystemExit('%d occurrence(s) de : %s' % (s.count(a), a[:70].encode('ascii', 'replace')))
    s = s.replace(a, b)


rempl("66 tests marqués ainsi ce matin", "{{MARQUES_RETIREES}} tests marqués ainsi ce matin")

rempl("| `70-journaux-causes` | onglet Journaux : deux causes écrites en anglais par le moteur sont lues en français | 0/1 | 1/1 |\n",
      "| `70-journaux-causes` | onglet Journaux : deux causes écrites en anglais par le moteur sont lues en français | 0/1 | 1/1 |\n"
      "| `80-publication` | liste : publier puis repasser en brouillon avec l’interrupteur, la base relue à chaque fois, rechargement compris — avant et après la migration de garde | 3/3 | 3/3 |\n")

a = s.index("Ces scripts sont maintenant dans le dépôt")
b = s.index("Tests unitaires et de composant ajoutés par les correctifs")
s = s[:a] + (
    "Ces scripts sont dans le dépôt (`scripts/qa/automations-prod/`) et se lancent d’une commande : **`npm run test:automations:e2e`** — "
    "68 vérifications, toutes réussies à la dernière passe (2026-10-01, 23 h 21 → 23 h 31 UTC), sortie en JSON et en markdown. "
    "C’est une passe **après déploiement** : elle juge ce qui est en ligne. Depuis la panne du 1er octobre (§ 4) elle tourne un script à la fois, "
    "lit `/api/health` avant chacun, garde une session par rôle et s’arrête d’elle-même au premier 429 ou dès que la base dépasse 1 500 ms." + nl + nl) + s[b:]

rempl("**membre « lecture + modification » : voir § 6** |",
      "membre « lecture + modification » : la base lui refuse désormais de publier, de se déclarer « fournie » et de supprimer (garde du § 5) ; le contenu d’une règle reste inscriptible en direct (§ 1, point 2) |")

rempl("Incident à signaler : le 1er octobre, six agents en parallèle sur staging ont saturé sa base (503) ; elle a été redémarrée, sans effet sur la prod. Depuis : une seule passe à la fois, et plus aucune sur staging.",
      "Incidents à signaler, tous du 1er octobre :\n\n"
      "- **Staging, le matin** : six agents en parallèle ont saturé sa base (503) ; elle a été redémarrée, sans effet sur la prod.\n"
      "- **Prod, 20 h 36 → 21 h 41 UTC : base injoignable pendant une heure.** Trois sessions testaient la prod en même temps ; de mon côté, une passe complète du vrai site (dix scripts d’affilée, une vingtaine d’ouvertures de session, trois 429) puis un script de 17 chargements de page tournaient dans le quart d’heure précédent. La cause exacte n’est pas établie ; le projet Supabase a été redémarré avec ton accord par une autre session. Depuis : contre la prod, un seul flux à la fois, santé lue avant et pendant, arrêt au-dessus de 1 500 ms — c’est écrit dans le lanceur.\n"
      "- **Staging, 22 h 07 → 22 h 20 UTC** : injoignable sous les jobs « Automatisations » de plusieurs PR poussées ensemble (#886 les a retirés des PR).\n\n"
      "Conséquence : la passe complète ne vise plus ni staging ni la prod. Elle tourne sur une base **locale** jetable (schéma de la prod rejoué, deux tables de référence, aucune donnée de client), et le banc refuse toute autre adresse. Mes 16 bureaux de test de staging sont retirés (désactivés, rien d’effacé).")

rempl("| #881 (lot 4) | aucune cause d’échec en anglais brut dans la liste ni dans l’onglet Journaux (14 messages du moteur + 10 causes relevées dans les journaux de prod) | oui, 20:08 UTC |\n",
      "| #881 (lot 4) | aucune cause d’échec en anglais brut dans la liste ni dans l’onglet Journaux (14 messages du moteur + 10 causes relevées dans les journaux de prod) | oui, 20:08 UTC |\n"
      "| #889 (lot 5) | onglet « Modèles » → « Prêtes à publier » ; confirmation « Publier avec le texte d’exemple ? » quand une étape n’a pas été rédigée ; « publiée » ne s’écrit plus que par le serveur | oui, 22:34 UTC |\n"
      "| migration `20261007300000` | garde en base sur `automation_rules` : une session d’utilisateur ne peut plus publier, insérer une règle publiée ou « fournie », changer le bureau ou le statut « fournie », changer le déclencheur ou mettre à la corbeille une règle fournie, purger hors corbeille, ni supprimer pour de bon. 16 écritures jouées avec le rôle d’une session : 7/16 avant, 16/16 après — pile locale, staging, prod | staging 22:35, prod 22:36 UTC |\n")

a = s.index("## 6. Ouvert — à décider")
b = s.index("## 6 bis.")
lignes = [
    "## 6. Ouvert",
    "",
    "**A. Les défauts sortis de la passe complète** — {{DEFAUTS_TOTAL}} défauts, {{ROUGES_TOTAL}} tests rouges. Le détail est dans `e2e/automations/_tri/` (un fichier par dossier). Les majeurs :",
    "",
    "| Où | Ce qui se passe | Preuve |",
    "|---|---|---|",
    "| Éditeur | « Ouvrir » une 2e automatisation sur réseau lent écrit le nom et le parcours de la 1re dans la 2e (S-01) | `editeur/` |",
    "| Éditeur | Deux onglets sur la même règle : le second écrase le premier, sans avertir (S-13) | `editeur/` |",
    "| Éditeur | Après un 429, aucun nouvel essai : l’écran reste sur « Enregistrement… », la modification n’atteint jamais la base | `editeur/12-enregistrement` |",
    "| Éditeur | Parcours converti du format d’origine : supprimer la dernière étape la fait revenir ; une règle publiée peut être vidée | `editeur/05b` |",
    "| Éditeur | Lumi remplace un parcours PUBLIÉ sans poser de question (S-03) | `editeur/07` |",
    "| Éditeur | « Arrêter ici » au milieu fait disparaître la suite ; une condition supprimée laisse sa branche orpheline (S-12) | `editeur/` |",
    "| Éditeur | La pause globale est invisible dans l’éditeur (S-32) ; « Précédent » avec une étape incomplète perd le travail | `editeur/` |",
    "| Actions | Automatisation PUBLIÉE : une action choisie dans le tiroir part en ligne 3 s plus tard avec son texte d’exemple, sans avoir été enregistrée | `actions/06-publication` |",
    "| Actions, messages | Corriger un texto laisse l’ancien texte anglais en base, invisible ; c’est lui qui part aux clients d’un bureau en anglais | `actions/08`, `modeles/` |",
    "| Actions | Un courriel fourni, à la conversion, s’ouvre en HTML brut | `actions/08` |",
    "| Actions, déclencheurs | « Attendre » : effacer « 3 » et taper « 5 » transforme 3 jours en 5 minutes | `actions/05`, `declencheurs/05` |",
    "| Actions | Une saisie que le serveur refuse (nombre hors bornes, adresse en http://) est acceptée par le panneau ; l’enregistrement échoue ensuite en boucle et bloque tout le parcours | `actions/03` |",
    "| Actions, déclencheurs | « Date atteinte » sur un champ du pipeline : le tiroir offre des actions d’opportunité que la publication refuse ; « Appel reçu de l’extérieur » : six actions impossibles ne sont ni grisées ni refusées | `actions/01`, `declencheurs/06` |",
    "| Déclencheurs | Filtre : taper « 12.5 » enregistre 125 ; minimum 5 000 $ et maximum 100 $ acceptés | `declencheurs/04`, `/03` |",
    "| Déclencheurs | Étape « Si… » : les conditions « est l’un de » sont invisibles puis effacées à l’enregistrement suivant ; une ligne mal écrite est jetée sans un mot | `declencheurs/05` |",
    "| Déclencheurs | « Date atteinte » sur un champ supprimé : la publication est proposée | `declencheurs/06` |",
    "| Messages | Modifier le premier de deux textos (ou courriels) d’une automatisation recopie son texte dans le second | `modeles/` |",
    "| Messages | L’aperçu réel d’un courriel affiche « Coquin lavage » pour [company_name] dans tous les bureaux (exemple écrit en dur) — déjà corrigé sur la branche de correction | `modeles/04` |",
    "| Modèles | « Relance de devis — 1, 2, 5, 10 et 30 jours » s’ouvre sur 180 cartes pour 23 étapes (chaque « Si » redessine toute la suite) | `modeles/02` |",
    "{{LISTE_MAJEURS}}",
    "| Rôles | Écritures directes en base encore possibles : déclencheur hors catalogue, texto de 5 000 caractères, texto vidé d’une règle publiée, suppression dure d’une adresse d’appel, brouillon créé sans le forfait ; un technicien sans droit sur les clients modifie leurs étiquettes | `roles/40`, `/50`, `/55`, `/20` |",
    "",
    "**B. Décisions et restes de la tournée**",
    "",
    "1. **« Anniversaire client »** part 12 mois après la création de la fiche, pas à l'anniversaire du client (liste-12) : le sous-titre le dit, le nom non. Décision de produit.",
    "2. **Texte anglais « New lead… »** des notifications déjà semées dans les bureaux existants (roles-13) : corrigé pour les nouveaux bureaux ; les anciens demandent une migration de données sur de vrais bureaux — ton accord d'abord.",
    "3. **Tout rôle peut annoncer « visite déplacée »** (roles-14) : sans effet si la visite n'a pas bougé, mais la route n'exige aucun droit.",
    "4. **Table des gardes de l'API** : elle ne reconnaît comme paramètre qu'un uuid, un nombre ou un segment de plus de 10 caractères ; un identifiant court passe hors table. Sans conséquence aujourd'hui (les routes concernées ont leur propre contrôle) ; la durcir touche toute l'API, pas seulement les automatisations — non fait à trois semaines du launch sans une passe de toutes les routes.",
    "5. **Verrou de session** (P-001) : supabase-js lève « Lock broken by another request with the 'steal' option » — vu à chaque page sur Firefox, deux fois sur une dizaine de passes sur Chromium (Vue d'ensemble), une fois avec un blocage de 60 s sur « Chargement de l'espace… ». Cause non établie.",
    "6. **Titre anglais « Workflows list »** à côté d'un menu « Automations » (P-002) : cosmétique.",
    "7. **Base de référence du dépôt en retard** : `supabase/baseline/` date du 26 septembre (77 migrations de retard, une colonne de `plans` manquante). La pile locale rejoue les migrations par-dessus ; à régénérer après la dernière migration de la série en cours.",
    "8. **`check:db-coherence` annonce 4 écarts sans rapport avec cet audit** : `commissions_totaux_periode()`, `quickbooks_claim_jobs()`, `quickbooks_enqueue()`, `quickbooks_enqueue_history()` appelées par le code et non exécutables par une session.",
    "",
    "",
]
s = s[:a] + nl.join(lignes) + s[b:]

a = s.index("## 7. Non testé")
b = s.index("## 8. Tableau des constats")
lignes = [
    "## 7. Non testé",
    "",
    "- La matrice de la passe complète hors « bureau » : iPad, téléphone, Firefox, Safari (projets prêts dans `e2e/automations/playwright.config.ts`, jamais lancés en entier).",
    "- Les parcours qui demandent deux bureaux réels en prod (« Copier vers d'autres bureaux ») : couverts en local, pas sur le vrai site (un seul bureau de test en prod).",
    "- « M'envoyer un essai » sur le vrai site (enverrait un vrai courriel, même à soi) ; en local il part dans un serveur de courriel piège.",
    "- L'envoi réel de textos : Twilio n'est pas configuré en prod ; les étapes texto sont sautées et l'écran le dit.",
    "- Les vraies réponses de Lumi dans l'éditeur pendant la passe complète (simulées, faute de clé d'IA en local).",
    "- Téléverser une image dans un courriel (pas de stockage de fichiers en local).",
    "- Volume (D-17) : pas d'essai de charge.",
    "- Le job de CI « Automatisations » (intégration sur staging) n'a validé aucun des lots de cet audit : annulé à chaque merge rapproché, puis retiré des PR.",
    "",
    "",
]
s = s[:a] + nl.join(lignes) + s[b:]
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
