/** Rejoue le tenant de test avant les E2E (les tests d'API le modifient). */
import { brancherServeurSurLocal } from '../env-local';

export default async function globalSetup() {
  brancherServeurSurLocal();
  process.env.TZ = 'UTC';
  const { seed } = await import('../seed');
  await seed();
}
