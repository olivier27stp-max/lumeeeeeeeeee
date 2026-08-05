#!/usr/bin/env python3
"""
db-diff.py — Compare le schéma Supabase PROD vs STAGING et rapporte toute dérive.

Usage:  python3 scripts/db-diff.py        (ou: npm run db:diff)

Prérequis: Docker démarré, et dans .env.local :
  SUPABASE_DB_PASSWORD=...        (mot de passe Postgres, identique prod/staging)

Sort avec code 0 si identique, 1 si dérive détectée.
Aucun delta assumé : les deux bases doivent être STRICTEMENT identiques (staging
est la référence de développement). Seul l'ordre d'affichage des rôles dans les
policies est normalisé — artefact pg_dump non déterministe, pas un écart réel.
"""
import os, re, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PROD = {"ref": "bbzcuzqfgsdvjsymfwmr", "host": "aws-1-ca-central-1.pooler.supabase.com"}
STAGING = {"ref": "boylnjjlhexljmddmjyg", "host": "aws-0-ca-central-1.pooler.supabase.com"}
IGNORED_STAGING_ONLY: set[str] = set()  # aucun écart toléré côté objets

# Seule exception admise, et elle n'est PAS un choix : les DEFAULT PRIVILEGES
# appartenant au rôle `supabase_admin` ne peuvent être posés ni par `postgres`
# ni par l'API de gestion (42501 permission denied dans les deux cas). Ils sont
# créés par la plateforme à la naissance du projet ; un `drop schema public`
# les détruit sans retour possible — d'où l'interdiction, dans
# clone-prod-to-staging.sh, de supprimer le schéma plutôt que de le vider.
# Ils ne régissent que les objets créés PAR supabase_admin ; nos migrations
# créent tout en tant que `postgres`, donc aucun effet fonctionnel.
IGNORED_DEFAULT_ACL = {
    'DEFAULT PRIVILEGES FOR FUNCTIONS',
    'DEFAULT PRIVILEGES FOR SEQUENCES',
    'DEFAULT PRIVILEGES FOR TABLES',
}


def env_password():
    with open(os.path.join(ROOT, ".env.local")) as f:
        for line in f:
            if line.startswith("SUPABASE_DB_PASSWORD="):
                return line.split("=", 1)[1].strip().strip('"')
    print("ERREUR: SUPABASE_DB_PASSWORD manquant dans .env.local", file=sys.stderr)
    sys.exit(2)


def dump(target, password, out_path):
    cmd = [
        "docker", "run", "--rm", "-e", f"PGPASSWORD={password}",
        "postgres:17", "pg_dump",
        "-h", target["host"], "-p", "5432",
        "-U", f"postgres.{target['ref']}", "-d", "postgres",
        "--schema-only", "--no-owner", "-n", "public", "-n", "app", "-n", "archive",
    ]
    with open(out_path, "w") as f:
        subprocess.run(cmd, stdout=f, check=True)


def parse(path):
    """Découpe le dump en sections objet, en filtrant les artefacts de dump."""
    objs, cur, buf = {}, None, []
    for l in open(path):
        m = re.match(r"^-- Name: (.*); Type: (.*); Schema: (.*); Owner:", l)
        if m:
            if cur:
                objs.setdefault(cur, []).append("".join(buf))
            cur = (m.group(3), m.group(2), m.group(1))
            buf = []
        elif cur is not None:
            if l.startswith("\\restrict") or l.startswith("\\unrestrict"):
                continue
            buf.append(l)
    if cur:
        objs.setdefault(cur, []).append("".join(buf))
    return {k: "\n".join(v).strip() for k, v in objs.items()}


def norm_policy(t):
    """Trie les rôles d'un CREATE POLICY (ordre non déterministe entre serveurs)."""
    return re.sub(
        r"TO ([a-z_, ]+?)( USING| WITH CHECK|;)",
        lambda m: "TO " + ", ".join(sorted(r.strip() for r in m.group(1).split(","))) + m.group(2),
        t,
    )


def main():
    password = env_password()
    with tempfile.TemporaryDirectory() as tmp:
        p_path, s_path = os.path.join(tmp, "prod.sql"), os.path.join(tmp, "staging.sql")
        print("Dump de la prod…")
        dump(PROD, password, p_path)
        print("Dump du staging…")
        dump(STAGING, password, s_path)
        prod, stag = parse(p_path), parse(s_path)

    only_prod = sorted(set(prod) - set(stag))
    only_stag = sorted(k for k in set(stag) - set(prod) if k[2] not in IGNORED_STAGING_ONLY)
    changed = []
    for k in sorted(set(prod) & set(stag)):
        if k[1] == 'DEFAULT ACL' and k[2] in IGNORED_DEFAULT_ACL:
            continue
        a, b = prod[k], stag[k]
        if k[1] == "POLICY" or (k[1] == "ACL" and "POLICY" in k[2]):
            a, b = norm_policy(a), norm_policy(b)
        if a != b:
            changed.append(k)

    if not only_prod and not only_stag and not changed:
        print("✓ Schémas IDENTIQUES (prod == staging)")
        return 0

    print("✗ DÉRIVE DÉTECTÉE\n")
    if only_prod:
        print(f"— Présent en PROD seulement ({len(only_prod)}) → staging est en retard :")
        for k in only_prod:
            print(f"    {k[2]}  [{k[1]}, schéma {k[0]}]")
    if only_stag:
        print(f"— Présent en STAGING seulement ({len(only_stag)}) → à nettoyer ou à déployer en prod :")
        for k in only_stag:
            print(f"    {k[2]}  [{k[1]}, schéma {k[0]}]")
    if changed:
        print(f"— Corps différent ({len(changed)}) :")
        for k in changed:
            print(f"    {k[2]}  [{k[1]}, schéma {k[0]}]")
    print("\nPour resynchroniser : appliquer la migration manquante sur le côté en retard")
    print("(npm run db:apply -- <fichier.sql> pour staging, npm run db:apply -- --prod <fichier.sql> pour prod).")
    return 1


if __name__ == "__main__":
    sys.exit(main())
