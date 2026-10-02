import io
p = 'D:/lume-uiaudit/wt-lumi/scripts/qa/verifier-garde-automatisations.mjs'
s = io.open(p, encoding='utf-8', newline='').read()
def rempl(a, b):
    global s
    if s.count(a) != 1:
        raise SystemExit('%d occurrence(s) de %r' % (s.count(a), a[:60]))
    s = s.replace(a, b)

rempl(" *   node --env-file=.env.local scripts/qa/verifier-garde-automatisations.mjs --prod   → prod\n",
      " *   node --env-file=.env.local scripts/qa/verifier-garde-automatisations.mjs --prod   → prod\n"
      " *   … --etendue   → l'état VISÉ après la fermeture complète (audit des rôles, 2026-10-01) : plus AUCUNE\n"
      " *                   écriture de session sur automation_rules ni suppression dure d'une adresse d'appel.\n"
      " *                   Rouge tant que le contenu d'une règle s'écrit encore avec la session de l'utilisateur.\n")
rempl("const prod = process.argv.includes('--prod');\n",
      "const prod = process.argv.includes('--prod');\nconst etendue = process.argv.includes('--etendue');\n")
rempl("];\n\nconst blocs = TENTATIVES.map(",
      "];\n"
      "if (etendue) {\n"
      "  // État visé : le contenu d'une règle ne s'écrit plus que par le serveur. Ce qui était « accepté » devient « refusé ».\n"
      "  for (const t of TENTATIVES) t[1] = 'refusé';\n"
      "  const texto = (corps) => `jsonb_build_array(jsonb_build_object('id', 'e1', 'type', 'action', 'suivant', null, 'action', jsonb_build_object('type', 'send_sms', 'config', jsonb_build_object('body', ${corps}))))`;\n"
      "  TENTATIVES.push(\n"
      "    ['poser un déclencheur hors catalogue sur SA règle', 'refusé', `update automation_rules set trigger_event = 'declencheur.inexistant' where id = :libre`],\n"
      "    ['écrire un texto de 5 000 caractères dans SA règle', 'refusé', `update automation_rules set steps = ${texto(\"repeat('a', 5000)\")} where id = :libre`],\n"
      "    ['vider le texto d’une règle PUBLIÉE (elle resterait publiée)', 'refusé', `update automation_rules set steps = ${texto(\"''\")} where id = :publiee`],\n"
      "    ['supprimer pour de bon une adresse d’appel (DELETE)', 'refusé', `delete from automation_webhooks where id = :adresse`],\n"
      "  );\n"
      "}\n\nconst blocs = TENTATIVES.map(")
rempl("requete.replace(/:libre/g, 'v_libre').replace(/:fournie/g, 'v_fournie').replace(/:org/g, 'v_org')",
      "requete.replace(/:libre/g, 'v_libre').replace(/:fournie/g, 'v_fournie').replace(/:publiee/g, 'v_publiee').replace(/:adresse/g, 'v_adresse').replace(/:org/g, 'v_org')")
rempl("    v_fournie uuid;\n    v_n int;\n",
      "    v_fournie uuid;\n    v_publiee uuid;\n    v_adresse uuid;\n    v_n int;\n")
rempl("\n    -- La session d'un membre : rôle authenticated",
      "\n    ${etendue ? `-- Mode étendu : une règle PUBLIÉE et une adresse d'appel de test (jamais visibles hors de cette transaction).\n"
      "    insert into automation_rules (org_id, name, trigger_event, conditions, delay_seconds, actions, steps, is_active, is_preset)\n"
      "      values (v_org, '[garde] règle publiée', 'quote.declined', '{}', 0, '[]', '[]', true, false) returning id into v_publiee;\n"
      "    insert into automation_webhooks (org_id, name) values (v_org, '[garde] adresse') returning id into v_adresse;` : ''}\n"
      "\n    -- La session d'un membre : rôle authenticated")
rempl("    delete from automation_rules where id in (v_libre, v_fournie);\n",
      "    delete from automation_rules where id in (v_libre, v_fournie, v_publiee);\n    delete from automation_webhooks where id = v_adresse;\n")
rempl("const reste = await sql(`select count(*)::int as n from automation_rules where org_id = ${litteral(vise.org)} and name like '[garde]%'`);",
      "const reste = await sql(`select (select count(*) from automation_rules where org_id = ${litteral(vise.org)} and name like '[garde]%')::int\n"
      "  + (select count(*) from automation_webhooks where org_id = ${litteral(vise.org)} and name like '[garde]%')::int as n`);")
rempl("console.log(`${cible} · bureau « ${BUREAU} » · session de ${MEMBRE}\n`);",
      "console.log(`${cible}${etendue ? ' · mode ÉTENDU (état visé)' : ''} · bureau « ${BUREAU} » · session de ${MEMBRE}\n`);")
rempl("console.log(`\nrègles de test restantes : ${reste[0].n}`);", "console.log(`\nlignes de test restantes : ${reste[0].n}`);")
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
