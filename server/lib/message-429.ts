/* ═══════════════════════════════════════════════════════════════
   Le message d'attente, en français, quand on limite le débit.

   POURQUOI CE FICHIER. Les limiteurs répondaient
   « Too many requests. Please try again later. » — en anglais, à des
   entrepreneurs québécois. Les 95 clients API du navigateur relaient le
   champ `error` du serveur TEL QUEL (`if (corps?.error) return new
   Error(corps.error)`), donc cette phrase arrivait directement à
   l'écran. Traduire côté navigateur aurait voulu dire toucher 95
   fichiers ; la source, c'est ici.

   Le délai est donné quand on le connaît : « réessayez plus tard » ne
   dit pas si c'est 5 secondes ou 10 minutes, et l'utilisateur reclique.
   ═══════════════════════════════════════════════════════════════ */

/** Message d'attente en français. `secondes` omis = pas de délai connu. */
export function messageTropDeDemandes(secondes?: number): string {
  if (!secondes || !Number.isFinite(secondes) || secondes <= 0) {
    return 'Trop de demandes en peu de temps. Patientez un moment avant de réessayer.';
  }
  if (secondes < 60) {
    return `Trop de demandes en peu de temps. Réessayez dans ${Math.ceil(secondes)} secondes.`;
  }
  const minutes = Math.ceil(secondes / 60);
  return `Trop de demandes en peu de temps. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`;
}

/**
 * Le cas « rafale » : on a bloqué d'un coup, pas au fil de l'eau. On le
 * dit autrement, parce que la cause est différente — souvent un onglet
 * qui boucle ou un double-clic répété, pas un usage normal trop rapide.
 */
export function messageRafaleDetectee(secondes?: number): string {
  const attente = secondes && secondes > 0
    ? ` Réessayez dans ${secondes < 60 ? `${Math.ceil(secondes)} secondes` : `${Math.ceil(secondes / 60)} minute${Math.ceil(secondes / 60) > 1 ? 's' : ''}`}.`
    : ' Patientez un moment avant de réessayer.';
  return `Trop de demandes envoyées d'un coup : l'accès est suspendu quelques instants.${attente}`;
}
