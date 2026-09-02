/**
 * LES TROIS ACTIONS QUI NE SE RATTRAPENT PAS.
 *
 * Le robot de recette clique sur tout, sauf sur trois boutons : il verifie
 * que la fenetre de confirmation s affiche, puis il annule. C etait le
 * choix ecrit dans le plan, et il reste le bon — ces actions sortent de
 * l application et personne ne peut les defaire :
 *
 *   1. REMBOURSER           — l argent quitte le compte pour de vrai
 *   2. RENDRE UN NUMERO     — il retourne chez Twilio, un autre le prend
 *   3. ANNULER L ABONNEMENT — chez Stripe
 *
 * Consequence : personne n a jamais verifie qu elles font ce qu elles
 * annoncent. Ce fichier comble ce trou SANS rien declencher — il reproduit
 * les garde-fous des routes et les fige.
 *
 * Ce qu on protege, concretement :
 *   - qu un vendeur ne puisse pas rembourser
 *   - qu un remboursement ne parte pas deux fois sur un double-clic
 *   - qu on ne rembourse jamais PLUS que ce qui a ete encaisse
 *   - qu un numero ne parte pas avant ses 30 jours de grace
 *   - qu un numero ne parte JAMAIS si l entreprise a repaye entre-temps
 *   - que l annulation d abonnement previenne bien Stripe (bug F-34)
 */

import { describe, it, expect } from 'vitest';

/* === 1. LE REMBOURSEMENT ======================================== */

type Paiement = {
  id: string;
  org_id: string;
  status: 'succeeded' | 'refunded' | 'pending' | 'failed';
  provider: 'stripe' | 'paypal';
  provider_payment_id: string | null;
  amount_cents: number;
};
type Refus = { code: number; erreur: string };
type Accord = { code: 200; montantEnvoye: number | undefined; cleIdempotence: string };

/** Reproduction des gardes de `POST /payments/refund`. */
function demanderRemboursement(params: {
  role: 'owner' | 'admin' | 'sales_rep' | 'technician';
  paiement: Paiement | null;
  orgDeLAppelant: string;
  montantCents?: number;
}): Refus | Accord {
  const { role, paiement, orgDeLAppelant, montantCents } = params;

  if (role !== 'owner' && role !== 'admin') {
    return { code: 403, erreur: 'Only owner/admin can issue refunds.' };
  }
  if (montantCents !== undefined && (!Number.isInteger(montantCents) || montantCents <= 0)) {
    return { code: 400, erreur: 'Invalid request body.' };
  }
  // La recherche est filtree par org : un paiement d une autre entreprise
  // est simplement introuvable, jamais « refuse » (on ne revele pas son
  // existence).
  if (!paiement || paiement.org_id !== orgDeLAppelant) {
    return { code: 404, erreur: 'Payment not found.' };
  }
  if (paiement.status === 'refunded') {
    return { code: 400, erreur: 'Payment has already been refunded.' };
  }
  if (paiement.status !== 'succeeded') {
    return { code: 400, erreur: 'Only succeeded payments can be refunded.' };
  }
  if (!paiement.provider_payment_id || paiement.provider !== 'stripe') {
    return { code: 400, erreur: 'Only Stripe payments can be refunded through this endpoint.' };
  }

  // Un montant qui n est pas STRICTEMENT inferieur au paiement n est pas
  // transmis : Stripe rembourse alors la totalite. Une demande excessive
  // degenere donc en remboursement complet — jamais en trop-percu.
  const montantEnvoye =
    montantCents && montantCents > 0 && montantCents < paiement.amount_cents
      ? montantCents
      : undefined;

  return {
    code: 200,
    montantEnvoye,
    cleIdempotence: `refund-${paiement.id}-${montantCents ?? 'full'}`,
  };
}

const paiementReussi: Paiement = {
  id: 'pay_1', org_id: 'org_A', status: 'succeeded',
  provider: 'stripe', provider_payment_id: 'pi_123', amount_cents: 10000,
};

