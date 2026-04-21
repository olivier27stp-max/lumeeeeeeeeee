import { config } from 'dotenv';
config({ path: '.env.local' });

import pg from 'pg';
const { Client } = pg;

async function run() {
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) {
    console.error('SUPABASE_DB_PASSWORD env var is required. Set it in .env.local or export it before running.');
    process.exit(1);
  }

  const client = new Client({
    host: process.env.SUPABASE_DB_HOST || 'db.bbzcuzqfgsdvjsymfwmr.supabase.co',
    port: Number(process.env.SUPABASE_DB_PORT || 5432),
    database: process.env.SUPABASE_DB_NAME || 'postgres',
    user: process.env.SUPABASE_DB_USER || 'postgres',
    password,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to database');

  // 1. Add missing columns to company_settings
  console.log('\n--- Adding missing company_settings columns ---');
  await client.query(`
    ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS review_enabled boolean NOT NULL DEFAULT false;
    ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS review_template_id uuid DEFAULT NULL;
    ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS review_widget_settings jsonb NOT NULL DEFAULT '{"theme":"light","filter":"all","layout":"cards","max_display":6}';
  `);
  console.log('company_settings columns added');

  // 2. Ensure review_requests table + RLS
  console.log('\n--- Ensuring review_requests table ---');
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.review_requests (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id          uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
      client_id       uuid REFERENCES public.clients(id) ON DELETE SET NULL,
      job_id          uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
      survey_id       uuid REFERENCES public.satisfaction_surveys(id) ON DELETE SET NULL,
      email_template_id uuid REFERENCES public.email_templates(id) ON DELETE SET NULL,
      subject_sent    text DEFAULT NULL,
      status          text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'sent', 'clicked', 'submitted', 'failed')),
      sent_at         timestamptz DEFAULT NULL,
      clicked_at      timestamptz DEFAULT NULL,
      submitted_at    timestamptz DEFAULT NULL,
      created_at      timestamptz NOT NULL DEFAULT now()
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_review_requests_org ON public.review_requests(org_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_review_requests_client ON public.review_requests(client_id, created_at DESC);
    ALTER TABLE public.review_requests ENABLE ROW LEVEL SECURITY;
  `);
  await client.query(`
    DROP POLICY IF EXISTS "review_requests_select_org" ON public.review_requests;
    CREATE POLICY "review_requests_select_org" ON public.review_requests
      FOR SELECT TO authenticated
      USING (org_id IN (SELECT m.org_id FROM public.memberships m WHERE m.user_id = auth.uid()));
    DROP POLICY IF EXISTS "review_requests_service" ON public.review_requests;
    CREATE POLICY "review_requests_service" ON public.review_requests
      FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  `);
  console.log('review_requests table ready');

  // 3. Create seed function + seed email templates
  console.log('\n--- Seeding email templates ---');

  // Check if already seeded
  const { rows: existingTemplates } = await client.query(
    `SELECT count(*) as c FROM public.email_templates WHERE org_id = $1`,
    ['4d885f6c-e076-4ed9-ab09-23637dbee6cd']
  );

  if (parseInt(existingTemplates[0].c) === 0) {
    await client.query(`
      INSERT INTO public.email_templates (org_id, name, type, subject, body, variables, is_active, is_default) VALUES
      ($1, 'Invoice Sent (Default)', 'invoice_sent',
        'Invoice {invoice_number} — {invoice_amount}',
        '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Hello {client_name},</h2><p>Please find below the details for your invoice.</p><table style="width:100%;border-collapse:collapse;margin:20px 0;"><tr><td style="padding:8px;border:1px solid #ddd;font-weight:600;">Invoice #</td><td style="padding:8px;border:1px solid #ddd;">{invoice_number}</td></tr><tr><td style="padding:8px;border:1px solid #ddd;font-weight:600;">Amount</td><td style="padding:8px;border:1px solid #ddd;">{invoice_amount}</td></tr><tr><td style="padding:8px;border:1px solid #ddd;font-weight:600;">Due Date</td><td style="padding:8px;border:1px solid #ddd;">{due_date}</td></tr></table><p style="text-align:center;margin:30px 0;"><a href="{payment_link}" style="background:#2563eb;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">View Invoice</a></p><p>Thank you,<br/>{company_name}</p></div>',
        '["client_name","company_name","invoice_number","invoice_amount","due_date","payment_link"]'::jsonb,
        true, true),
      ($1, 'Invoice Reminder (Default)', 'invoice_reminder',
        'Reminder: Invoice {invoice_number} Past Due',
        '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Hello {client_name},</h2><p>This is a friendly reminder that invoice <strong>{invoice_number}</strong> for <strong>{invoice_amount}</strong> is past due.</p><p>Please arrange payment at your earliest convenience.</p><p style="text-align:center;margin:30px 0;"><a href="{payment_link}" style="background:#dc2626;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">Pay Now</a></p><p>Thank you,<br/>{company_name}</p></div>',
        '["client_name","company_name","invoice_number","invoice_amount","due_date","payment_link"]'::jsonb,
        true, true),
      ($1, 'Quote Sent (Default)', 'quote_sent',
        'Estimate from {company_name}',
        '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Hello {client_name},</h2><p>We have prepared an estimate for you. Please review the details below:</p><p><strong>Amount:</strong> {invoice_amount}</p><p style="text-align:center;margin:30px 0;"><a href="{payment_link}" style="background:#2563eb;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">View Estimate</a></p><p>Best regards,<br/>{company_name}</p></div>',
        '["client_name","company_name","invoice_amount","payment_link"]'::jsonb,
        true, true),
      ($1, 'Review Request (Default)', 'review_request',
        '{company_name} — How was your experience?',
        '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Hi {client_name},</h2><p>We recently completed <strong>{job_name}</strong> and would love to hear your feedback!</p><p>Please take a moment to rate your experience:</p><p style="text-align:center;margin:30px 0;"><a href="{review_link}" style="background:#2563eb;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">Rate Your Experience</a></p><p>Thank you for choosing {company_name}!</p></div>',
        '["client_name","company_name","job_name","review_link"]'::jsonb,
        true, true);
    `, ['4d885f6c-e076-4ed9-ab09-23637dbee6cd']);
    console.log('Email templates seeded');
  } else {
    console.log('Email templates already exist:', existingTemplates[0].c);
  }

  // 4. Reload PostgREST schema cache
  console.log('\n--- Reloading PostgREST schema cache ---');
  await client.query(`NOTIFY pgrst, 'reload schema'`);
  console.log('Schema cache reload notified');

  // 5. Verify
  console.log('\n--- Verification ---');
  const { rows: cols } = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'company_settings' AND column_name IN ('review_enabled', 'review_widget_settings', 'review_template_id')
    ORDER BY column_name
  `);
  console.log('company_settings new columns:', cols.map(r => r.column_name));

  const { rows: etCount } = await client.query(
    `SELECT count(*) as c FROM public.email_templates WHERE org_id = $1`,
    ['4d885f6c-e076-4ed9-ab09-23637dbee6cd']
  );
  console.log('Email templates for org:', etCount[0].c);

  const { rows: rrCheck } = await client.query(`SELECT count(*) as c FROM public.review_requests`);
  console.log('Review requests table rows:', rrCheck[0].c);

  await client.end();
  console.log('\nDone!');
}

run().catch(err => { console.error(err); process.exit(1); });
