#!/usr/bin/env bash
#
# Automated deploy for the Lease Contract Management app on Ubuntu 24.04,
# running everything as root. Picks up where the manual guide's step 1
# (initial SSH/user/ufw hardening) leaves off: this script does Node.js,
# the app itself, systemd, Nginx, TLS, and the internal backup schedule.
#
# Usage:
#   sudo DOMAIN=lease.yourcompany.com ADMIN_EMAIL=you@yourcompany.com \
#        bash vps-deploy.sh
#
# Safe to re-run: it detects an existing checkout, .env, and TLS
# configuration and leaves them alone instead of clobbering them — re-run
# it after a `git push` to redeploy.
#
# Every setting below can be overridden by exporting the same-named
# environment variable before running.

set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a   # Ubuntu 24.04's needrestart would otherwise pop an interactive dialog

# ---------------------------------------------------------------------------
# Configuration — override any of these via environment variables
# ---------------------------------------------------------------------------
APP_DIR="${APP_DIR:-/opt/lcm}"
REPO_URL="${REPO_URL:-https://github.com/iv7777/leasing-contract-management.git}"
GIT_REF="${GIT_REF:-main}"
SERVICE_NAME="${SERVICE_NAME:-lcm}"
PORT="${PORT:-4000}"
NODE_MAJOR="${NODE_MAJOR:-22}"
DOMAIN="${DOMAIN:-}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-$ADMIN_EMAIL}"
ASSUME_YES="${ASSUME_YES:-0}"

for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

APP_CODE_DIR="$APP_DIR/app"
DATA_DIR="$APP_DIR/data"
DOCS_DIR="$APP_DIR/documents"
BACKUP_DIR_PATH="$APP_DIR/backups"
ENV_FILE="$APP_CODE_DIR/server/.env"
SYSTEMD_UNIT="/etc/systemd/system/${SERVICE_NAME}.service"
NGINX_SITE="/etc/nginx/sites-available/${SERVICE_NAME}"
NGINX_SITE_LINK="/etc/nginx/sites-enabled/${SERVICE_NAME}"

log() { printf '\n\033[1;32m▶ %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$1"; }

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root (e.g. sudo bash vps-deploy.sh)." >&2
  exit 1
fi

if [ -z "$DOMAIN" ]; then
  read -rp "Domain this app will be served on (DNS A record must already point here): " DOMAIN
fi
if [ -z "$ADMIN_EMAIL" ]; then
  read -rp "Email for the initial admin account and Let's Encrypt renewal notices: " ADMIN_EMAIL
fi
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-$ADMIN_EMAIL}"

if [ -z "$DOMAIN" ] || [ -z "$ADMIN_EMAIL" ]; then
  echo "DOMAIN and ADMIN_EMAIL are both required." >&2
  exit 1
fi

log "Deployment plan"
cat <<PLAN
  Domain             : $DOMAIN
  Repo / ref          : $REPO_URL @ $GIT_REF
  App code            : $APP_CODE_DIR
  Data / documents    : $DATA_DIR , $DOCS_DIR
  Backups             : $BACKUP_DIR_PATH
  systemd unit        : $SYSTEMD_UNIT (running as root)
  Nginx site          : $NGINX_SITE
  Node.js             : v${NODE_MAJOR}.x
PLAN

if [ "$ASSUME_YES" != "1" ]; then
  read -rp "Continue? [y/N] " CONFIRM
  case "$CONFIRM" in
    y|Y) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
fi

mkdir -p "$APP_DIR" "$DATA_DIR" "$DOCS_DIR" "$BACKUP_DIR_PATH"

# ---------------------------------------------------------------------------
# 02 — Install Node.js
# ---------------------------------------------------------------------------
log "Installing Node.js ${NODE_MAJOR}.x"
apt-get update -y
if command -v node >/dev/null 2>&1 && [ "$(node -v | sed 's/^v//' | cut -d. -f1)" -ge "$NODE_MAJOR" ]; then
  echo "Node $(node -v) already installed, skipping NodeSource setup."
else
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
apt-get install -y git build-essential python3
NODE_BIN="$(command -v node)"
echo "node $(node -v) at $NODE_BIN, npm $(npm -v)"

# ---------------------------------------------------------------------------
# Get the code (clone on first run, pull on redeploy)
# ---------------------------------------------------------------------------
log "Fetching application code"
if [ -d "$APP_CODE_DIR/.git" ]; then
  echo "Existing checkout found — updating to $GIT_REF"
  git -C "$APP_CODE_DIR" fetch origin "$GIT_REF"
  git -C "$APP_CODE_DIR" checkout "$GIT_REF"
  git -C "$APP_CODE_DIR" pull --ff-only origin "$GIT_REF"
else
  git clone "$REPO_URL" "$APP_CODE_DIR"
  git -C "$APP_CODE_DIR" checkout "$GIT_REF"
fi

# ---------------------------------------------------------------------------
# Install dependencies and build
# ---------------------------------------------------------------------------
log "Installing dependencies and building"
(
  cd "$APP_CODE_DIR"
  npm ci
  npm run build:shared
  npm run build:server
  npm run build:web
)

