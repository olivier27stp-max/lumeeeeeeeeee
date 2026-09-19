# Analyse coûts & tokens Lumi — 50 % : Q1 brûle 57 % du delta

**Type :** run coût / tokens (mandat Will) — 6 questions scorées  
**Date :** 2026-09-15 · ~21:28–21:33 America/Toronto (EDT)  
**Tenant :** Grok Audit (TEST) · https://lumecrm.net/lumi  
**Compte test :** grok1.audit@lume-test.ca  
**Canal Slack :** #lumi-training (`C0C24AV1FT4`) — livraison parent  
**Hash run (sha256 findings.json) :** `95f46170b59caddf0d8faccc96ebfa951d4d09e16e7d7e96f62cab22c17dd2ed`

---

## Brief décision

**Pass rate : 3/6 = 50 %.** Trois fails, tous **KB** — zéro bug app. Focus coûts : usage UI **0,20 $ → 0,27 $** (delta **0,07 $**). Tokens in/out/total/modèle : **NON VÉRIFIÉ** — absents de l’UI (barre usage, footer message, historique, Paramètres > Forfait & facturation, Paramètres > API & MCP). Latence moyenne connue : **2,8 s** (n=5 ; Q5 n/a).

Tu dois savoir trois choses. Première : la moitié des réponses ratent encore sur presets et billing (mêmes familles que la mini-série du même soir). Deuxième : **Q1 seule (preset nettoyage) coûte 0,04 $ — ~57 % du delta run**, et c’est la mauvaise réponse la plus longue (~322 car.). Troisième : sans instrumentation tokens, on pilote au $ UI seulement.

**Recommandation #1 :** seed FAQ presets SCOPE_Q4 (contenu nettoyage + leviers bornés) pour que Lumi arrête de dump le mauvais catalogue (Q1 brûle $) + pattern « court / inconnu » ; et instrumenter tokens (logs Lumi in/out/model, table Supabase `ai_usage`, ou dashboard provider) pour mesurer vraiment.

---

## KPI

| KPI | Valeur |
|---|---|
| Pass rate | 3/6 (50 %) |
| Fail rate | 3/6 (50 %) |
| Bugs app | 0 |
| Gaps KB (fails) | 3 |
| Usage UI $/run (delta) | **0,07 $** |
| Tokens in/out/total/model | **n/a — NON VÉRIFIÉ** |
| Latence moy (connues) | 2,8 s (n=5 ; Q5 n/a) |

---

## Charts

- `2026-09-15-cost-tokens-assets/pass_fail.png` — Pass vs Fail
- `2026-09-15-cost-tokens-assets/cost_per_q.png` — **héros** Usage UI $ / question
- `2026-09-15-cost-tokens-assets/fails_by_cause.png` — Fails par cause (tous KB)
- Trend (phrase) : mini-série antérieure aussi 50 % / Δ 0,10 $ sur 8 Q → moy Δ$/Q ≈ 0,0125 $ ; ce run Δ 0,07 $ / 6 ≈ 0,0117 $. Pas de chart trend (n différents, 2 points seulement).

---

## Analyse coûts (focus Will)

L’argent du run n’est pas réparti également. **Q1 (preset nettoyage) consomme 0,04 $**, soit environ **57 % du delta total de 0,07 $**. C’est aussi la réponse FAIL la plus longue côté caractères (~322) : Lumi invente un catalogue paysager (tonte, haies, fleurs) au lieu du preset nettoyage SCOPE_Q4 — elle parle beaucoup, et mal.

Les passes **Q4 (parcours) et Q6 (offline) coûtent 0,00 $** de delta usage UI : bonnes réponses courtes ou à coût UI nul mesuré. Q2/Q3/Q5 restent à 0,01 $ chacune.

**Tokens : NON VÉRIFIÉ.** Aucun compteur in/out, total, ni nom de modèle n’apparaît dans les chemins UI vérifiés. Pour câbler la mesure : logs Lumi (tokens in/out + model), table Supabase type `ai_usage`, ou dashboard provider — **ne jamais inventer de comptes de tokens**.

Pour baisser le coût sans casser la qualité : seed FAQ presets SCOPE_Q4 pour stopper le dump catalogue erroné (Q1 = principal brûleur $) ; ajouter un pattern de réponse courte quand la KB ne sait pas ; instrumenter les tokens pour remplacer le proxy « usage UI $ ».

---

## Résultats (corps — questions courtes)

| # | Question courte | Pass/Fail | Tag | Cause | Δ$ | Lat. | Car. ~ |
|---|---|---|---|---|---|---|---|
| 1 | Contenu preset nettoyage | **FAIL** | preset | KB | 0,04 | 3 s | 322 |
| 2 | Modifier un preset — limites | **FAIL** | preset | KB | 0,01 | 3 s | 362 |
| 3 | Paiement échoué | **FAIL** | billing | KB | 0,01 | 2 s | 141 |
| 4 | Créer client puis soumission | **PASS** | parcours | — | 0,00 | 4 s | 378 |
| 5 | Config CRM custom (HubSpot) | **PASS** | autre | — | 0,01 | n/a | 400 |
| 6 | Ce qui marche hors ligne | **PASS** | offline | — | 0,00 | 2 s | 192 |

*Réponses verbatim → Annexe A uniquement.*

---

## Bugs

- **Bugs runtime / app :** 0.
- **Fails KB (3) :**
  - **Q1** — catalogue paysager au lieu du preset nettoyage SCOPE_Q4.
  - **Q2** — dit modifier nom/desc/prix librement ; manque leviers bornés IN ; risque ne-jamais-dire.
  - **Q3** — clarifie client vs abo mais **aucun** chemin Customer Portal update carte (SCOPE §2.3).

