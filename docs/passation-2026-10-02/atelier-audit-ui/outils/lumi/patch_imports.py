def editer(p, o, n):
    s = open(p, encoding='utf8').read()
    assert s.count(o) == 1, (p, o, s.count(o))
    open(p, 'w', encoding='utf8', newline='\n').write(s.replace(o, n))
editer('server/routes/automation-rules.ts', "  trouverDeclencheur,\n", "  trouverDeclencheur,\n  conditionsApresChangement,\n")
editer('src/pages/AutomationBuilderPage.tsx', "  DECLENCHEURS,\n", "  DECLENCHEURS,\n  conditionsApresChangement,\n")
print('ok')
