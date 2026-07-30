# Audit des dépendances — état au 2026-07-30

Le job CI **Dependency audit** est en `continue-on-error` : il signale sans
bloquer les merges. Ce document explique pourquoi il est rouge et pourquoi
ce n'est pas une urgence — sans quoi un rouge permanent finit par être
ignoré, y compris le jour où il signale quelque chose de réel.

## Résumé

```
critique = 0    élevée = 3    moyenne = 0    faible = 3
```

Aucune vulnérabilité critique. Les trois « élevées » se ramènent à deux
paquets, tous deux **non exploitables dans le contexte de Lume**.

## 1. react-router / react-router-dom

**Avis** : React Router — RSC Mode CSRF Bypass Allows Action Execution
Before 400 Response.

**Pourquoi ça ne s'applique pas** : la faille concerne le mode **RSC**
(React Server Components) et les server actions. Lume est une SPA rendue
côté client qui utilise `BrowserRouter` (voir `src/main.tsx`) — il n'y a
ni RSC, ni server action, ni rendu serveur. Le chemin vulnérable n'existe
tout simplement pas dans l'application.

**Ne pas appliquer `npm audit fix --force`.** L'outil propose de descendre
de `7.13.1` vers `7.11.0` et le marque comme *breaking change* : ce serait
une **rétrogradation** de plusieurs versions, avec les régressions que ça
implique, pour corriger un mode qu'on n'utilise pas. La bonne action est
d'attendre un correctif publié en `7.13.x` ou plus récent.

## 2. postcss

**Avis** : lecture de fichier arbitraire via une entrée CSS contrôlée par
un attaquant.

**Pourquoi ça ne s'applique pas** : `postcss` n'est pas une dépendance
directe (ni `dependencies` ni `devDependencies`). Il arrive uniquement par
`vite` et `autoprefixer`, c'est-à-dire **à la compilation**. Il ne fait pas
partie du bundle servi aux clients et ne traite jamais d'entrée
utilisateur : exploiter la faille supposerait qu'un attaquant fournisse un
fichier CSS malveillant compilé dans notre propre build — ce qui suppose
déjà un accès en écriture au dépôt.

Se corrigera de lui-même à la prochaine montée de version de Vite.

## Ce qui déclencherait une action immédiate

- Toute vulnérabilité **critique**, quel que soit le paquet.
- Une élevée sur une dépendance **d'exécution** (présente dans
  `dependencies`, donc expédiée au navigateur ou exécutée par le serveur).
- Un avis touchant `@supabase/*`, `stripe`, `twilio` ou `express` — ils
  manipulent des identifiants, des paiements ou les requêtes entrantes.

## Vérifier soi-même

```bash
npm audit                     # rapport lisible
npm audit --json              # détail machine
npm ls <paquet>               # d'où vient une dépendance transitive
```

Pour trancher, la question utile n'est pas « est-ce signalé ? » mais
**« le chemin vulnérable existe-t-il dans notre code ? »**. Les deux cas
ci-dessus montrent qu'un avis peut être parfaitement réel en amont et sans
conséquence en aval.