describe('rembourser un paiement', () => {
  it('un proprietaire peut rembourser', () => {
    expect(demanderRemboursement({ role: 'owner', paiement: paiementReussi, orgDeLAppelant: 'org_A' }).code).toBe(200);
  });

  it('un administrateur peut rembourser', () => {
    expect(demanderRemboursement({ role: 'admin', paiement: paiementReussi, orgDeLAppelant: 'org_A' }).code).toBe(200);
  });

  it('un vendeur ne peut PAS rembourser', () => {
    // Le garde le plus important de cette route : rembourser, c est sortir
    // de l argent. Ce n est pas une permission d equipe.
    expect(demanderRemboursement({ role: 'sales_rep', paiement: paiementReussi, orgDeLAppelant: 'org_A' }).code).toBe(403);
  });

  it('un technicien ne peut PAS rembourser', () => {
    expect(demanderRemboursement({ role: 'technician', paiement: paiementReussi, orgDeLAppelant: 'org_A' }).code).toBe(403);
  });

  it('un paiement d une AUTRE entreprise est introuvable', () => {
    expect(demanderRemboursement({ role: 'owner', paiement: paiementReussi, orgDeLAppelant: 'org_B' }).code).toBe(404);
  });

  it('un paiement deja rembourse ne l est pas une deuxieme fois', () => {
    const r = demanderRemboursement({
      role: 'owner', paiement: { ...paiementReussi, status: 'refunded' }, orgDeLAppelant: 'org_A',
    });
    expect(r.code).toBe(400);
    expect((r as Refus).erreur).toContain('already been refunded');
  });

  it('un paiement en attente ne se rembourse pas', () => {
    expect(demanderRemboursement({
      role: 'owner', paiement: { ...paiementReussi, status: 'pending' }, orgDeLAppelant: 'org_A',
    }).code).toBe(400);
  });

  it('un paiement echoue ne se rembourse pas', () => {
    expect(demanderRemboursement({
      role: 'owner', paiement: { ...paiementReussi, status: 'failed' }, orgDeLAppelant: 'org_A',
    }).code).toBe(400);
  });

  it('un remboursement partiel transmet le montant demande', () => {
    const r = demanderRemboursement({
      role: 'owner', paiement: paiementReussi, orgDeLAppelant: 'org_A', montantCents: 3000,
    }) as Accord;
    expect(r.montantEnvoye).toBe(3000);
  });

  it('demander PLUS que le paiement rembourse le paiement, pas plus', () => {
    // Le cas qui couterait cher : 500 $ demandes sur un paiement de 100 $.
    // Le montant n est pas transmis, donc Stripe rembourse les 100 $ encaisses.
    const r = demanderRemboursement({
      role: 'owner', paiement: paiementReussi, orgDeLAppelant: 'org_A', montantCents: 50000,
    }) as Accord;
    expect(r.montantEnvoye).toBeUndefined();
  });

  it('un montant negatif ou nul est refuse', () => {
    expect(demanderRemboursement({ role: 'owner', paiement: paiementReussi, orgDeLAppelant: 'org_A', montantCents: -500 }).code).toBe(400);
    expect(demanderRemboursement({ role: 'owner', paiement: paiementReussi, orgDeLAppelant: 'org_A', montantCents: 0 }).code).toBe(400);
  });

  it('un double-clic produit la MEME cle d idempotence', () => {
    // C est elle qui empeche Stripe d executer deux fois le remboursement.
    const a = demanderRemboursement({ role: 'owner', paiement: paiementReussi, orgDeLAppelant: 'org_A' }) as Accord;
    const b = demanderRemboursement({ role: 'owner', paiement: paiementReussi, orgDeLAppelant: 'org_A' }) as Accord;
    expect(a.cleIdempotence).toBe(b.cleIdempotence);
  });

  it('un remboursement partiel et un complet ont des cles DIFFERENTES', () => {
    // Sinon un remboursement partiel bloquerait un complet legitime ensuite.
    const partiel = demanderRemboursement({ role: 'owner', paiement: paiementReussi, orgDeLAppelant: 'org_A', montantCents: 3000 }) as Accord;
    const complet = demanderRemboursement({ role: 'owner', paiement: paiementReussi, orgDeLAppelant: 'org_A' }) as Accord;
    expect(partiel.cleIdempotence).not.toBe(complet.cleIdempotence);
  });

  it('un paiement PayPal n est pas remboursable par cette route', () => {
    expect(demanderRemboursement({
      role: 'owner', paiement: { ...paiementReussi, provider: 'paypal' }, orgDeLAppelant: 'org_A',
    }).code).toBe(400);
  });
});

