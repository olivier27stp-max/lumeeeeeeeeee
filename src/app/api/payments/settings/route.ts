// Compatibility shim:
// This workspace currently uses an Express API server (`server/index.ts`) for /api routes.
// The real implementation for /api/payments/settings lives there.
// This file exists so a Next.js App Router migration has a clear target path.

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function GET() {
  return json(
    {
      error: 'Not wired in this build. Use Express endpoint /api/payments/settings.',
    },
    501
  );
}

export async function POST() {
  return json(
    {
      error: 'Not wired in this build. Use Express endpoint /api/payments/settings.',
    },
    501
  );
}
