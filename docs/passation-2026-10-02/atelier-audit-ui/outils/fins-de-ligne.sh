#!/usr/bin/env bash
# Pour chaque fichier : lignes réellement changées (hors fins de ligne), et CRLF dans main, HEAD et sur disque.
cd /d/lume-uiaudit/wt-lumi || exit 1
for f in "$@"; do
  reel=$(git diff --ignore-cr-at-eol --numstat origin/main...HEAD -- "$f" | cut -f1,2 | tr '\t' '/')
  main=$(git show "origin/main:$f" | grep -c $'\r')
  head=$(git show "HEAD:$f" | grep -c $'\r')
  disque=$(grep -c $'\r' "$f")
  lignes=$(git show "HEAD:$f" | wc -l)
  echo "$f : réel +/- $reel ; CRLF main=$main HEAD=$head disque=$disque ; lignes=$lignes"
done
echo "autocrlf=$(git config core.autocrlf)"
