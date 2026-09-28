/* ═══════════════════════════════════════════════════════════════
   ReservationPublique — page publique /reserver/:token (sans session).

   Le lien arrive par courriel ou texto ({{client.lien_reservation}}, le plus
   souvent depuis l'automatisation « Client inactif »). La demande est
   pré-remplie avec ce que l'entreprise sait déjà du client — nom, adresse,
   services passés — pour qu'il n'ait qu'à cocher et envoyer. Elle arrive
   dans le pipeline comme une demande de formulaire.

   Lien expiré (30 jours) ou inconnu : un message clair, jamais une page vide.
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useId, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarCheck, Check } from 'lucide-react';
import { envoyerReservation, ErreurReservation, lireReservation, type DemandeReservation } from '../lib/reservationApi';

const TEXTES = {
  fr: {
    titre: 'Réserver à nouveau', intro: (n: string) => `${n} sera heureux de vous revoir. Vérifiez vos informations, choisissez ce dont vous avez besoin, et on vous recontacte.`,
    prenom: 'Prénom', nom: 'Nom', courriel: 'Courriel', telephone: 'Téléphone', adresse: 'Adresse du service',
    services: 'Ce que vous aimeriez faire faire', message: 'Un détail à ajouter ? (facultatif)',
    envoyer: 'Envoyer ma demande', envoi: 'Envoi…', merci: 'Merci ! Votre demande est envoyée.', suite: 'L’équipe vous contactera très bientôt pour fixer un moment.',
    expire: 'Ce lien a expiré', inconnu: 'Lien introuvable', chargement: 'Chargement…', echec: 'La demande n’a pas pu être envoyée. Réessayez.',
    contact: 'Pour une nouvelle réservation, contactez directement l’entreprise.',
  },
  en: {
    titre: 'Book again', intro: (n: string) => `${n} would be glad to see you again. Check your details, pick what you need, and we’ll get back to you.`,
    prenom: 'First name', nom: 'Last name', courriel: 'Email', telephone: 'Phone', adresse: 'Service address',
    services: 'What you’d like done', message: 'Anything to add? (optional)',
    envoyer: 'Send my request', envoi: 'Sending…', merci: 'Thank you! Your request was sent.', suite: 'The team will contact you shortly to set a time.',
    expire: 'This link has expired', inconnu: 'Link not found', chargement: 'Loading…', echec: 'Your request could not be sent. Please try again.',
    contact: 'To book again, please contact the business directly.',
  },
};

export default function ReservationPublique() {
  const { token = '' } = useParams<{ token: string }>();
  const id = useId();
  const [donnees, setDonnees] = useState<DemandeReservation | null>(null);
  const [erreur, setErreur] = useState<{ code: string; message: string } | null>(null);
  const [champs, setChamps] = useState({ prenom: '', nom: '', courriel: '', telephone: '', adresse: '', message: '' });
  const [services, setServices] = useState<string[]>([]);
  const [envoi, setEnvoi] = useState<'repos' | 'en_cours' | 'fait' | 'echec'>('repos');

  useEffect(() => {
    let vivant = true;
    lireReservation(token)
      .then((d) => {
        if (!vivant) return;
        setDonnees(d);
        setChamps({ ...d.client, message: '' });
      })
      .catch((e: unknown) => {
        if (!vivant) return;
        setErreur(e instanceof ErreurReservation ? { code: e.code, message: e.message } : { code: 'erreur', message: String(e) });
      });
    return () => { vivant = false; };
  }, [token]);

  // Langue de l'entreprise une fois connue ; celle du navigateur avant.
  const langue: 'fr' | 'en' = donnees?.entreprise?.langue
    ?? ((typeof navigator !== 'undefined' && !navigator.language.toLowerCase().startsWith('fr')) ? 'en' : 'fr');
  const t = TEXTES[langue];
  const accent = donnees?.entreprise?.couleur || '#111827';

  const envoyer = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnvoi('en_cours');
    try {
      await envoyerReservation(token, { ...champs, services });
      setEnvoi('fait');
    } catch (err) {
      console.error('[reservation] envoi échoué', err);
      setEnvoi('echec');
    }
  };

  const cadre = (contenu: React.ReactNode) => (
    <div className="min-h-screen bg-[#f4f5f7] px-4 py-10">
      <div className="mx-auto max-w-lg rounded-2xl bg-white p-6 shadow-sm sm:p-8">{contenu}</div>
    </div>
  );

  if (erreur) {
    return cadre(
      <div className="text-center" role="alert">
        <h1 className="text-lg font-semibold text-gray-900">{erreur.code === 'expire' ? t.expire : t.inconnu}</h1>
        <p className="mt-2 text-sm text-gray-600">{erreur.message}</p>
        <p className="mt-1 text-sm text-gray-500">{t.contact}</p>
      </div>,
    );
  }
  if (!donnees) return cadre(<p className="text-center text-sm text-gray-500">{t.chargement}</p>);

  if (envoi === 'fait') {
    return cadre(
      <div className="text-center" role="status">
        <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-50 text-green-600">
          <Check className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="text-lg font-semibold text-gray-900">{t.merci}</h1>
        <p className="mt-2 text-sm text-gray-600">{t.suite}</p>
      </div>,
    );
  }

  const champ = (cle: keyof typeof champs, libelle: string, type = 'text', autoComplete?: string) => (
    <div>
      <label htmlFor={`${id}-${cle}`} className="mb-1 block text-[13px] font-medium text-gray-700">{libelle}</label>
      <input
        id={`${id}-${cle}`}
        type={type}
        autoComplete={autoComplete}
        value={champs[cle]}
        onChange={(e) => setChamps((c) => ({ ...c, [cle]: e.target.value }))}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
      />
    </div>
  );

  return cadre(
    <form onSubmit={envoyer} className="space-y-4">
      <div className="flex items-center gap-3">
        {donnees.entreprise.logo
          ? <img src={donnees.entreprise.logo} alt={donnees.entreprise.nom} className="h-10 w-10 rounded-lg object-contain" />
          : <span className="flex h-10 w-10 items-center justify-center rounded-lg text-white" style={{ background: accent }}><CalendarCheck className="h-5 w-5" aria-hidden="true" /></span>}
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{t.titre}</h1>
          <p className="text-[13px] text-gray-500">{donnees.entreprise.nom}</p>
        </div>
      </div>
      <p className="text-sm text-gray-600">{t.intro(donnees.entreprise.nom || '')}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {champ('prenom', t.prenom, 'text', 'given-name')}
        {champ('nom', t.nom, 'text', 'family-name')}
        {champ('courriel', t.courriel, 'email', 'email')}
        {champ('telephone', t.telephone, 'tel', 'tel')}
      </div>
      {champ('adresse', t.adresse, 'text', 'street-address')}

      {donnees.services_passes.length > 0 && (
        <fieldset>
          <legend className="mb-1 text-[13px] font-medium text-gray-700">{t.services}</legend>
          <div className="space-y-1.5">
            {donnees.services_passes.map((s, i) => (
              <label key={s} htmlFor={`${id}-service-${i}`} className="flex cursor-pointer items-center gap-2 text-sm text-gray-800">
                <input
                  id={`${id}-service-${i}`}
                  type="checkbox"
                  checked={services.includes(s)}
                  onChange={(e) => setServices((l) => (e.target.checked ? [...l, s] : l.filter((x) => x !== s)))}
                  className="h-4 w-4"
                />
                {s}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div>
        <label htmlFor={`${id}-message`} className="mb-1 block text-[13px] font-medium text-gray-700">{t.message}</label>
        <textarea
          id={`${id}-message`}
          rows={3}
          value={champs.message}
          onChange={(e) => setChamps((c) => ({ ...c, message: e.target.value }))}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
        />
      </div>

      {envoi === 'echec' && <p role="alert" className="text-sm text-red-600">{t.echec}</p>}

      <button
        type="submit"
        disabled={envoi === 'en_cours'}
        className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-gray-900"
        style={{ background: accent }}
      >
        {envoi === 'en_cours' ? t.envoi : t.envoyer}
      </button>
    </form>,
  );
}