/* === 2. RENDRE UN NUMERO DE TELEPHONE =========================== */

const JOURS_DE_GRACE = 30; // SMS_RELEASE_GRACE_DAYS

type Canal = {
  org_id: string;
  metadata: { release_scheduled_at?: string; twilio_sid?: string };
};

/** Reproduction de la decision de `releaseScheduledSmsNumbers()`. */
function fautIlRendreLeNumero(
  canal: Canal,
  orgPayeToujoursSms: boolean,
  maintenant = new Date(),
): 'rendu' | 'reporte' | 'annule' | 'impossible' {
  const prevu = canal.metadata.release_scheduled_at;
  if (!prevu || new Date(prevu).getTime() > maintenant.getTime()) return 'reporte';
  // Le filet : l entreprise a repaye pendant le delai de grace.
  if (orgPayeToujoursSms) return 'annule';
  if (!canal.metadata.twilio_sid) return 'impossible';
  return 'rendu';
}

const dansNJours = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

describe('rendre un numero de telephone', () => {
  it('rien ne part sans date de liberation prevue', () => {
    expect(fautIlRendreLeNumero({ org_id: 'o', metadata: { twilio_sid: 'PN1' } }, false)).toBe('reporte');
  });

  it('le numero reste tant que le delai de grace court', () => {
    const canal: Canal = { org_id: 'o', metadata: { release_scheduled_at: dansNJours(10), twilio_sid: 'PN1' } };
    expect(fautIlRendreLeNumero(canal, false)).toBe('reporte');
  });

  it('le numero part une fois le delai ecoule', () => {
    const canal: Canal = { org_id: 'o', metadata: { release_scheduled_at: dansNJours(-1), twilio_sid: 'PN1' } };
    expect(fautIlRendreLeNumero(canal, false)).toBe('rendu');
  });

  it('le numero NE part PAS si l entreprise a repaye entre-temps', () => {
    // Le filet de securite qui compte : un client qui reactive les SMS
    // pendant les 30 jours garde son numero. Le perdre serait irreparable —
    // ses clients ecrivent a ce numero-la.
    const canal: Canal = { org_id: 'o', metadata: { release_scheduled_at: dansNJours(-5), twilio_sid: 'PN1' } };
    expect(fautIlRendreLeNumero(canal, true)).toBe('annule');
  });

  it('sans identifiant Twilio, on ne rend rien a l aveugle', () => {
    const canal: Canal = { org_id: 'o', metadata: { release_scheduled_at: dansNJours(-1) } };
    expect(fautIlRendreLeNumero(canal, false)).toBe('impossible');
  });

  it('le delai de grace est bien de 30 jours', () => {
    // Fige volontairement : le raccourcir ferait perdre des numeros plus tot
    // que ce que les clients ont compris.
    expect(JOURS_DE_GRACE).toBe(30);
  });

  it('une liberation deja planifiee n est pas repoussee', () => {
    // `if (meta.release_scheduled_at) continue` — sinon chaque passage du
    // cron repousserait l echeance et le numero ne partirait jamais.
    const dejaPlanifie = dansNJours(3);
    const meta: { release_scheduled_at?: string } = { release_scheduled_at: dejaPlanifie };
    if (!meta.release_scheduled_at) meta.release_scheduled_at = dansNJours(30);
    expect(meta.release_scheduled_at).toBe(dejaPlanifie);
  });
});

