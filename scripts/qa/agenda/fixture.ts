/**
 * Jeu de données de l'audit de l'Agenda (2026-09-30) — pur, sans base.
 *
 * 5 équipes (un technicien chacune) × 8 visites par jour, du lundi 5 au
 * vendredi 9 octobre 2026, dans le fuseau de l'entreprise (America/Toronto).
 * Adresses réelles de Drummondville, Sherbrooke, Trois-Rivières et de rangs
 * ruraux ; coordonnées fixées ici (le géocodage réel est validé à part, sur
 * quelques adresses seulement).
 *
 * Les pièges sont nommés (`piege`) : les tests les retrouvent par nom.
 */

export const FUSEAU = 'America/Toronto';
export const SEMAINE = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];

export interface Lieu { adresse: string; lat: number | null; lng: number | null }

/** Des adresses réelles par secteur, avec accents, appartements et rangs. */
export const LIEUX: Record<'drummondville' | 'sherbrooke' | 'trois_rivieres' | 'rural', Lieu[]> = {
  drummondville: [
    { adresse: '1230 boulevard Saint-Joseph, Drummondville, QC J2C 2C8', lat: 45.8718, lng: -72.4914 },
    { adresse: '425 rue Heriot, app. 3, Drummondville, QC J2B 1B7', lat: 45.8829, lng: -72.4847 },
    { adresse: '2150 rue Saint-Pierre, Drummondville, QC J2C 7B6', lat: 45.8687, lng: -72.4769 },
    { adresse: '860 boulevard Lemire, Drummondville, QC J2C 7X3', lat: 45.8631, lng: -72.5052 },
    { adresse: '310 rue Saint-Édouard, Drummondville, QC J2B 3P2', lat: 45.8864, lng: -72.4905 },
    { adresse: '1655 boulevard Mercure, Drummondville, QC J2B 3K9', lat: 45.8952, lng: -72.4801 },
    { adresse: '540 rue Cockburn, Drummondville, QC J2B 6T2', lat: 45.8801, lng: -72.4936 },
    { adresse: '2995 boulevard Saint-Joseph Ouest, Drummondville, QC J2B 6L5', lat: 45.8499, lng: -72.5263 },
  ],
  sherbrooke: [
    { adresse: '3050 boulevard de Portland, Sherbrooke, QC J1L 1K1', lat: 45.3989, lng: -71.9451 },
    { adresse: '191 rue du Palais, Sherbrooke, QC J1H 5K2', lat: 45.4029, lng: -71.8888 },
    { adresse: '2500 boulevard de l’Université, Sherbrooke, QC J1K 2R1', lat: 45.3789, lng: -71.9277 },
    { adresse: '1000 rue King Ouest, app. 12, Sherbrooke, QC J1H 1S2', lat: 45.3991, lng: -71.9020 },
    { adresse: '4500 boulevard Bourque, Sherbrooke, QC J1N 2G6', lat: 45.3764, lng: -71.9923 },
    { adresse: '75 rue Wellington Nord, Sherbrooke, QC J1H 5A9', lat: 45.4015, lng: -71.8925 },
    { adresse: '1570 rue Galt Ouest, Sherbrooke, QC J1H 2B4', lat: 45.3925, lng: -71.9153 },
    { adresse: '2785 rue King Est, Sherbrooke, QC J1G 5J1', lat: 45.4043, lng: -71.8411 },
  ],
  trois_rivieres: [
    { adresse: '1650 rue Royale, Trois-Rivières, QC G9A 4K3', lat: 46.3444, lng: -72.5418 },
    { adresse: '4225 boulevard des Forges, Trois-Rivières, QC G8Y 1W2', lat: 46.3651, lng: -72.5657 },
    { adresse: '300 rue des Forges, app. 201, Trois-Rivières, QC G9A 2G8', lat: 46.3431, lng: -72.5405 },
    { adresse: '5125 boulevard Gene-H.-Kruger, Trois-Rivières, QC G9A 4N3', lat: 46.3622, lng: -72.5933 },
    { adresse: '3500 boulevard Jean-XXIII, Trois-Rivières, QC G8Z 4M3', lat: 46.3582, lng: -72.5763 },
    { adresse: '1325 boulevard Thibeau, Trois-Rivières, QC G8T 7B2', lat: 46.3793, lng: -72.5306 },
    { adresse: '640 rue Notre-Dame Centre, Trois-Rivières, QC G9A 4Y3', lat: 46.3440, lng: -72.5461 },
    { adresse: '8300 boulevard Parent, Trois-Rivières, QC G9A 5E1', lat: 46.3274, lng: -72.6021 },
  ],
  rural: [
    { adresse: '1234 7e Rang, Saint-Cyrille-de-Wendover, QC J1Z 1B8', lat: 45.9212, lng: -72.4102 },
    { adresse: '560 rang Saint-Anne, Saint-Germain-de-Grantham, QC J0C 1K0', lat: 45.8318, lng: -72.5703 },
    { adresse: '2200 route 122, Saint-Germain-de-Grantham, QC J0C 1K0', lat: 45.8205, lng: -72.5901 },
    { adresse: '815 3e Rang, Wickham, QC J0C 1S0', lat: 45.7552, lng: -72.4981 },
    { adresse: '1480 route 139, Wickham, QC J0C 1S0', lat: 45.7497, lng: -72.5192 },
    { adresse: '95 chemin Hemming, L’Avenir, QC J0C 1B0', lat: 45.7688, lng: -72.3056 },
    { adresse: '3001 rang Sainte-Catherine, Saint-Lucien, QC J0C 1N0', lat: 45.8559, lng: -72.2512 },
    { adresse: '410 route 143, Durham-Sud, QC J0H 2C0', lat: 45.6380, lng: -72.3301 },
  ],
};

