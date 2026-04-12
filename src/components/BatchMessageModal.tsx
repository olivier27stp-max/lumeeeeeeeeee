/**
 * Batch Personalized Message Modal
 * Send SMS or Email to multiple clients with template variables:
 * {first_name}, {last_name}, {company}, {address}, {phone}, {email}
 * Each message is personalized per client before sending.
 */

import React, { useState } from 'react';
import { motion } from 'motion/react';
import { X, Send, MessageSquare, Mail, Users } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';

interface Client {
  id: string;
  first_name: string;
  last_name: string;
  company?: string;
  email?: string;
  phone?: string;
  address?: string;
}

interface BatchMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  clients: Client[];
  language?: string;
}

const TEMPLATE_VARS = [
  { key: '{first_name}', label: 'First Name' },
  { key: '{last_name}', label: 'Last Name' },
  { key: '{company}', label: 'Company' },
  { key: '{email}', label: 'Email' },
  { key: '{phone}', label: 'Phone' },
  { key: '{address}', label: 'Address' },
];

function personalizeMessage(template: string, client: Client): string {
  return template
    .replace(/\{first_name\}/g, client.first_name || '')
    .replace(/\{last_name\}/g, client.last_name || '')
    .replace(/\{company\}/g, client.company || '')
    .replace(/\{email\}/g, client.email || '')
    .replace(/\{phone\}/g, client.phone || '')
    .replace(/\{address\}/g, client.address || '');
}

