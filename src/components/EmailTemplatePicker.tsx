import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Code, Eye, Mail } from 'lucide-react';
import DOMPurify from 'dompurify';
import { listEmailTemplates, EmailTemplate } from '../lib/emailTemplatesApi';

interface Props {
  type: 'invoice_sent' | 'invoice_reminder' | 'quote_sent' | 'review_request' | 'generic';
  subject: string;
  body: string;
  onSubjectChange: (s: string) => void;
  onBodyChange: (b: string) => void;
  variables?: Record<string, string>;
}

const AVAILABLE_VARIABLES = [
  '{client_name}',
  '{company_name}',
  '{invoice_number}',
  '{invoice_amount}',
  '{due_date}',
  '{payment_link}',
  '{review_link}',
  '{job_name}',
];

export default function EmailTemplatePicker({
  type,
  subject,
  body,
  onSubjectChange,
  onBodyChange,
  variables,
}: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const { data: templates = [] } = useQuery({
    queryKey: ['emailTemplates', type],
    queryFn: () => listEmailTemplates(type),
  });

  function handleSelectTemplate(template: EmailTemplate) {
    onSubjectChange(template.subject);
    onBodyChange(template.body);
    setDropdownOpen(false);
  }

  function insertVariable(variable: string) {
    const textarea = bodyRef.current;
    if (!textarea) {
      onBodyChange(body + variable);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = body.slice(0, start);
    const after = body.slice(end);
    const newBody = before + variable + after;
    onBodyChange(newBody);

    // Restore cursor position after the inserted variable
    requestAnimationFrame(() => {
      textarea.focus();
      const newPos = start + variable.length;
      textarea.setSelectionRange(newPos, newPos);
    });
  }

  function resolveVariables(text: string): string {
    if (!variables) return text;
    let resolved = text;
    for (const [key, value] of Object.entries(variables)) {
      const token = key.startsWith('{') ? key : `{${key}}`;
      resolved = resolved.replaceAll(token, value);
    }
    return resolved;
  }

  return (
    <div className="space-y-3">
      {/* Template selector */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold uppercase tracking-widest text-text-secondary flex items-center gap-1.5">
          <Mail size={12} />
          Email Template
        </label>
        <div className="relative">
          <button
            type="button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="glass-input w-full text-left flex items-center justify-between"
          >
            <span className="text-sm text-text-secondary truncate">
              {templates.length > 0 ? 'Select a template...' : 'No templates available'}
            </span>
            <ChevronDown
              size={14}
              className={`text-text-tertiary transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {dropdownOpen && templates.length > 0 && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} />
              <div className="absolute left-0 right-0 top-full mt-1 z-20 max-h-48 overflow-y-auto rounded-xl border border-outline bg-surface shadow-xl py-1">
                {templates.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => handleSelectTemplate(tpl)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-text-primary hover:bg-surface-secondary transition-colors"
                  >
                    <span className="truncate">{tpl.name}</span>
                    {tpl.is_default && (
                      <span className="shrink-0 ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary uppercase">
                        Default
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Subject */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold uppercase tracking-widest text-text-secondary">
          Subject
        </label>
        <input
          value={subject}
          onChange={(e) => onSubjectChange(e.target.value)}
          placeholder="Email subject line"
          className="glass-input w-full"
        />
      </div>

      {/* Body */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-widest text-text-secondary">
            Body
          </label>
          <button
            type="button"
            onClick={() => setShowPreview(!showPreview)}
            className="inline-flex items-center gap-1 text-xs font-medium text-text-tertiary hover:text-text-primary transition-colors"
          >
            {showPreview ? (
              <>
                <Code size={11} />
                Edit
              </>
            ) : (
              <>
                <Eye size={11} />
                Preview
              </>
            )}
          </button>
        </div>

        {showPreview ? (
          <div className="glass-input w-full min-h-[120px] p-3 text-sm text-text-primary prose prose-sm max-w-none">
            <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(resolveVariables(body), { ALLOWED_TAGS: ['b', 'i', 'u', 'p', 'br', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'span', 'div', 'table', 'tr', 'td', 'th', 'thead', 'tbody'], ALLOWED_ATTR: ['href', 'style', 'class'] }) }} />
          </div>
        ) : (
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => onBodyChange(e.target.value)}
            placeholder="Write your email body here. Use variables like {client_name} for personalization."
            rows={6}
            className="glass-input w-full resize-none"
          />
        )}
      </div>

      {/* Variable chips */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold uppercase tracking-widest text-text-secondary">
          Available Variables
        </label>
        <div className="flex flex-wrap gap-1.5">
          {AVAILABLE_VARIABLES.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => insertVariable(v)}
              className="inline-flex items-center rounded-full border border-outline bg-surface-secondary/50 px-2.5 py-1 text-[11px] font-mono font-semibold text-text-secondary hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-colors"
            >
              {v}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-text-tertiary">
          Click a variable to insert it at the cursor position in the body.
        </p>
      </div>
    </div>
  );
}
