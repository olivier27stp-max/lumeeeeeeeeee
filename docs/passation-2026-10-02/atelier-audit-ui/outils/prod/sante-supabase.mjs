// Santé du projet Supabase de PROD par l'API de gestion. LECTURE SEULE (GET). Le jeton vient de .env.local.
const ref = 'bbzcuzqfgsdvjsymfwmr';
const jeton = process.env.SUPABASE_ACCESS_TOKEN;
if (!jeton) throw new Error('SUPABASE_ACCESS_TOKEN manquant (.env.local)');
const lire = async (chemin) => {
  try {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}${chemin}`, { headers: { Authorization: `Bearer ${jeton}` }, signal: AbortSignal.timeout(20_000) });
    return { status: r.status, corps: await r.json().catch(() => null) };
  } catch (e) { return { status: 0, corps: String(e).slice(0, 120) }; }
};
const projet = await lire('');
console.log(new Date().toISOString().slice(11, 19), 'UTC · projet :', projet.status, projet.corps?.status ?? projet.corps);
const sante = await lire('/health?services=db&services=rest&services=auth&services=storage&services=pooler&services=realtime');
if (Array.isArray(sante.corps)) for (const s of sante.corps) console.log(' ', s.name, '→', s.status, s.error ? `(${String(s.error).slice(0, 80)})` : '');
else console.log('  santé :', sante.status, JSON.stringify(sante.corps).slice(0, 200));
try {
  const t = Date.now();
  const r = await fetch('https://lumecrm.net/api/health', { signal: AbortSignal.timeout(12_000) });
  console.log('  lumecrm.net/api/health :', r.status, 'en', Date.now() - t, 'ms', (await r.text()).slice(0, 90));
} catch (e) { console.log('  lumecrm.net/api/health : pas de réponse en 12 s'); }