export default function BatchMessageModal({ isOpen, onClose, clients, language }: BatchMessageModalProps) {
  const fr = language === 'fr';
  const [mode, setMode] = useState<'sms' | 'email'>('email');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState(fr
    ? 'Bonjour {first_name},\n\n'
    : 'Hi {first_name},\n\n');
  const [sending, setSending] = useState(false);
  const [previewIdx, setPreviewIdx] = useState(0);

  if (!isOpen) return null;

  const previewClient = clients[previewIdx] || clients[0];
  const previewText = previewClient ? personalizeMessage(body, previewClient) : body;
  const previewSubject = previewClient ? personalizeMessage(subject, previewClient) : subject;

  const eligibleClients = mode === 'sms'
    ? clients.filter(c => c.phone)
    : clients.filter(c => c.email);

  const handleSend = async () => {
    if (!body.trim()) { toast.error('Message is empty'); return; }
    if (eligibleClients.length === 0) { toast.error(`No clients with ${mode === 'sms' ? 'phone' : 'email'}`); return; }

    setSending(true);
    let sent = 0;
    let failed = 0;

    for (const client of eligibleClients) {
      const personalizedBody = personalizeMessage(body, client);
      const personalizedSubject = personalizeMessage(subject, client);

      try {
        if (mode === 'email' && client.email) {
          const res = await fetch('/api/emails/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${(await (await import('../lib/supabase')).supabase.auth.getSession()).data.session?.access_token}` },
            body: JSON.stringify({ to: client.email, subject: personalizedSubject || 'Message from our team', html: personalizedBody.replace(/\n/g, '<br>') }),
          });
          if (res.ok) sent++; else failed++;
        } else if (mode === 'sms' && client.phone) {
          const res = await fetch('/api/messages/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${(await (await import('../lib/supabase')).supabase.auth.getSession()).data.session?.access_token}` },
            body: JSON.stringify({ to: client.phone, message: personalizedBody, client_id: client.id }),
          });
          if (res.ok) sent++; else failed++;
        }
      } catch { failed++; }
    }

    setSending(false);
    if (sent > 0) toast.success(`${sent} message${sent > 1 ? 's' : ''} sent`);
    if (failed > 0) toast.error(`${failed} failed`);
    if (sent > 0 && failed === 0) onClose();
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="bg-surface border border-outline rounded-2xl shadow-2xl w-[560px] max-h-[85vh] overflow-hidden flex flex-col">

        {/* Header */}
        <div className="px-5 py-4 border-b border-outline flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={15} className="text-text-tertiary" />
            <h2 className="text-[14px] font-bold text-text-primary">
              {fr ? 'Message groupé' : 'Batch Message'} — {eligibleClients.length} {fr ? 'destinataires' : 'recipients'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-secondary text-text-tertiary"><X size={15} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Mode toggle */}
          <div className="flex items-center gap-1 p-0.5 bg-surface-secondary rounded-lg w-fit">
            <button onClick={() => setMode('email')}
              className={cn('px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors',
                mode === 'email' ? 'bg-primary text-white' : 'text-text-tertiary hover:text-text-secondary')}>
              <Mail size={11} className="inline mr-1" /> Email
            </button>
            <button onClick={() => setMode('sms')}
              className={cn('px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors',
                mode === 'sms' ? 'bg-primary text-white' : 'text-text-tertiary hover:text-text-secondary')}>
              <MessageSquare size={11} className="inline mr-1" /> SMS
            </button>
          </div>

          {/* Subject (email only) */}
          {mode === 'email' && (
            <div>
              <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider block mb-1">{fr ? 'Objet' : 'Subject'}</label>
              <input value={subject} onChange={(e) => setSubject(e.target.value)}
                placeholder={fr ? 'Objet du email...' : 'Email subject...'}
                className="w-full px-3 py-2 text-[12px] bg-surface-secondary border border-outline rounded-lg text-text-primary placeholder:text-text-tertiary outline-none focus:border-text-tertiary" />
            </div>
          )}

          {/* Template variables */}
          <div>
            <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider block mb-1.5">{fr ? 'Variables' : 'Template Variables'}</label>
            <div className="flex flex-wrap gap-1">
              {TEMPLATE_VARS.map((v) => (
                <button key={v.key} onClick={() => setBody(prev => prev + v.key)}
                  className="px-2 py-0.5 rounded-md text-[10px] font-medium border border-outline text-text-tertiary hover:text-text-primary hover:border-text-tertiary transition-colors">
                  {v.key}
                </button>
              ))}
            </div>
          </div>

          {/* Message body */}
          <div>
            <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider block mb-1">Message</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6}
              className="w-full px-3 py-2 text-[12px] bg-surface-secondary border border-outline rounded-lg text-text-primary placeholder:text-text-tertiary resize-none outline-none focus:border-text-tertiary font-mono" />
          </div>

          {/* Preview */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider">{fr ? 'Aperçu' : 'Preview'}</label>
              {clients.length > 1 && (
                <div className="flex items-center gap-1">
                  <button onClick={() => setPreviewIdx(Math.max(0, previewIdx - 1))} disabled={previewIdx === 0}
                    className="text-[10px] text-text-tertiary hover:text-text-primary disabled:opacity-30">&lt;</button>
                  <span className="text-[10px] text-text-tertiary">{previewClient?.first_name} {previewClient?.last_name}</span>
                  <button onClick={() => setPreviewIdx(Math.min(clients.length - 1, previewIdx + 1))} disabled={previewIdx >= clients.length - 1}
                    className="text-[10px] text-text-tertiary hover:text-text-primary disabled:opacity-30">&gt;</button>
                </div>
              )}
            </div>
            <div className="p-3 bg-surface-secondary rounded-lg border border-outline">
              {mode === 'email' && previewSubject && (
                <p className="text-xs font-medium text-text-primary mb-1">{previewSubject}</p>
              )}
              <p className="text-[11px] text-text-secondary whitespace-pre-wrap">{previewText}</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-outline flex items-center justify-between">
          <span className="text-[10px] text-text-tertiary">
            {eligibleClients.length} / {clients.length} {fr ? 'avec' : 'with'} {mode === 'sms' ? 'phone' : 'email'}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-outline text-[11px] font-medium text-text-tertiary hover:text-text-secondary">
              {fr ? 'Annuler' : 'Cancel'}
            </button>
            <button onClick={handleSend} disabled={sending || eligibleClients.length === 0}
              className="px-4 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:opacity-90 transition-all disabled:opacity-40 inline-flex items-center gap-1.5">
              <Send size={11} /> {sending ? (fr ? 'Envoi...' : 'Sending...') : (fr ? `Envoyer (${eligibleClients.length})` : `Send (${eligibleClients.length})`)}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
