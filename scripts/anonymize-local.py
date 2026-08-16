#!/usr/bin/env python3
"""
anonymize-local.py — remplace toutes les données personnelles du clone LOCAL
par des équivalents fictifs, sans toucher à la structure ni aux volumes.

    npm run db:anonymize-local

Principe : le remplacement est **déterministe** (hash de la valeur d'origine).
« Antoine Tremblay » devient toujours le même pseudonyme, dans TOUTES les
tables — les jointures et les champs dénormalisés (jobs.client_name,
invoices.client_email_snapshot…) restent donc cohérents entre eux.

Ce qui est anonymisé (détecté par motif sur le catalogue, pas sur une liste
figée — donc automatiquement à jour si des colonnes s'ajoutent) :
  noms · courriels · téléphones · adresses/rues/villes/codes postaux ·
  adresses IP · numéros de taxe · dates de naissance · notes en texte libre

Ce qui est CONSERVÉ : identifiants, montants, dates, statuts, relations,
volumes. Le clone garde toute sa valeur de test.

⚠️ GARDE-FOU : refuse de tourner ailleurs que sur 127.0.0.1:54322 (le clone
   local). Impossible de viser la prod ou le staging par erreur.
"""
import hashlib
import re
import subprocess
import sys

HOST, PORT, USER, DB = '127.0.0.1', '54322', 'postgres', 'postgres'

PRENOMS = ['Alex', 'Camille', 'Jordan', 'Sam', 'Charlie', 'Maxime', 'Robin', 'Dominique',
           'Claude', 'Morgan', 'Ariel', 'Noa', 'Éli', 'Sacha', 'Léo', 'Kim']
NOMS = ['Bergeron', 'Lavoie', 'Fortin', 'Girard', 'Caron', 'Ouellet', 'Poulin', 'Bélisle',
        'Turcotte', 'Rousseau', 'Lemieux', 'Dufour', 'Simard', 'Mercier', 'Nadeau', 'Hébert']
RUES = ['rue des Érables', 'avenue du Parc', 'boulevard Sainte-Foy', 'rue Principale',
        'chemin du Lac', 'rue Notre-Dame', 'avenue des Pins', 'rue Saint-Jean']
VILLES = ['Sainte-Julie', 'Granby', 'Rimouski', 'Val-d\'Or', 'Saint-Hyacinthe',
          'Baie-Comeau', 'Thetford Mines', 'Alma']


def sql_str(s):
    return "'" + s.replace("'", "''") + "'"


def build_functions():
    """Fonctions SQL déterministes, dans un schéma temporaire."""
    def arr(items):
        return 'array[' + ','.join(sql_str(i) for i in items) + ']'
    return f"""
create schema if not exists anon_tmp;

-- index stable dérivé de la valeur d'origine
create or replace function anon_tmp.idx(v text, n int) returns int
language sql immutable as $$
  select (('x' || substr(md5(coalesce(v,'')), 1, 8))::bit(32)::bigint % n)::int
$$;

create or replace function anon_tmp.prenom(v text) returns text
language sql immutable as $$ select ({arr(PRENOMS)})[anon_tmp.idx(v, {len(PRENOMS)}) + 1] $$;

-- Sel distinct du prénom : sans lui, prénom et nom partagent le même hachage
-- et restent toujours appariés (16 identités possibles au lieu de 256).
create or replace function anon_tmp.nom(v text) returns text
language sql immutable as $$ select ({arr(NOMS)})[anon_tmp.idx(v || '~nom', {len(NOMS)}) + 1] $$;

create or replace function anon_tmp.nom_complet(v text) returns text
language sql immutable as $$ select anon_tmp.prenom(v) || ' ' || anon_tmp.nom(v) $$;

create or replace function anon_tmp.courriel(v text) returns text
language sql immutable as $$
  select lower(anon_tmp.prenom(v) || '.' || anon_tmp.nom(v) || '+'
    || substr(md5(coalesce(v,'')), 1, 6) || '@exemple.test')
$$;

create or replace function anon_tmp.tel(v text) returns text
language sql immutable as $$
  select '555-01' || lpad((anon_tmp.idx(v, 100))::text, 2, '0')
$$;

create or replace function anon_tmp.adresse(v text) returns text
language sql immutable as $$
  select (100 + anon_tmp.idx(v, 899))::text || ' ' || ({arr(RUES)})[anon_tmp.idx(v, {len(RUES)}) + 1]
$$;

create or replace function anon_tmp.ville(v text) returns text
language sql immutable as $$ select ({arr(VILLES)})[anon_tmp.idx(v, {len(VILLES)}) + 1] $$;

create or replace function anon_tmp.cp(v text) returns text
language sql immutable as $$
  select 'G' || (anon_tmp.idx(v, 10))::text || 'X ' || (anon_tmp.idx(v, 9) + 1)::text || 'Y'
    || (anon_tmp.idx(v || 'z', 9) + 1)::text
$$;
"""


