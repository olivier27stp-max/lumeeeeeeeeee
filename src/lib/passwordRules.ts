/**
 * Règles de mot de passe — miroir exact de `passwordSchema` (server/lib/validation.ts).
 * Le serveur reste l'autorité ; ceci ne sert qu'à guider la saisie avant l'envoi.
 */
export interface PasswordChecks {
  length: boolean;
  uppercase: boolean;
  lowercase: boolean;
  number: boolean;
  special: boolean;
}

export function passwordChecks(password: string): PasswordChecks {
  return {
    length: password.length >= 10,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^a-zA-Z0-9]/.test(password),
  };
}

export function passwordPassedCount(checks: PasswordChecks): number {
  return Object.values(checks).filter(Boolean).length;
}

export function passwordMeetsRules(password: string): boolean {
  return Object.values(passwordChecks(password)).every(Boolean);
}
