// roles-05, côté serveur : POST et PATCH n'écrivent plus « publiée » avec le client de l'utilisateur.
import { readFileSync, writeFileSync } from 'node:fs';
const f = 'D:/lume-uiaudit/wt-lumi/server/routes/automation-rules.ts';
let s = readFileSync(f, 'utf8');
const r = (a, b, quoi) => { if (!s.includes(a)) throw new Error('introuvable : ' + quoi); s = s.replace(a, b); };

r(`      // Une automatisation naît en pause : elle écrit aux clients, personne ne
      // doit en démarrer une par accident en fermant le formulaire.
      is_active: req.body.is_active ?? false,
      is_preset: false,
      preset_key: null,
    })
    .select(COLONNES)
    .single();

  if (error) {
    // 42501 = la RLS a refusé : l'utilisateur n'a pas \`automations.update\`.
    if (error.code === '42501') {
      return res.status(403).json({ error: 'Votre rôle ne permet pas de créer une automatisation.' });
    }
    logger.error('[automation-rules] création échouée', { message: error.message, code: error.code });
    return res.status(500).json({ error: 'Impossible de créer l\'automatisation.' });
  }

  return res.status(201).json(data);`,
`      // Une automatisation naît en pause : elle écrit aux clients, personne ne
      // doit en démarrer une par accident en fermant le formulaire. TOUJOURS
      // en brouillon ici : la base refuse à une session d'utilisateur d'écrire
      // « publiée » (roles-05) ; la publication demandée suit, par le serveur.
      is_active: false,
      is_preset: false,
      preset_key: null,
    })
    .select(COLONNES)
    .single();

  if (error) {
    // 42501 = la RLS a refusé : l'utilisateur n'a pas \`automations.update\`.
    if (error.code === '42501') {
      return res.status(403).json({ error: 'Votre rôle ne permet pas de créer une automatisation.' });
    }
    logger.error('[automation-rules] création échouée', { message: error.message, code: error.code });
    return res.status(500).json({ error: 'Impossible de créer l\'automatisation.' });
  }

  // Naître publiée : les contrôles ont passé plus haut, et l'insertion par
  // l'utilisateur vient de prouver son droit sur ce bureau.
  if (req.body.is_active === true) {
    const creee = data as unknown as { id: string; is_active: boolean };
    const { error: ePub } = await activerApresEcritureUtilisateur(auth.orgId, creee.id);
    if (ePub) {
      // Elle existe, en brouillon : on le dit plutôt que de laisser croire qu'elle tourne.
      logger.error('[automation-rules] publication à la création échouée', { rule_id: creee.id, message: ePub.message });
      return res.status(201).json({ ...creee, is_active: false, avis: fr
        ? 'Créée en brouillon : la publication a échoué, publiez-la depuis la liste.'
        : 'Created as a draft: publishing failed, publish it from the list.' });
    }
    return res.status(201).json({ ...creee, is_active: true });
  }

  return res.status(201).json(data);`, 'POST');

r(`  const { data, error } = await auth.client
    .from('automation_rules')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId)
    .select(COLONNES)
    .single();

  if (error) {
    if (error.code === '42501') {
      return res.status(403).json({ error: 'Votre rôle ne permet pas de modifier une automatisation.' });
    }`,
`  /*
   * PUBLIER par ce chemin (roles-05) : la base refuse à une session
   * d'utilisateur de faire passer \`is_active\` de faux à vrai. Le reste de la
   * modification part avec le client de l'utilisateur — c'est aussi la preuve
   * de son droit — puis le serveur publie. Les contrôles de publication ont
   * passé juste au-dessus, sur la règle telle qu'elle sera.
   */
  const aPublier = patch.is_active === true && !existante.is_active;
  if (aPublier) delete patch.is_active;

  const { data, error } = await auth.client
    .from('automation_rules')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId)
    .select(COLONNES)
    .single();

  if (!error && aPublier) {
    const { error: ePub } = await activerApresEcritureUtilisateur(auth.orgId, req.params.id);
    if (ePub) {
      logger.error('[automation-rules] publication par modification échouée', { rule_id: req.params.id, message: ePub.message });
      return res.status(500).json({ error: fr
        ? 'La modification est enregistrée, mais la publication a échoué — réessayez de publier.'
        : 'The change is saved, but publishing failed — try publishing again.' });
    }
    (data as unknown as { is_active: boolean }).is_active = true;
  }

  if (error) {
    if (error.code === '42501') {
      return res.status(403).json({ error: 'Votre rôle ne permet pas de modifier une automatisation.' });
    }`, 'PATCH');
writeFileSync(f, s);
console.log('routes ok');