# (motif de nom de colonne, expression SQL de remplacement) — premier motif gagnant
REGLES = [
    (r'(^|_)ip_address$',                      "'0.0.0.0'"),
    (r'first_name$',                           "anon_tmp.prenom({c}::text)"),
    (r'last_name$',                            "anon_tmp.nom({c}::text)"),
    (r'(full_name|display_name|client_name|actor_name|customer_name)$', "anon_tmp.nom_complet({c}::text)"),
    (r'(email|_email|email_address|recipient_email|billing_email|referred_email|support_email|from_email)$',
                                               "anon_tmp.courriel({c}::text)"),
    (r'(phone|phone_number|support_phone|_phone)$', "anon_tmp.tel({c}::text)"),
    (r'(postal_code|postal)$',                 "anon_tmp.cp({c}::text)"),
    (r'^city$',                                "anon_tmp.ville({c}::text)"),
    (r'(address|address_line1|address_line2|address_normalized|billing_address|street|street1|street2|street_name|service_address)$',
                                               "anon_tmp.adresse({c}::text)"),
    (r'street_number$',                        "(100 + anon_tmp.idx({c}::text, 899))::text"),
    (r'(tax_id|tax_number_1|tax_number_2)$',   "'000000000TQ0001'"),
    (r'birth_date$',                           "date '1990-01-01'"),
    (r'(^note$|^notes$|_notes$|^note_text$|footer_notes|internal_notes)$', "'Note de test (anonymisée)'"),
]

# Colonnes à ne PAS toucher : identifiants techniques, drapeaux, horodatages de consentement
EXCLUS = re.compile(
    r'(_id$|_sid$|_enabled$|_at$|has_|_type$|_label$|_reason$|_count$|^id$|stripe_|twilio_)')


def colonnes_pii(exec_sql):
    rows = exec_sql("""
        select c.relname, a.attname, format_type(a.atttypid, a.atttypmod)
        from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and a.attnum > 0 and not a.attisdropped and not a.attgenerated <> ''
        order by c.relname, a.attnum
    """, tuples=True)
    out = []
    for table, col, typ in rows:
        if EXCLUS.search(col):
            continue
        for motif, expr in REGLES:
            if not re.search(motif, col):
                continue
            # Le nom d'une colonne ne suffit pas : `notify_email` est un booléen,
            # `tax_ids` un tableau d'uuid. On ne remplace que ce qui est du texte
            # (ou le type exact attendu par la règle).
            est_texte = typ in ('text', 'character varying') or typ.startswith('character')
            if 'birth_date' in col:
                if typ != 'date':
                    break
            elif 'ip_address' in col:
                if typ not in ('inet', 'text', 'character varying'):
                    break
            elif not est_texte:
                break
            out.append((table, col, expr.format(c=f'"{col}"'), typ))
            break
    return out


