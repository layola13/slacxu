#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DEPLOY_DIR="$ROOT_DIR/deploy"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.yml"
ENV_FILE="$ROOT_DIR/.env"
DOMAIN="free.codex-ultra.top"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$ROOT_DIR/data" "$DEPLOY_DIR/certbot/www" "$DEPLOY_DIR/certbot/conf" "$DEPLOY_DIR/nginx"
cp "$DEPLOY_DIR/nginx/http.conf" "$DEPLOY_DIR/nginx/default.conf"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build free-key-server nginx

attempt=0
until curl -fsS "http://127.0.0.1/health" >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=200
    echo "HTTP health check did not become ready" >&2
    exit 1
  fi
  sleep 2
done

if [ ! -f "$DEPLOY_DIR/certbot/conf/live/$DOMAIN/fullchain.pem" ]; then
  email=$(grep '^LETSENCRYPT_EMAIL=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)
  if [ -n "$email" ]; then
    account_args="--email $email --no-eff-email"
  else
    account_args="--register-unsafely-without-email"
  fi
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm --entrypoint certbot certbot \
    certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --domain "$DOMAIN" \
    --agree-tos \
    $account_args
fi

cp "$DEPLOY_DIR/nginx/https.conf" "$DEPLOY_DIR/nginx/default.conf"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d nginx certbot
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec nginx nginx -t
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec nginx nginx -s reload

curl -fsS "https://$DOMAIN/health"
echo
echo "HTTPS deployment is ready: https://$DOMAIN"
