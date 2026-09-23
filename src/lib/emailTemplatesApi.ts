import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

export interface EmailTemplate {
  id: string;
  org_id: string;
  created_by: string | null;
  name: string;
  /**
   * Quel courriel ce texte remplace. La base en accepte 35 depuis la migration
   * 20260918100000 ; l'union figée à cinq valeurs qui vivait ici refusait un
   * modèle `contract_sent` avant même que la requête parte. Le catalogue
   * (`catalogueCourriels.ts`) décide lesquels sont offerts ; la base arbitre.
   */
  type: string;
  subject: string;
  body: string;
  variables: string[];
  is_active: boolean;
  is_default: boolean;
  /**
   * `editeur` = texte écrit dans l'app ; `import` = HTML fourni par
   * l'entreprise. Le serveur n'assainit agressivement (script, style, iframe,
   * on*, javascript:) que ce qui vient d'un import.
   */
  source: 'editeur' | 'import';
  created_at: string;
  updated_at: string;
}

export type EmailTemplateInput = Pick<
  EmailTemplate,
  'name' | 'type' | 'subject' | 'body' | 'variables' | 'is_active'
> & { source?: 'editeur' | 'import' };

export async function listEmailTemplates(
  type?: EmailTemplate['type']
): Promise<EmailTemplate[]> {
  let query = supabase
    .from('email_templates')
    .select('*')
    .order('is_default', { ascending: false })
    .order('name', { ascending: true });

  if (type) {
    query = query.eq('type', type);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as EmailTemplate[];
}

export async function getEmailTemplate(id: string): Promise<EmailTemplate> {
  const { data, error } = await supabase
    .from('email_templates')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as EmailTemplate;
}

export async function createEmailTemplate(input: EmailTemplateInput): Promise<EmailTemplate> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('email_templates')
    .insert({
      org_id: orgId,
      name: input.name,
      type: input.type,
      subject: input.subject,
      body: input.body,
      variables: input.variables,
      is_active: input.is_active,
      // Sans ce champ, un HTML importé était enregistré comme du texte
      // d'éditeur : le serveur ne l'assainissait pas, et un `<script>` collé
      // par une entreprise partait dans la boîte de chacun de ses clients.
      source: input.source ?? 'editeur',
    })
    .select()
    .single();
  if (error) throw error;
  return data as EmailTemplate;
}

export async function updateEmailTemplate(
  id: string,
  input: Partial<EmailTemplateInput>
): Promise<EmailTemplate> {
  const { data, error } = await supabase
    .from('email_templates')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as EmailTemplate;
}

export async function duplicateEmailTemplate(id: string): Promise<EmailTemplate> {
  const source = await getEmailTemplate(id);
  const orgId = await getCurrentOrgIdOrThrow();

  const { data, error } = await supabase
    .from('email_templates')
    .insert({
      org_id: (source as any).org_id ?? orgId,
      name: `${source.name} (Copy)`,
      type: source.type,
      subject: source.subject,
      body: source.body,
      variables: source.variables,
      is_active: source.is_active,
      is_default: false,
    })
    .select()
    .single();
  if (error) throw error;
  return data as EmailTemplate;
}

export async function setDefaultEmailTemplate(id: string): Promise<void> {
  // First get the template to know its type
  const template = await getEmailTemplate(id);

  // Unset all defaults of the same type
  const { error: unsetError } = await supabase
    .from('email_templates')
    .update({ is_default: false, updated_at: new Date().toISOString() })
    .eq('type', template.type)
    .eq('is_default', true);
  if (unsetError) throw unsetError;

  // Set this one as default
  const { error: setError } = await supabase
    .from('email_templates')
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (setError) throw setError;
}

export async function deleteEmailTemplate(id: string): Promise<void> {
  const { error } = await supabase
    .from('email_templates')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

export async function getDefaultEmailTemplate(
  type: EmailTemplate['type']
): Promise<EmailTemplate | null> {
  const { data, error } = await supabase
    .from('email_templates')
    .select('*')
    .eq('type', type)
    .eq('is_default', true)
    .maybeSingle();
  if (error) throw error;
  return (data as EmailTemplate) || null;
}

/**
 * L'aperçu d'un courriel, rendu par le SERVEUR.
 *
 * L'éditeur redessinait le courriel en React — fond, logo, pied — avec les
 * couleurs écrites en dur. Deux rendus pour une même chose, donc deux
 * vérités : le jour où le gabarit est passé du ciel bleu au gris neutre,
 * l'aperçu a continué d'afficher un décor que plus personne ne recevait.
 *
 * Une seule source désormais. Le serveur rend ce qu'il enverrait, l'app
 * l'affiche tel quel.
 *
 * Rend `null` en cas d'échec : l'éditeur garde alors son rendu de secours
 * plutôt que d'afficher un cadre vide — on peut toujours écrire son texte.
 */
export async function apercuCourriel(corpsHtml: string): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    const orgId = await getCurrentOrgIdOrThrow();
    const res = await fetch('/api/emails/apercu', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'x-org-id': orgId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ corpsHtml }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[emailTemplates] aperçu impossible', body?.error || res.status);
      return null;
    }
    return typeof body?.html === 'string' ? body.html : null;
  } catch (e) {
    console.error('[emailTemplates] aperçu impossible', e);
    return null;
  }
}

/**
 * S'envoyer le courriel à soi-même, pour le voir dans une vraie boîte.
 *
 * Sans ça, la seule façon de voir son courriel pour de vrai était d'envoyer
 * une vraie facture à un vrai client. L'adresse est TOUJOURS celle du compte
 * connecté, décidée côté serveur : cette route n'est pas un relais d'envoi.
 *
 * Rend l'adresse touchée, ou `null` en cas d'échec (le message est affiché
 * par l'appelant).
 */
export async function envoyerEssaiCourriel(corpsHtml: string, objet: string): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    const orgId = await getCurrentOrgIdOrThrow();
    const res = await fetch('/api/emails/apercu', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'x-org-id': orgId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ corpsHtml, objet, envoyer: true }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[emailTemplates] envoi d’essai impossible', body?.error || res.status);
      return null;
    }
    return typeof body?.envoye === 'string' ? body.envoye : null;
  } catch (e) {
    console.error('[emailTemplates] envoi d’essai impossible', e);
    return null;
  }
}
