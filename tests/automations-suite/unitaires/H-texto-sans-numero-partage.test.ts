/**
 * Un texto d'automatisation part du numéro de l'ENTREPRISE. Le moteur ne doit
 * donc pas exiger le numéro PARTAGÉ de la plateforme (TWILIO_PHONE_NUMBER) pour
 * recevoir son client Twilio : c'est ce qui faisait sauter tous les textos
 * automatiques en prod, « Aucun numéro texto configuré pour le bureau », pour
 * une entreprise dont le numéro était actif (constaté le 2026-10-01).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lire = (f: string) => readFileSync(resolve(__dirname, '../../..', f), 'utf8').replace(/\r\n/g, '\n');

describe('[B-101] texto automatique sans numéro partagé de plateforme', () => {
  it('[B-101] le moteur reçoit le client Twilio dès qu’il existe, sans condition sur TWILIO_PHONE_NUMBER', () => {
    const index = lire('server/index.ts');
    const init = index.slice(index.indexOf('initAutomationEngine({'), index.indexOf('initAutomationEngine({') + 1200);
    expect(init).toMatch(/twilio:\s*twilioClient\s*\?\s*\{\s*client:\s*twilioClient/);
    expect(init, 'le numéro partagé ne doit pas conditionner le client').not.toMatch(/twilioClient\s*&&\s*twilioPhoneNumber/);
  });

  it('[B-101] l’action texto n’utilise jamais le numéro partagé : expéditeur = numéro de l’entreprise', () => {
    const actions = lire('server/lib/actions/index.ts');
    const sms = actions.slice(actions.indexOf('export async function executeSendSms'), actions.indexOf('// ── Action: Create Notification'));
    expect(sms).toMatch(/getOrgSmsFromNumber\(ctx\.orgId\)/);
    expect(sms).toMatch(/from:\s*fromNumber/);
    expect(sms).not.toMatch(/ctx\.twilio\.phoneNumber/);
  });
});