# ---------------------------------------------------------------------------
# Configure environment (only on first run — never overwrite live secrets)
# ---------------------------------------------------------------------------
log "Configuring environment"
NEW_ADMIN_PASSWORD=""
if [ -f "$ENV_FILE" ]; then
  echo "Existing .env found at $ENV_FILE — leaving it untouched."
else
  SESSION_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
  NEW_ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -d '\n')"
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=$PORT
WEB_ORIGIN=https://$DOMAIN
SESSION_SECRET=$SESSION_SECRET
DATABASE_PATH=$DATA_DIR/app.db
DOCUMENT_STORAGE_DIR=$DOCS_DIR
BACKUP_DIR=$BACKUP_DIR_PATH
ENABLE_BACKUP_SCHEDULE=true
SEED_ADMIN_EMAIL=$ADMIN_EMAIL
SEED_ADMIN_PASSWORD=$NEW_ADMIN_PASSWORD
EOF
  chmod 600 "$ENV_FILE"
  echo "Wrote $ENV_FILE"
fi

# ---------------------------------------------------------------------------
# Initialize the database
# ---------------------------------------------------------------------------
log "Running migrations and seeding the admin account"
(
  cd "$APP_CODE_DIR/server"
  npm run migrate
  npm run seed
)

# ---------------------------------------------------------------------------
# systemd service (root)
# ---------------------------------------------------------------------------
log "Installing the systemd service"
cat > "$SYSTEMD_UNIT" <<EOF
[Unit]
Description=Lease Contract Management API
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$APP_CODE_DIR/server
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN dist/index.js
Restart=on-failure
RestartSec=5

# Kept even though this runs as root: these are mount-namespace
# restrictions, not permission checks, so they still meaningfully limit
# what the process can write to.
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR $DOCS_DIR $BACKUP_DIR_PATH

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME.service"
systemctl restart "$SERVICE_NAME.service"
sleep 2
systemctl --no-pager --full status "$SERVICE_NAME.service" || true

if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null; then
  echo "API health check OK."
else
  warn "API health check failed — check: journalctl -u $SERVICE_NAME.service -e"
fi

# ---------------------------------------------------------------------------
# Nginx: static hosting + API reverse proxy
# ---------------------------------------------------------------------------
log "Configuring Nginx"
apt-get install -y nginx
mkdir -p "$(dirname "$NGINX_SITE")" "$(dirname "$NGINX_SITE_LINK")"

if [ -f "$NGINX_SITE" ] && grep -q "ssl_certificate" "$NGINX_SITE"; then
  echo "Nginx site is already TLS-configured — leaving $NGINX_SITE untouched."
else
  cat > "$NGINX_SITE" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    root $APP_CODE_DIR/web/dist;
    index index.html;

    # Slightly above the app's own 50MB document-upload limit.
    client_max_body_size 60m;

    location /api/ {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        try_files \$uri /index.html;
    }
}
EOF
  ln -sf "$NGINX_SITE" "$NGINX_SITE_LINK"
  rm -f /etc/nginx/sites-enabled/default
fi

nginx -t
systemctl reload nginx

# ---------------------------------------------------------------------------
# TLS via Let's Encrypt
# ---------------------------------------------------------------------------
log "Setting up TLS"
apt-get install -y certbot python3-certbot-nginx

if grep -q "ssl_certificate" "$NGINX_SITE" 2>/dev/null; then
  echo "TLS already configured, skipping certbot."
else
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$LETSENCRYPT_EMAIL" --redirect
fi

# ---------------------------------------------------------------------------
# Firewall — only add what Nginx needs; never touch SSH rules or force-enable
# ufw here, since that's part of the hardening you've already done.
# ---------------------------------------------------------------------------
log "Firewall"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 'Nginx Full' || true
  echo "ufw: confirmed 'Nginx Full' is allowed."
else
  warn "ufw is not active — skipping. Make sure ports 80 and 443 are reachable through whatever firewall you're using."
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
log "Deployment complete"
cat <<SUMMARY

  https://$DOMAIN

  Admin login: $ADMIN_EMAIL
SUMMARY

if [ -n "$NEW_ADMIN_PASSWORD" ]; then
  cat <<SUMMARY
  Admin password (generated this run — save it now, it is not shown again):
    $NEW_ADMIN_PASSWORD

  Change it any time with:
    cd $APP_CODE_DIR/server && npm run reset-password -- $ADMIN_EMAIL "new-password"
SUMMARY
else
  echo "  Admin credentials are unchanged from a previous run of this script."
fi

cat <<'SUMMARY'

  Still to do by hand (can't be safely automated without your credentials):
    - Off-site encrypted backup: install/configure rclone (or similar) and
      point a nightly cron job at /opt/lcm/backups — see the deployment
      guide's Backups section for an example.
    - Walk through the verification and security checklists in the
      deployment guide before putting real tenant data in.

  Re-run this script any time after `git push` to redeploy.
SUMMARY
