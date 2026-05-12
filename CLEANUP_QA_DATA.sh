#!/bin/bash
# Cleanup script for QA artifacts created during the 2026-05-12 audit session.
# Run AFTER you've verified everything works. The harness blocked the AI from
# running this directly — run it yourself.
#
# Usage:
#   bash CLEANUP_QA_DATA.sh
# Or copy/paste line by line.

set -e

# Pull service role key from .env.local
if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  SRV=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d'"' -f2)
else
  SRV="$SUPABASE_SERVICE_ROLE_KEY"
fi

USERID="3d4019a5-0296-4598-8b0a-df8ed947b313"
ORGID="66f149e5-530f-4616-b99e-0c25314f8893"
URL="https://bbzcuzqfgsdvjsymfwmr.supabase.co"

echo "Deleting QA test data from production…"

# Order matters: child tables first, then parent
echo "- subscriptions"
curl -s -X DELETE "$URL/rest/v1/subscriptions?org_id=eq.$ORGID" -H "apikey: $SRV" -H "Authorization: Bearer $SRV"

echo "- invoices"
curl -s -X DELETE "$URL/rest/v1/invoices?org_id=eq.$ORGID" -H "apikey: $SRV" -H "Authorization: Bearer $SRV"

echo "- quotes"
curl -s -X DELETE "$URL/rest/v1/quotes?org_id=eq.$ORGID" -H "apikey: $SRV" -H "Authorization: Bearer $SRV"

echo "- clients"
curl -s -X DELETE "$URL/rest/v1/clients?org_id=eq.$ORGID" -H "apikey: $SRV" -H "Authorization: Bearer $SRV"

echo "- memberships"
curl -s -X DELETE "$URL/rest/v1/memberships?user_id=eq.$USERID" -H "apikey: $SRV" -H "Authorization: Bearer $SRV"

echo "- orgs"
curl -s -X DELETE "$URL/rest/v1/orgs?id=eq.$ORGID" -H "apikey: $SRV" -H "Authorization: Bearer $SRV"

echo "- auth user"
curl -s -X DELETE "$URL/auth/v1/admin/users/$USERID" -H "apikey: $SRV" -H "Authorization: Bearer $SRV"

echo ""
echo "Cleanup complete. You can also delete this script:"
echo "  rm CLEANUP_QA_DATA.sh"
