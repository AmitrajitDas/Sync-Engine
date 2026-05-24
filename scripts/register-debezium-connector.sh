#!/usr/bin/env bash
set -euo pipefail

CONNECT_URL="${CONNECT_URL:-http://localhost:8083}"
CONNECTOR_NAME="rbac-postgres-cdc"

echo "Checking Kafka Connect at $CONNECT_URL …"
for i in $(seq 1 20); do
  if curl -sf "$CONNECT_URL/connectors" > /dev/null; then
    break
  fi
  echo "  Connect not ready (attempt $i/20), retrying in 5s …"
  sleep 5
done
curl -sf "$CONNECT_URL/connectors" > /dev/null || { echo "ERROR: Connect not reachable at $CONNECT_URL"; exit 1; }

# Idempotent: delete existing connector if present
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$CONNECT_URL/connectors/$CONNECTOR_NAME")
if [ "$STATUS" = "200" ]; then
  echo "Deleting existing connector $CONNECTOR_NAME …"
  curl -sf -X DELETE "$CONNECT_URL/connectors/$CONNECTOR_NAME"
  sleep 2
fi

echo "Registering connector $CONNECTOR_NAME …"
curl -sf -X POST "$CONNECT_URL/connectors" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"$CONNECTOR_NAME\",
    \"config\": {
      \"connector.class\": \"io.debezium.connector.postgresql.PostgresConnector\",
      \"database.hostname\": \"${PG_HOST:-postgres}\",
      \"database.port\": \"${PG_PORT:-5432}\",
      \"database.user\": \"${PG_USER:-rbac}\",
      \"database.password\": \"${PG_PASSWORD:-rbac}\",
      \"database.dbname\": \"${PG_DBNAME:-rbac}\",
      \"database.server.name\": \"business\",
      \"topic.prefix\": \"business\",
      \"schema.include.list\": \"public\",
      \"plugin.name\": \"pgoutput\",
      \"slot.name\": \"sync_slot\",
      \"publication.name\": \"sync_pub\",
      \"table.include.list\": \"public.farms,public.plots,public.crops,public.action_events,public.inspections,public.gdc_submissions,public.invoices,public.farm_members,public.attachments\",
      \"transforms\": \"route\",
      \"transforms.route.type\": \"org.apache.kafka.connect.transforms.ReplaceField\$Value\",
      \"decimal.handling.mode\": \"string\",
      \"time.precision.mode\": \"connect\"
    }
  }"

echo ""
echo "Connector $CONNECTOR_NAME registered. Topics: business.cdc.public.<table>"