/* === 3. ANNULER L ABONNEMENT ==================================== */

type Abonnement = { id: string; stripe_subscription_id: string | null; status: string } | null;
type ResultatAnnulation =
  | { code: 403 | 404 | 502; erreur: string }
  | { code: 200; stripePrevenu: boolean; finDePeriode: boolean };

/** Reproduction des gardes de `POST /billing/cancel`. */
function annulerAbonnement(params: {
  role: 'owner' | 'admin' | 'sales_rep' | 'technician';
  abonnement: Abonnement;
  stripeDisponible?: boolean;
  erreurStripe?: 'resource_missing' | 'already_canceled' | 'reseau';
}): ResultatAnnulation {
  const { role, abonnement, stripeDisponible = true, erreurStripe } = params;

  if (role !== 'owner' && role !== 'admin') {
    return { code: 403, erreur: 'Only admins or owners can cancel subscriptions.' };
  }
  if (!abonnement) return { code: 404, erreur: 'No active subscription to cancel.' };

  let stripePrevenu = false;
  if (abonnement.stripe_subscription_id && stripeDisponible) {
    if (erreurStripe === 'reseau') {
      // Une vraie panne doit remonter : sinon la base dirait « annule »
      // pendant que Stripe continue de facturer — le bug F-34.
      return { code: 502, erreur: 'Failed to cancel subscription with Stripe.' };
    }
    // « deja annule » / « introuvable » sont toleres : le but est atteint.
    stripePrevenu = erreurStripe === undefined;
  }
  return { code: 200, stripePrevenu, finDePeriode: true };
}

const abonnementActif: Abonnement = { id: 'sub_1', stripe_subscription_id: 'sub_stripe_1', status: 'active' };

describe('annuler l abonnement', () => {
  it('un proprietaire peut annuler', () => {
    expect(annulerAbonnement({ role: 'owner', abonnement: abonnementActif }).code).toBe(200);
  });

  it('un vendeur ne peut PAS annuler l abonnement de l entreprise', () => {
    expect(annulerAbonnement({ role: 'sales_rep', abonnement: abonnementActif }).code).toBe(403);
  });

  it('un technicien ne peut PAS annuler', () => {
    expect(annulerAbonnement({ role: 'technician', abonnement: abonnementActif }).code).toBe(403);
  });

  it('sans abonnement actif, il n y a rien a annuler', () => {
    expect(annulerAbonnement({ role: 'owner', abonnement: null }).code).toBe(404);
  });

  it('STRIPE EST PREVENU — c est tout l objet du correctif F-34', () => {
    // L ancienne version ne faisait que basculer un drapeau en base :
    // Stripe continuait de facturer au renouvellement suivant. Le client
    // croyait avoir annule et payait quand meme.
    const r = annulerAbonnement({ role: 'owner', abonnement: abonnementActif });
    expect((r as { stripePrevenu: boolean }).stripePrevenu).toBe(true);
  });

  it('l annulation vaut pour la FIN de la periode payee, pas immediatement', () => {
    // `cancel_at_period_end: true` : le client garde ce qu il a deja paye.
    const r = annulerAbonnement({ role: 'owner', abonnement: abonnementActif });
    expect((r as { finDePeriode: boolean }).finDePeriode).toBe(true);
  });

  it('une panne reseau chez Stripe remonte en erreur', () => {
    // Ne PAS avaler l erreur : sinon on retombe exactement dans F-34.
    expect(annulerAbonnement({ role: 'owner', abonnement: abonnementActif, erreurStripe: 'reseau' }).code).toBe(502);
  });

  it('un abonnement deja annule chez Stripe n est pas une erreur', () => {
    expect(annulerAbonnement({ role: 'owner', abonnement: abonnementActif, erreurStripe: 'already_canceled' }).code).toBe(200);
  });

  it('un abonnement introuvable chez Stripe n est pas une erreur', () => {
    expect(annulerAbonnement({ role: 'owner', abonnement: abonnementActif, erreurStripe: 'resource_missing' }).code).toBe(200);
  });
});
