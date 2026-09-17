/* Rangée d'icônes réseaux sociaux au bas des pages publiques client
   (soumission, facture, contrat, paiement). Rien ne s'affiche si
   l'entreprise n'a renseigné aucun lien. */

import React from 'react';
import { IconeReseau } from './IconeReseau';
import { reseauxRenseignes, type SocialLinks } from '../lib/socialLinks';

export default function ReseauxSociauxPied({ liens, className }: { liens: SocialLinks | null | undefined; className?: string }) {
  const items = reseauxRenseignes(liens);
  if (items.length === 0) return null;
  return (
    <nav aria-label="Réseaux sociaux" className={className ?? 'flex items-center justify-center gap-4 mt-4 no-print'}>
      {items.map(({ reseau, url, label }) => (
        <a
          key={reseau}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
          title={label}
          className="text-[#999] hover:text-[#333] transition-colors"
        >
          <IconeReseau reseau={reseau} size={18} />
        </a>
      ))}
    </nav>
  );
}