export const EQUIPES = [
  { nom: 'Équipe Drummond', couleur: '#2563EB', secteur: 'drummondville' as const },
  { nom: 'Équipe Sherbrooke', couleur: '#16A34A', secteur: 'sherbrooke' as const },
  { nom: 'Équipe Trois-Rivières', couleur: '#DC2626', secteur: 'trois_rivieres' as const },
  { nom: 'Équipe Rurale', couleur: '#D97706', secteur: 'rural' as const },
  { nom: 'Équipe Volante', couleur: '#7C3AED', secteur: 'drummondville' as const },
];

export type Piege =
  | 'trajet_impossible' | 'chevauchement' | 'adresse_invalide' | 'meme_adresse'
  | 'visite_annulee' | 'non_planifiee' | 'completee' | 'multi_jours' | 'passage_heure';

export interface VisiteFixture {
  cle: string;               // identifiant stable du test : e<equipe>-<jour>-<n>
  equipe: number;            // index dans EQUIPES
  jour: string;              // AAAA-MM-JJ, heure locale de l'entreprise
  debut: string;             // HH:MM, heure locale de l'entreprise
  dureeMin: number;
  lieu: Lieu;
  statut: 'scheduled' | 'completed' | 'cancelled' | 'in_progress';
  piege?: Piege;
  jobCle?: string;           // plusieurs visites d'une même job
}

/** 8 visites par jour par équipe, de 8 h à 15 h 30, 45 min chacune, 15 min entre elles. */
export function visites(): VisiteFixture[] {
  const out: VisiteFixture[] = [];
  EQUIPES.forEach((e, ie) => {
    SEMAINE.forEach((jour, ij) => {
      for (let n = 0; n < 8; n++) {
        const lieux = LIEUX[e.secteur];
        const lieu = lieux[(n + ij + ie) % lieux.length];
        const minutes = 8 * 60 + n * 60;
        out.push({
          cle: `e${ie}-${jour}-${n}`, equipe: ie, jour,
          debut: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
          dureeMin: 45, lieu, statut: 'scheduled',
        });
      }
    });
  });
  const trouver = (cle: string) => { const v = out.find((x) => x.cle === cle); if (!v) throw new Error(cle); return v; };

  // Trajet impossible : Sherbrooke → Trois-Rivières (~1 h 45 de route) en 15 minutes.
  const a = trouver('e4-2026-10-05-1'); a.lieu = LIEUX.sherbrooke[0]; a.piege = 'trajet_impossible';
  const b = trouver('e4-2026-10-05-2'); b.lieu = LIEUX.trois_rivieres[0]; b.piege = 'trajet_impossible';
  // Chevauchement : deux visites de la même équipe à 10 h 00 et 10 h 30 (45 min).
  const c = trouver('e0-2026-10-06-3'); c.debut = '10:30'; c.piege = 'chevauchement';
  trouver('e0-2026-10-06-2').debut = '10:00';
  trouver('e0-2026-10-06-2').piege = 'chevauchement';
  // Adresse introuvable : aucune coordonnée.
  const d = trouver('e1-2026-10-07-4');
  d.lieu = { adresse: '123 rue Inexistante, Nulle-Part, QC H0H 0H0', lat: null, lng: null }; d.piege = 'adresse_invalide';
  // Même adresse, deux jobs le même jour (visibles toutes les deux).
  const f = trouver('e2-2026-10-08-5'); const g = trouver('e2-2026-10-08-6');
  g.lieu = f.lieu; f.piege = 'meme_adresse'; g.piege = 'meme_adresse';
  // Visite annulée : hors trajet.
  const h = trouver('e3-2026-10-06-3'); h.statut = 'cancelled'; h.piege = 'visite_annulee';
  // Visite complétée.
  const i = trouver('e0-2026-10-05-0'); i.statut = 'completed'; i.piege = 'completee';
  // Job multi-jours : la même job, lundi et mardi.
  const j1 = trouver('e3-2026-10-05-7'); const j2 = trouver('e3-2026-10-06-7');
  j1.jobCle = 'multi-rurale'; j2.jobCle = 'multi-rurale'; j2.lieu = j1.lieu; j1.piege = 'multi_jours'; j2.piege = 'multi_jours';

  // Passage à l'heure normale (1er novembre 2026) : une visite à 8 h le lundi 2 novembre.
  out.push({ cle: 'dst-2026-11-02', equipe: 0, jour: '2026-11-02', debut: '08:00', dureeMin: 60, lieu: LIEUX.drummondville[0], statut: 'scheduled', piege: 'passage_heure' });
  return out;
}

/** Job sans visite : ne doit apparaître ni sur la carte ni dans l'agenda. */
export const JOB_NON_PLANIFIEE = { titre: 'Soumission acceptée — à planifier', lieu: LIEUX.drummondville[3] };

/** « 08:00 » le 2026-10-05 à Toronto → instant UTC, en tenant compte de l'heure d'été. */
export function instantLocal(jour: string, hhmm: string, fuseau = FUSEAU): Date {
  const [a, m, j] = jour.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  // Deux passes : on devine l'écart UTC, puis on corrige avec l'écart réel à cet instant.
  let t = Date.UTC(a, m - 1, j, h, mi);
  for (let k = 0; k < 2; k++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(t)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
    const vu = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    t += Date.UTC(a, m - 1, j, h, mi) - vu;
  }
  return new Date(t);
}
