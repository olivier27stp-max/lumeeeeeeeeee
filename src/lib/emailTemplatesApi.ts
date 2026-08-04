import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

export interface EmailTemplate {
  id: string;
  org_id: string;
  created_by: string | null;
  name: string;
  type: 'invoice_sent' | 'invoice_reminder' | 'quote_sent' | 'review_request' | 'generic';
  subject: string;
  body: string;
  variables: string[];
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export type EmailTemplateInput = Pick<
  EmailTemplate,
  'name' | 'type' | 'subject' | 'body' | 'variables' | 'is_active'
>;

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
