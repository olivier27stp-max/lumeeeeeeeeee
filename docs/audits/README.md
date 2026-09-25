# Audits et cartes

Documents produits pendant des missions d'audit en lecture seule. Ils vivaient
à la racine du dépôt sans être versionnés — donc invisibles pour quiconque
clone le projet, et perdus au premier nettoyage.

⚠️ **Un audit décrit l'état du code au jour où il a été écrit.** Plusieurs
constats ont été corrigés depuis, d'autres non. Avant d'agir sur une ligne de
ces documents, vérifier dans le code : le 2026-09-19, `AUTOMATIONS_AUDIT.md`
annonçait F6 et F7 comme « corrigé », alors que ni l'interrupteur d'arrêt
(`AUTOMATIONS_ENABLED`) ni la notion de consentement marketing n'existent dans
`server/`. Le correctif a été planifié ou fait sur une branche jamais fusionnée.

| Document | Date | Sujet |
|---|---|---|
| `AUTOMATIONS_AUDIT.md` | 2026-09-13 | 26 failles des automatisations (F1–F26), par gravité |
| `AUTOMATIONS_MAP.md` | 2026-09-13 | Cartographie du moteur : déclencheurs, actions, file |
| `AUTOMATIONS_TEST_PLAN.md` | 2026-09-13 | Plan de test dont sont issus les tests en quarantaine |
| `COST_AUDIT.md` | 2026-09-15 | Leviers de coût token, mesurés par `count_tokens` |
| `2026-09-15-cost-tokens.md` + `.json` | 2026-09-15 | Relevés bruts qui étayent `COST_AUDIT.md` |
| `AGENT_MAP.md` | 2026-09 | Points d'appel LLM et leur cheminement |
| `AGENTFORCE_GAP.md` | 2026-09 | Écarts face à Salesforce Agentforce |
| `SALESFORCE_GAP.md` | 2026-09 | Écarts fonctionnels face à Salesforce |
| `PLAN_BOT_MIGRATION.md` | 2026-09 | Plan du bot de migration (livré, PR #378/#379) |
| `PLAN_GROK_MCP.md` | 2026-09 | Plan du serveur MCP |

Les tests exécutables tirés de l'audit des automatisations sont dans
`tests/quarantaine/` — ils échouent volontairement et documentent les failles
qui restent ouvertes.
