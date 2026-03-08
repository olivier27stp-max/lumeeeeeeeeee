// Compatibility shim:
// This workspace currently serves /api routes via Express (`server/index.ts`).
// The real implementation for /api/payments/keys lives there.

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST() {
  return json(
    {
      error: 'Not wired in this build. Use Express endpoint /api/payments/keys.',
    },
    501
  );
}

