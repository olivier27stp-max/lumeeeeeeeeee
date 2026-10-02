// Santé du projet Supabase de STAGING par l'API de gestion. LECTURE SEULE (GET).
const ref = process.env.SUPABASE_PROJECT_REF;
const jeton = process.env.SUPABASE_ACCESS_TOKEN;
if (!jeton || !ref) throw new Error('SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF manquants (.env.local)');
const lire = async (chemin) => {
  try {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}${chemin}`, { headers: { Authorization: `Bearer ${jeton}` }, signal: AbortSignal.timeout(20000) });
    return { status: r.status, corps: await r.json().catch(() => null) };
  } catch (e) { return { status: 0, corps: String(e).slice(0, 120) }; }
};
const projet = await lire('');
console.log(new Date().toISOString().slice(11, 19), 'UTC · staging :', projet.status, projet.corps?.status ?? projet.corps);
const sante = await lire('/health?services=db&services=rest&services=auth&services=pooler');
if (Array.isArray(sante.corps)) for (const s of sante.corps) console.log(' ', s.name, '->', s.status, s.error ? `(${String(s.error).slice(0, 80)})` : '');
else console.log('  sante :', sante.status, JSON.stringify(sante.corps).slice(0, 200));
