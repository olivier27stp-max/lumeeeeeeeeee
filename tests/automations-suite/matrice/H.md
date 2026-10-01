# Matrice H — Langue et contenu (suffixe `secu`)

Fichiers : `integration/30-fgh-langue.test.ts`, `integration/60-contenu-messages.test.ts`, `unitaires/H-contenu-messages.test.ts`, `tests/automations-fgh-segments-sms.test.ts` (unitaire, sans réseau).

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| H-001 | courriel + texto marketing | entreprise EN | objet/corps `_en`, `<html lang="en">`, « Unsubscribe from these emails », « Reply STOP to opt out. » | PASS |
| H-002 | idem | entreprise FR (témoin) | tout en français | PASS |
| H-003 | request_review | entreprise EN | courriel « How did we do? » ET texto en anglais | PASS après f7dbc906 (FAIL avant : texto toujours en français) |
| H-004 | [appointment_time] / [appointment_date] | entreprise EN | « 02:00 p.m. », pas « 14 h 00 » ; FR garde « 14 h 00 » | PASS après e09f0482 |
| H-005 | create_notification par courriel | membre `language = en` | titre `title_en` | PASS |
| H-006 | `default_language = 'en-CA'` | — | refusé (CHECK fr/en, 23514) : l'écart `langueOrg` (=== 'en') / `langueDe` (startsWith) est sans effet | PASS |
| H-010 | segmentsSms, accents GSM-7 | é è à ù | GSM-7, 160 puis 153 | PASS |
| H-011 | segmentsSms, hors GSM-7 | ê ç ’ « » ô î û ë | UCS-2, 70 puis 67 ; caractère d'extension = 2 unités | PASS |
| H-012 | mention STOP | FR / EN | reste en GSM-7 | PASS |
| H-013 | confirmations STOP / REPRENDRE | FR | STOP : GSM-7, 2 segments ; REPRENDRE : UCS-2 (« êtes »), 2 segments | PASS (mesure) |
| H-014 | éditeur de texto (MessageEditor) | texte avec accents | compteur = vrai nombre de segments + alerte UCS-2 | PASS après ab9d7ebe (FAIL avant : longueur / 160) |
| H-020 | `invoice_due_date`, `quote_valid_until`, `appointment_date` | entreprise FR / EN ; fuseaux Honolulu, Auckland | « 15 octobre 2026 » / « October 15, 2026 », jamais AAAA-MM-JJ ; une date seule ne change pas de jour ; le webhook garde AAAA-MM-JJ | CORRIGÉ — `integration/60-contenu-messages.test.ts`, `unitaires/H-contenu-messages.test.ts`, `30-fgh-langue.test.ts` [H-004] (FAIL avant : « était due le 2026-10-15 ») |
| H-021 | éditeur plein écran (PanneauEtape) | texto | compteur de segments | NON COUVERT : l'éditeur plein écran n'a aucun compteur ; seul MessageEditor (Réglages › Messagerie) en a un |
| H-022 | request_review, client sans prénom ni nom | FR / EN | FR : « Bonjour, merci… » (jamais « Bonjour Bonjour, ») ; EN : « Hi there, » ; texto : l'espace orpheline « Bonjour , » est recollée comme dans le courriel | CORRIGÉ — `integration/60-contenu-messages.test.ts`, `unitaires/H-contenu-messages.test.ts` (FAIL avant : « Bonjour Bonjour, merci d'avoir choisi… ») |