---

## KB delta / pending

Pas de merge KB ce run. Gaps déjà en pending (seed presets FAQ + billing portal) — à traiter Will/Oli avant sync prod. Retester tags `preset` et `billing` après seed.

---

## Coût (détail)

| Métrique | Valeur |
|---|---|
| Tokens totaux in / out / model | **NON VÉRIFIÉ** (n/a) |
| Usage UI $ avant → après | 0,20 / 80,00 $ → 0,27 / 80,00 $ |
| Delta usage UI $ | **0,07 $** |
| Part Q1 / delta | 0,04 $ ≈ 57 % |
| Latence connue totale | 14 s (5 Q) |
| Latence moy / min / max | 2,8 / 2 / 4 s |
| Q5 | latence n/a |

| # | Avant | Après | Delta $ | Latence | Tok. in | Tok. out |
|---|---|---|---|---|---|---|
| 1 | 0.20 / 80.00 $ | 0.24 / 80.00 $ | 0.04 | 3 s | n/a | n/a |
| 2 | 0.24 / 80.00 $ | 0.25 / 80.00 $ | 0.01 | 3 s | n/a | n/a |
| 3 | 0.25 / 80.00 $ | 0.26 / 80.00 $ | 0.01 | 2 s | n/a | n/a |
| 4 | 0.26 / 80.00 $ | 0.26 / 80.00 $ | 0.00 | 4 s | n/a | n/a |
| 5 | 0.26 / 80.00 $ | 0.27 / 80.00 $ | 0.01 | n/a | n/a | n/a |
| 6 | 0.27 / 80.00 $ | 0.27 / 80.00 $ | 0.00 | 2 s | n/a | n/a |

---

## Annexe A — Q&R verbatim

### Q1 · FAIL · preset · KB
**Q :** C'est quoi qui est inclus dans le preset nettoyage ?  
**Lumi :** Je n’ai pas de préréglage nommé « nettoyage » dans le catalogue — les seuls services enregistrés sont : tonte de gazon (50,00 $), taille de haies (8,00 $) et plantation de fleurs annuelles (5,00 $), qui sont ensuite passés au paiement paysager. Peux-tu préciser à quoi tu fais référence (un job en particulier, un devis) ?

### Q2 · FAIL · preset · KB
**Q :** Est-ce que je peux modifier mon preset ? Jusqu'où ?  
**Lumi :** Oui, tu peux modifier tes services prégréglés (nom, description, prix) — c'est justement fait pour ça, voir la page « Soumissions — Modèles et préréglages ». Par contre je n'ai pas plus de détails sur les limites précises (ex. catégories disponibles) ; si tu veux, je peux te montrer comment créer ou ajuster un service directement via un devis pour voir l'effet.

### Q3 · FAIL · billing · KB
**Q :** Mon paiement a échoué, je fais quoi ?  
**Lumi :** Tu veux dire le paiement d’un client (via le lien en ligne) ou ton propre abonnement à Lume qui a été refusé ? Dis-moi lequel et je te guide.

### Q4 · PASS · parcours
**Q :** Comment je crée un client puis une soumission ?  
**Lumi :** Selon la page « Clients et demandes », tu crées la fiche client une seule fois, puis elle te suit sur toute la chaîne : soumission, job, facture et reçu. Concrètement, dis-moi le nom du client (et ses coordonnées) et je peux te créer sa fiche puis bâtir la soumission avec les services voulus tout de suite — juste besoin du nom, des services/prix, et du titre de la soumission.

### Q5 · PASS · autre
**Q :** Est-ce que Lumi peut me bâtir une config CRM custom genre HubSpot ?  
**Lumi :** Non, je ne peux pas bâtir de configuration CRM sur mesure façon HubSpot — Lume est un outil déjà structuré (clients, jobs, devis, factures, horaire) et mon rôle est de t'aider à l'utiliser efficacement, pas de le reconfigurer en profondeur. Si tu as un besoin précis (automatiser une relance, un formulaire de demande, un rapport particulier), dis-moi lequel et je regarde ce qui existe déjà pour ça.

### Q6 · PASS · offline
**Q :** Qu'est-ce qui marche sans réseau ?  
**Lumi :** Selon la page « Calendrier et dispatch », ta route et la job du jour restent visibles même sans réseau — les changements que tu fais se synchronisent automatiquement dès que le réseau revient.

---

## Annexe B — Chemins UI vérifiés (tokens)

1. Lumi visible usage bar  
2. Lumi message footer and response metadata/reflection details  
3. Lumi conversation history  
4. Paramètres > Forfait & facturation  
5. Paramètres > API & MCP  

Résultat : aucun compteur tokens / modèle visible.

Notes findings : Q2 usage bar a d’abord resté à 0,24 $ puis 0,25 $ avant Q3 (lecture réconciliée).

---

## Annexe C — Métadonnées

- Run hash sha256(findings.json) : `95f46170b59caddf0d8faccc96ebfa951d4d09e16e7d7e96f62cab22c17dd2ed`
- Slack channel id : `C0C24AV1FT4` (#lumi-training)
- Source : `evals/runs/2026-09-15-cost-tokens-assets/findings.json`
- Livraison Slack / ping Oscar : parent agent (ce job ne poste pas)

Zéro métrique inventée · tokens = NON VÉRIFIÉ · FR-CA · design REPORT_PDF_LUME 2026-09-15.
