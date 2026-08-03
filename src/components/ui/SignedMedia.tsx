import React from 'react';
import { useStorageUrl } from '../../hooks/useStorageUrl';

/**
 * Wrappers d'affichage pour les fichiers des buckets privés (attachments, job-photos…).
 * La base stocke l'URL publique ; ces composants la signent au rendu via useStorageUrl.
 * Tant que la signature n'est pas résolue, src/href restent vides (pas de 400 prématuré).
 */

export function SignedImg(
  props: React.ImgHTMLAttributes<HTMLImageElement> & { url: string }
) {
  const { url, ...rest } = props;
  const src = useStorageUrl(url);
  return <img {...rest} src={src || undefined} />;
}

export function SignedVideo(
  props: React.VideoHTMLAttributes<HTMLVideoElement> & { url: string }
) {
  const { url, ...rest } = props;
  const src = useStorageUrl(url);
  return <video {...rest} src={src || undefined} />;
}

export function SignedLink({
  url,
  children,
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { url: string }) {
  const href = useStorageUrl(url);
  return (
    <a {...rest} href={href || undefined} aria-disabled={!href}>
      {children}
    </a>
  );
}