def main():
    def exec_sql(sql, tuples=False):
        res = subprocess.run(
            ['docker', 'run', '--rm', '--network', 'host', '-e', 'PGPASSWORD=postgres',
             'postgres:17', 'psql', '-h', HOST, '-p', PORT, '-U', USER, '-d', DB,
             '-tAF', '\x1f', '-c', sql],
            capture_output=True, text=True)
        if res.returncode != 0:
            print(res.stderr[-1500:], file=sys.stderr)
            sys.exit('Échec SQL.')
        if not tuples:
            return res.stdout.strip()
        return [l.split('\x1f') for l in res.stdout.strip().split('\n') if l]

    # Garde-fou : on doit être sur le clone local, pas ailleurs.
    ident = exec_sql("select inet_server_addr()::text || '|' || current_database()")
    if not (ident.startswith('|') or ident.startswith('127.0.0.1') or ident.startswith('172.')):
        sys.exit(f'REFUS : cible inattendue ({ident}). Ce script ne tourne que sur le clone local.')

    print('→ Création des fonctions déterministes…')
    exec_sql(build_functions())

    cols = colonnes_pii(exec_sql)
    print(f'→ {len(cols)} colonnes personnelles détectées dans {len(set(t for t, _, _, _ in cols))} tables.')

    # Colonnes soumises à une contrainte d'unicité : les anonymiser à partir de
    # leur valeur ferait converger plusieurs lignes vers la même chaîne et
    # violerait l'index. On les dérive de l'`id` de la ligne, qui est unique.
    uniques = {tuple(r) for r in exec_sql("""
        select c.relname, a.attname
        from pg_index i
        join pg_class c on c.oid = i.indrelid
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
        where n.nspname = 'public' and i.indisunique
    """, tuples=True)}
    avec_id = {r[0] for r in exec_sql("""
        select c.relname from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attname = 'id'
        where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0
    """, tuples=True)}

    stmts = ['set session_replication_role = replica;']
    for table, col, expr, _ in cols:
        if (table, col) in uniques:
            if table not in avec_id:
                print(f'   ⏭  {table}.{col} : unique sans colonne id — laissée telle quelle')
                continue
            expr = expr.replace(f'"{col}"::text', 'id::text').replace(f'"{col}"', 'id::text')
        stmts.append(f'update public."{table}" set "{col}" = {expr} where "{col}" is not null;')
    # auth : courriels + un mot de passe commun connu, pour pouvoir se connecter
    stmts += [
        "update auth.users set email = anon_tmp.courriel(email), "
        "raw_user_meta_data = jsonb_set(coalesce(raw_user_meta_data,'{}'::jsonb), '{full_name}', "
        "to_jsonb(anon_tmp.nom_complet(coalesce(raw_user_meta_data->>'full_name', email)))) "
        "where email is not null;",
        "update auth.identities set identity_data = jsonb_set(identity_data, '{email}', "
        "to_jsonb(anon_tmp.courriel(identity_data->>'email'))) where identity_data ? 'email';",
        "update auth.users set encrypted_password = extensions.crypt('DevLocal1234!', extensions.gen_salt('bf'));",
        'set session_replication_role = origin;',
    ]

    print('→ Anonymisation…')
    exec_sql('\n'.join(stmts))

    # ── Cohérence ────────────────────────────────────────────────────────────
    # 1. L'identité des entités principales est dérivée de leur **id** (unique),
    #    pas de leur ancien nom : sinon deux clients différents peuvent hériter
    #    du même pseudonyme (collision de hachage sur 256 combinaisons).
    # 2. Les champs RECOPIÉS (jobs.client_name, invoices.*_snapshot…) sont
    #    ensuite re-dérivés de la fiche source, sinon un job affiche un autre
    #    nom que son propre client.
    print('→ Cohérence des identités et des champs recopiés…')
    exec_sql("""
set session_replication_role = replica;

update public.clients set
  first_name = anon_tmp.prenom(id::text),
  last_name  = anon_tmp.nom(id::text),
  email      = case when email is null then null else anon_tmp.courriel(id::text) end,
  phone      = case when phone is null then null else anon_tmp.tel(id::text) end;

update auth.users u set
  email = anon_tmp.courriel(u.id::text),
  raw_user_meta_data = jsonb_set(coalesce(u.raw_user_meta_data,'{}'::jsonb), '{full_name}',
                                 to_jsonb(anon_tmp.nom_complet(u.id::text)));
update auth.identities i set
  identity_data = jsonb_set(i.identity_data, '{email}', to_jsonb(anon_tmp.courriel(i.user_id::text)))
  where i.identity_data ? 'email';
update public.profiles p set full_name = anon_tmp.nom_complet(p.id::text);
update public.memberships m set full_name = anon_tmp.nom_complet(m.user_id::text)
  where m.full_name is not null;

update public.jobs j set client_name = c.first_name || ' ' || c.last_name
  from public.clients c where c.id = j.client_id and j.client_name is not null;
update public.conversations v set client_name = c.first_name || ' ' || c.last_name
  from public.clients c where c.id = v.client_id and v.client_name is not null;
update public.invoices i set
  client_name_snapshot  = c.first_name || ' ' || c.last_name,
  client_email_snapshot = c.email
  from public.clients c where c.id = i.client_id;

set session_replication_role = origin;
""")
    exec_sql('drop schema anon_tmp cascade;')

    reste = exec_sql("""
        select count(*) from (
          select 1 from public.clients where email not like '%@exemple.test'
          union all select 1 from auth.users where email not like '%@exemple.test'
        ) s
    """)
    print(f'✅ Anonymisation terminée. Traces réelles restantes : {reste}')
    print('   Connexion à n\'importe quel compte : mot de passe « DevLocal1234! »')
    return 0


if __name__ == '__main__':
    sys.exit(main())
