/**
 * Tests de l'app mobile. `jest-expo` est épinglé sur la version de l'SDK (56) :
 * la 57 exige `@react-native/jest-preset@^0.86`, incompatible avec React
 * Native 0.85.3 d'Expo 56, et l'installation échoue sur ce conflit de pairs.
 */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/assets/(.*)$': '<rootDir>/assets/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx', '<rootDir>/tests/**/*.test.ts', '<rootDir>/tests/**/*.test.tsx'],
  // Les tests de non-régression lisent les SOURCES : ne pas les transformer.
  collectCoverageFrom: ['src/**/*.{ts,tsx}'],
};
