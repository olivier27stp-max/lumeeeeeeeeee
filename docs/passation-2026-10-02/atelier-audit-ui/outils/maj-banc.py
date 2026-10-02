import io
def maj(p, paires):
    s = io.open(p, encoding='utf-8', newline='').read()
    for a, b in paires:
        if s.count(a) != 1:
            raise SystemExit('%s : %d occurrence(s) de %r' % (p, s.count(a), a[:50]))
        s = s.replace(a, b)
    io.open(p, 'w', encoding='utf-8', newline='').write(s)

maj('e2e/automations/_outils/banc.ts', [
    (" * Tout tourne sur STAGING, en bac à sable : aucun envoi réel n'est possible.",
     " * Tout tourne sur la PILE LOCALE (scripts/qa/automations-e2e/), en bac à sable : ni staging, ni\n * prod, et aucun envoi réel n'est possible."),
    ("  /** Client service_role (staging) : lectures de vérification et préparation de données. */",
     "  /** Client service_role (pile locale) : lectures de vérification et préparation de données. */"),
    (" * Une panne de l'ENVIRONNEMENT (staging saturé, Supabase qui coupe une requête),",
     " * Une panne de l'ENVIRONNEMENT (base saturée, requête coupée, poste à court de tampons réseau),"),
    ("    if (!URL_SB() || URL_SB().includes(REF_PROD)) throw new Error('REFUS : E2E des automatisations = STAGING seulement.');",
     "    if (!URL_SB() || URL_SB().includes(REF_PROD) || !ADRESSE_LOCALE.test(URL_SB())) {\n      throw new Error('REFUS : les E2E des automatisations tournent sur la pile LOCALE seulement (node scripts/qa/automations-e2e/lancer.mjs).');\n    }"),
    ("const REF_PROD = 'bbzcuzqfgsdvjsymfwmr';\nconst URL_SB",
     "const REF_PROD = 'bbzcuzqfgsdvjsymfwmr';\n/** Staging est tombé deux fois sous ces tests (2026-10-01) : ils ne visent plus qu'une base locale. */\nconst ADRESSE_LOCALE = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/;\nconst URL_SB"),
])
maj('e2e/automations/_outils/demarrage.ts', [
    ("  if (!url || url.includes(REF_PROD)) throw new Error('REFUS : les E2E des automatisations tournent sur STAGING seulement (VITE_SUPABASE_URL).');",
     "  if (!url || url.includes(REF_PROD) || !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(url)) {\n    throw new Error('REFUS : les E2E des automatisations tournent sur la pile LOCALE seulement (node scripts/qa/automations-e2e/lancer.mjs).');\n  }"),
])
maj('e2e/automations/playwright.config.ts', [
    (" * fournisseur réel + Vite), base STAGING, bureaux de test en bac à sable :",
     " * fournisseur réel + Vite), base LOCALE jetable (scripts/qa/automations-e2e/pile.sh — ni staging,\n * ni prod), bureaux de test en bac à sable :"),
    (" * E2E de la section Automatisations — `npm run test:automations:e2e`.",
     " * E2E de la section Automatisations — `npm run test:automations:e2e:local`."),
])
print('ok')
