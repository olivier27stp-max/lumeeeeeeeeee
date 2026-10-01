/**
 * Mise en place commune des tests.
 *
 * `@testing-library/react-native` v14 fournit ses matchers d'office (le point
 * d'entrée `extend-expect` a disparu en v13) : rien à charger pour eux. Noter
 * que `render()` y est ASYNCHRONE — sans `await`, les tests échouent sur
 * « toJSON is not a function ».
 */

// Valeurs FACTICES : `src/lib/supabase.ts` lève à l'import si elles manquent, et
// aucun test ne doit dépendre d'un vrai projet (ni, surtout, en porter les clés).
process.env.EXPO_PUBLIC_SUPABASE_URL ||= 'https://exemple.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||= 'cle-anonyme-factice-pour-les-tests';
process.env.EXPO_PUBLIC_WEB_URL ||= 'https://exemple.test';

// AsyncStorage est un module NATIF : hors appareil il vaut `null` et son import
// lève. Le paquet fournit un faux officiel — sans ça, tout composant qui touche
// au thème (il y lit le choix clair/sombre) refuse de se rendre en test.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
