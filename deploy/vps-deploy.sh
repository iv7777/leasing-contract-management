#!/usr/bin/env bash
#
# Automated deploy + control panel for the Lease Contract Management app on
# Ubuntu 24.04, running everything as root. Picks up where the manual guide's
# step 1 (initial SSH/user/ufw hardening) leaves off: this script does
# Node.js, the app itself, systemd, Nginx, TLS, and the internal backup
# schedule.
#
# Usage:
#   First run (fresh server):
#     sudo DOMAIN=lease.yourcompany.com ADMIN_EMAIL=you@yourcompany.com \
#          bash vps-deploy.sh
#
#   Later, on an already-installed server, running it again interactively
#   opens a menu (change domain / check for updates / reinstall / etc.)
#   instead of redeploying blindly. A cron job or other non-interactive
#   caller (no TTY on stdin) keeps the old behavior — a full reinstall using
#   whatever DOMAIN/ADMIN_EMAIL are already configured — unless you pass one
#   of these to run a single action and exit instead of opening the menu:
#     --install / --reinstall     full (re)install using current settings
#     --check-update              fetch, show what's new, offer to pull it
#     --change-domain             point the app at a new domain + new TLS cert
#     --change-admin-email        rename the admin's login email
#     --reset-admin-password      set a new password for a user
#     --restore-backup            pick a backup and restore the database from it
#     --status                    service/health/TLS summary
#     --menu                      force the menu even without a TTY
#     -y / --yes                  don't ask for confirmation
#
# Safe to re-run: every step here detects what's already in place (checkout,
# .env, TLS config) and leaves it alone instead of clobbering it.
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
ACTION=""

for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
    --install|--reinstall) ACTION="install" ;;
    --check-update) ACTION="check-update" ;;
    --change-domain) ACTION="change-domain" ;;
    --change-admin-email) ACTION="change-admin-email" ;;
    --reset-admin-password) ACTION="reset-admin-password" ;;
    --restore-backup) ACTION="restore-backup" ;;
    --status) ACTION="status" ;;
    --menu) ACTION="menu" ;;
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
err() { printf '\033[1;31m✗ %s\033[0m\n' "$1" >&2; }

confirm() {
  # confirm "prompt text" — returns success (0) if the user agreed, or if
  # ASSUME_YES=1. Used before anything hard to reverse.
  if [ "$ASSUME_YES" = "1" ]; then return 0; fi
  local reply
  read -rp "$1 [y/N] " reply
  case "$reply" in y|Y) return 0 ;; *) return 1 ;; esac
}

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root (e.g. sudo bash vps-deploy.sh)." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Detect what's already on this server, so every action below can reuse it
# instead of asking again, and so the menu can show current state.
# ---------------------------------------------------------------------------
detect_existing() {
  EXISTING_DOMAIN=""
  if [ -f "$NGINX_SITE" ]; then
    EXISTING_DOMAIN="$(grep -oP '(?<=server_name )[^;]+' "$NGINX_SITE" 2>/dev/null | head -1 || true)"
  fi
  EXISTING_ADMIN_EMAIL=""
  if [ -f "$ENV_FILE" ]; then
    EXISTING_ADMIN_EMAIL="$(grep '^SEED_ADMIN_EMAIL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)"
  fi
  if [ -d "$APP_CODE_DIR/.git" ]; then INSTALLED=1; else INSTALLED=0; fi
}

require_installed() {
  if [ "$INSTALLED" != "1" ]; then
    err "Nothing is installed at $APP_CODE_DIR yet — run a full install first (option 3, or --install)."
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Building blocks shared by more than one action
# ---------------------------------------------------------------------------
install_nodejs() {
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
}

# PDF/CSV contract exports embed this to render Chinese text — pdfkit's
# built-in fonts have no CJK glyphs at all, so without it Chinese names show
# as blank boxes. dpkg -s makes this a no-op on every later run.
ensure_export_fonts() {
  if ! dpkg -s fonts-wqy-zenhei >/dev/null 2>&1; then
    log "Installing CJK font for PDF/CSV exports"
    apt-get install -y fonts-wqy-zenhei
  fi
}

# Used only to validate backup snapshots before offering them for restore —
# installed lazily the first time that's needed rather than on every deploy.
ensure_sqlite3_cli() {
  if ! command -v sqlite3 >/dev/null 2>&1; then
    log "Installing sqlite3 CLI (used to validate backup snapshots)"
    apt-get install -y sqlite3 || warn "Could not install sqlite3 — skipping the deeper integrity check for backups."
  fi
}

fetch_code() {
  log "Fetching application code"
  if [ -d "$APP_CODE_DIR/.git" ]; then
    echo "Existing checkout found — updating to $GIT_REF"
    git -C "$APP_CODE_DIR" fetch origin "$GIT_REF"
    git -C "$APP_CODE_DIR" checkout "$GIT_REF"
    git -C "$APP_CODE_DIR" merge --ff-only "origin/$GIT_REF"
  else
    git clone "$REPO_URL" "$APP_CODE_DIR"
    git -C "$APP_CODE_DIR" checkout "$GIT_REF"
  fi
}

build_app() {
  log "Installing dependencies and building"
  ( cd "$APP_CODE_DIR" && npm ci && npm run build:shared && npm run build:server && npm run build:web )
}

run_migrations_and_seed() {
  log "Running migrations and seeding the admin account"
  ( cd "$APP_CODE_DIR/server" && npm run migrate && npm run seed )
}

restart_service() {
  systemctl daemon-reload
  systemctl restart "$SERVICE_NAME.service"
  sleep 2
  systemctl --no-pager --full status "$SERVICE_NAME.service" || true
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null; then
    echo "API health check OK."
  else
    warn "API health check failed — check: journalctl -u $SERVICE_NAME.service -e"
  fi
}

sync_letsencrypt_contact_email() {
  # Cert issuance itself is skipped once TLS is configured, but the renewal
  # contact email is a cheap, idempotent account-level update.
  command -v certbot >/dev/null 2>&1 || return 0
  certbot update_account --email "$LETSENCRYPT_EMAIL" --non-interactive 2>/dev/null \
    && echo "Let's Encrypt contact email confirmed: $LETSENCRYPT_EMAIL" \
    || warn "Could not update the Let's Encrypt contact email — check 'certbot update_account' manually."
}

write_nginx_site() {
  # Writes a fresh HTTP-only server block for $DOMAIN. Any existing TLS
  # directives are dropped deliberately — certbot re-adds them for whichever
  # domain it's next pointed at.
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
  nginx -t
  systemctl reload nginx
}

# ---------------------------------------------------------------------------
# Action: full install / reinstall with current settings
# ---------------------------------------------------------------------------
action_full_install() {
  if [ -z "$DOMAIN" ] && [ -n "$EXISTING_DOMAIN" ]; then
    DOMAIN="$EXISTING_DOMAIN"
    echo "Reusing existing domain from $NGINX_SITE: $DOMAIN"
  elif [ -z "$DOMAIN" ]; then
    read -rp "Domain this app will be served on (DNS A record must already point here): " DOMAIN
  fi
  if [ -z "$ADMIN_EMAIL" ] && [ -n "$EXISTING_ADMIN_EMAIL" ]; then
    ADMIN_EMAIL="$EXISTING_ADMIN_EMAIL"
    echo "Reusing existing admin email from $ENV_FILE: $ADMIN_EMAIL"
  elif [ -z "$ADMIN_EMAIL" ]; then
    read -rp "Email for the initial admin account and Let's Encrypt renewal notices: " ADMIN_EMAIL
  fi
  LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-$ADMIN_EMAIL}"

  if [ -z "$DOMAIN" ] || [ -z "$ADMIN_EMAIL" ]; then
    err "DOMAIN and ADMIN_EMAIL are both required."
    return 1
  fi

  # A full install never migrates a live domain on its own: Nginx and the
  # TLS certificate stay pointed at whatever is already configured. Warn
  # loudly instead of silently ignoring a DOMAIN that doesn't match — use
  # "Change the domain" (option 1 / --change-domain) to actually move it.
  if [ -n "$EXISTING_DOMAIN" ] && [ "$DOMAIN" != "$EXISTING_DOMAIN" ]; then
    warn "You passed DOMAIN=$DOMAIN but this server is already configured for $EXISTING_DOMAIN."
    warn "A reinstall will NOT move Nginx/TLS to the new domain — continuing with $EXISTING_DOMAIN."
    warn "Use the 'Change the domain' action (menu option 1, or --change-domain) to migrate domains."
    DOMAIN="$EXISTING_DOMAIN"
  fi

  local admin_email_changed=0
  if [ -n "$EXISTING_ADMIN_EMAIL" ] && [ "$ADMIN_EMAIL" != "$EXISTING_ADMIN_EMAIL" ]; then
    admin_email_changed=1
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
  if [ "$admin_email_changed" = "1" ]; then
    echo "  Admin login email  : $EXISTING_ADMIN_EMAIL -> $ADMIN_EMAIL (will be updated)"
  fi

  confirm "Continue?" || { echo "Aborted."; return 1; }

  mkdir -p "$APP_DIR" "$DATA_DIR" "$DOCS_DIR" "$BACKUP_DIR_PATH"

  install_nodejs
  ensure_export_fonts
  fetch_code
  build_app

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

  run_migrations_and_seed

  # A changed ADMIN_EMAIL renames the seeded admin's actual login, not just
  # a future seed default — otherwise this would silently do nothing once
  # the account already exists. This only touches the account that had the
  # old email, and only if the new address isn't already taken.
  if [ "$admin_email_changed" = "1" ]; then
    log "Updating admin login email"
    ( cd "$APP_CODE_DIR/server" && npm run set-email -- "$EXISTING_ADMIN_EMAIL" "$ADMIN_EMAIL" )
    sed -i "s/^SEED_ADMIN_EMAIL=.*/SEED_ADMIN_EMAIL=$ADMIN_EMAIL/" "$ENV_FILE"
  fi

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
  systemctl enable "$SERVICE_NAME.service"
  restart_service

  log "Configuring Nginx"
  apt-get install -y nginx
  mkdir -p "$(dirname "$NGINX_SITE")" "$(dirname "$NGINX_SITE_LINK")"
  if [ -f "$NGINX_SITE" ] && grep -q "ssl_certificate" "$NGINX_SITE"; then
    echo "Nginx site is already TLS-configured — leaving $NGINX_SITE untouched."
  else
    write_nginx_site
  fi

  log "Setting up TLS"
  apt-get install -y certbot python3-certbot-nginx
  if grep -q "ssl_certificate" "$NGINX_SITE" 2>/dev/null; then
    echo "TLS already configured, skipping certificate issuance."
    sync_letsencrypt_contact_email
  else
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$LETSENCRYPT_EMAIL" --redirect
  fi

  log "Firewall"
  if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
    ufw allow 'Nginx Full' || true
    echo "ufw: confirmed 'Nginx Full' is allowed."
  else
    warn "ufw is not active — skipping. Make sure ports 80 and 443 are reachable through whatever firewall you're using."
  fi

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
  elif [ "$admin_email_changed" = "1" ]; then
    echo "  Admin login email updated: $EXISTING_ADMIN_EMAIL -> $ADMIN_EMAIL (password unchanged)."
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
SUMMARY
}

# ---------------------------------------------------------------------------
# Action: check for updates, offer to pull and rebuild
# ---------------------------------------------------------------------------
action_check_update() {
  require_installed || return 1
  log "Checking for updates"
  git -C "$APP_CODE_DIR" fetch origin "$GIT_REF"
  local current remote
  current="$(git -C "$APP_CODE_DIR" rev-parse HEAD)"
  remote="$(git -C "$APP_CODE_DIR" rev-parse "origin/$GIT_REF")"

  if [ "$current" = "$remote" ]; then
    echo "Already up to date (commit ${current:0:7})."
    return 0
  fi

  echo "New commits available on $GIT_REF:"
  git -C "$APP_CODE_DIR" --no-pager log --oneline "$current..$remote"

  confirm "Pull and update to the latest build now?" || { echo "Skipped."; return 0; }

  ensure_export_fonts
  fetch_code
  build_app
  run_migrations_and_seed
  restart_service
  log "Update complete — now on commit $(git -C "$APP_CODE_DIR" rev-parse --short HEAD)."
}

# ---------------------------------------------------------------------------
# Action: change the domain and get a new TLS certificate
# ---------------------------------------------------------------------------
action_change_domain() {
  require_installed || return 1
  if [ -z "$EXISTING_DOMAIN" ]; then
    err "No domain is configured yet — run a full install first."
    return 1
  fi

  local new_domain="$DOMAIN"
  if [ -z "$new_domain" ]; then
    read -rp "New domain (current: $EXISTING_DOMAIN): " new_domain
  fi
  if [ -z "$new_domain" ]; then
    err "No domain entered."
    return 1
  fi
  if [ "$new_domain" = "$EXISTING_DOMAIN" ]; then
    echo "That's already the current domain — nothing to do."
    return 0
  fi

  local server_ip resolved_ip
  server_ip="$(curl -fsS4 https://ifconfig.me 2>/dev/null || true)"
  resolved_ip="$(getent hosts "$new_domain" 2>/dev/null | awk '{print $1}' | head -1 || true)"
  if [ -n "$server_ip" ] && [ -n "$resolved_ip" ] && [ "$server_ip" != "$resolved_ip" ]; then
    warn "$new_domain currently resolves to $resolved_ip, not this server's IP ($server_ip)."
    warn "Let's Encrypt will fail unless the DNS A record points here before you continue."
  elif [ -z "$resolved_ip" ]; then
    warn "Could not resolve $new_domain at all yet — make sure its DNS A record points at this server."
  fi

  confirm "Point this app at $new_domain and request a new TLS certificate for it now?" || { echo "Aborted."; return 1; }

  DOMAIN="$new_domain"
  LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-$EXISTING_ADMIN_EMAIL}"

  log "Updating WEB_ORIGIN"
  if grep -q '^WEB_ORIGIN=' "$ENV_FILE"; then
    sed -i "s#^WEB_ORIGIN=.*#WEB_ORIGIN=https://$DOMAIN#" "$ENV_FILE"
  else
    echo "WEB_ORIGIN=https://$DOMAIN" >> "$ENV_FILE"
  fi

  log "Rewriting the Nginx site for $DOMAIN"
  write_nginx_site

  log "Requesting a new TLS certificate"
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$LETSENCRYPT_EMAIL" --redirect

  log "Restarting the app"
  restart_service

  log "Domain changed"
  cat <<SUMMARY

  https://$DOMAIN

  The old certificate for $EXISTING_DOMAIN was left in place, unused. To remove it:
    sudo certbot delete --cert-name $EXISTING_DOMAIN
SUMMARY
}

# ---------------------------------------------------------------------------
# Action: change the admin login email
# ---------------------------------------------------------------------------
action_change_admin_email() {
  require_installed || return 1
  if [ -z "$EXISTING_ADMIN_EMAIL" ]; then
    err "No admin email is on file yet — run a full install first."
    return 1
  fi

  local new_email="$ADMIN_EMAIL"
  if [ -z "$new_email" ]; then
    read -rp "New admin login email (current: $EXISTING_ADMIN_EMAIL): " new_email
  fi
  if [ -z "$new_email" ]; then
    err "No email entered."
    return 1
  fi
  if [ "$new_email" = "$EXISTING_ADMIN_EMAIL" ]; then
    echo "That's already the current admin email — nothing to do."
    return 0
  fi

  ( cd "$APP_CODE_DIR/server" && npm run set-email -- "$EXISTING_ADMIN_EMAIL" "$new_email" )
  sed -i "s/^SEED_ADMIN_EMAIL=.*/SEED_ADMIN_EMAIL=$new_email/" "$ENV_FILE"
  LETSENCRYPT_EMAIL="$new_email"
  sync_letsencrypt_contact_email
  echo "Admin login email updated: $EXISTING_ADMIN_EMAIL -> $new_email."
}

# ---------------------------------------------------------------------------
# Action: reset a user's password
# ---------------------------------------------------------------------------
action_reset_admin_password() {
  require_installed || return 1
  local email password password2
  read -rp "Email of the account to reset (default: $EXISTING_ADMIN_EMAIL): " email
  email="${email:-$EXISTING_ADMIN_EMAIL}"
  if [ -z "$email" ]; then
    err "No email entered."
    return 1
  fi
  read -rsp "New password (min 8 characters): " password; echo
  read -rsp "Confirm new password: " password2; echo
  if [ "$password" != "$password2" ]; then
    err "Passwords didn't match — nothing changed."
    return 1
  fi
  ( cd "$APP_CODE_DIR/server" && npm run reset-password -- "$email" "$password" )
  echo "Password updated for $email."
}

# ---------------------------------------------------------------------------
# Action: restore the database from a backup
# ---------------------------------------------------------------------------

# Prints one reason and fails if $1 doesn't look like a restorable snapshot;
# prints nothing and succeeds otherwise. Kept independent of the app's own
# TypeScript so a bad backup is caught here, before restore-backup.ts (and
# the systemd stop it performs) ever runs.
validate_backup_dir() {
  local dir="$1" snapshot="$1/app.db"
  if [ ! -f "$snapshot" ]; then
    echo "no app.db in this folder"
    return 1
  fi
  if [ ! -s "$snapshot" ]; then
    echo "app.db is empty"
    return 1
  fi
  if ! LC_ALL=C head -c 16 "$snapshot" | grep -qa "SQLite format 3"; then
    echo "app.db does not look like a SQLite database"
    return 1
  fi
  if command -v sqlite3 >/dev/null 2>&1; then
    local check
    check="$(sqlite3 "$snapshot" "PRAGMA integrity_check;" 2>&1 || true)"
    if [ "$check" != "ok" ]; then
      echo "integrity check failed: $check"
      return 1
    fi
  fi
  return 0
}

action_restore_backup() {
  require_installed || return 1
  ensure_sqlite3_cli

  if [ ! -d "$BACKUP_DIR_PATH" ]; then
    err "Backup directory $BACKUP_DIR_PATH does not exist."
    return 1
  fi

  log "Scanning $BACKUP_DIR_PATH for backups"
  local dirs=()
  while IFS= read -r -d '' d; do
    dirs+=("$d")
  done < <(find "$BACKUP_DIR_PATH" -mindepth 1 -maxdepth 1 -type d -print0 | sort -z)

  if [ "${#dirs[@]}" -eq 0 ]; then
    err "No backup folders found under $BACKUP_DIR_PATH."
    return 1
  fi

  # Oldest to newest — directory names are ISO timestamps with ':' and '.'
  # turned into '-', so plain lexicographic sort is already chronological.
  local valid_dirs=() labels=() d name kind size docs_count problem
  for d in "${dirs[@]}"; do
    name="$(basename "$d")"
    if problem="$(validate_backup_dir "$d")"; then
      size="$(du -h "$d/app.db" 2>/dev/null | cut -f1)"
      docs_count="—"
      if [ -f "$d/documents.manifest.json" ]; then
        docs_count="$(grep -o '"id"' "$d/documents.manifest.json" | wc -l)"
      fi
      kind="backup"
      case "$name" in pre-restore-*) kind="safety copy taken before an earlier restore" ;; esac
      valid_dirs+=("$d")
      labels+=("$name — $kind (${size:-?}, ${docs_count} documents referenced)")
    else
      warn "Skipping $name — $problem"
    fi
  done

  if [ "${#valid_dirs[@]}" -eq 0 ]; then
    err "No valid backup snapshots found under $BACKUP_DIR_PATH."
    return 1
  fi

  echo
  echo "Valid backups (oldest to newest):"
  local i
  for i in "${!valid_dirs[@]}"; do
    printf '  %d) %s\n' "$((i + 1))" "${labels[$i]}"
  done

  local choice selected_dir
  read -rp "Choose a backup to restore [1-${#valid_dirs[@]}], or blank to cancel: " choice
  if [ -z "$choice" ]; then
    echo "Cancelled."
    return 0
  fi
  if ! [[ "$choice" =~ ^[0-9]+$ ]] || [ "$choice" -lt 1 ] || [ "$choice" -gt "${#valid_dirs[@]}" ]; then
    err "Invalid choice."
    return 1
  fi
  selected_dir="${valid_dirs[$((choice - 1))]}"

  warn "This will REPLACE the live database with the snapshot in $(basename "$selected_dir")."
  warn "$SERVICE_NAME will be stopped for the restore and started again automatically afterward."
  warn "A safety copy of the CURRENT database is taken first, restorable the same way if needed."
  confirm "Proceed with restoring from $(basename "$selected_dir")?" || { echo "Aborted."; return 1; }

  # restore-backup.ts does its own "type RESTORE" confirmation; the operator
  # already confirmed above with the actual backup named, so answer it here
  # instead of asking the same thing twice in two different UIs.
  ( cd "$APP_CODE_DIR/server" && echo "RESTORE" | SERVICE_NAME="$SERVICE_NAME" npm run restore-backup -- "$selected_dir" )
}

# ---------------------------------------------------------------------------
# Action: status summary
# ---------------------------------------------------------------------------
action_show_status() {
  require_installed || return 1
  log "Service status"
  systemctl --no-pager --full status "$SERVICE_NAME.service" || true
  echo
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null; then
    echo "API health check: OK"
  else
    warn "API health check failed."
  fi
  echo "Domain            : ${EXISTING_DOMAIN:-<not configured>}"
  echo "Admin login email : ${EXISTING_ADMIN_EMAIL:-<not configured>}"
  echo "Current commit    : $(git -C "$APP_CODE_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  if command -v certbot >/dev/null 2>&1; then
    certbot certificates 2>/dev/null || true
  fi
}

# ---------------------------------------------------------------------------
# Interactive menu
# ---------------------------------------------------------------------------
run_menu() {
  while true; do
    detect_existing
    cat <<MENU

  ── Lease Contract Management — server control panel ──
  Domain            : ${EXISTING_DOMAIN:-<not configured>}
  Admin login email : ${EXISTING_ADMIN_EMAIL:-<not configured>}

  1) Change the domain and get a new TLS certificate
  2) Check for updates and pull the latest build
  3) Reinstall everything with current settings
  4) Change the admin login email
  5) Reset a user's password
  6) Restore the database from a backup
  7) Show service status
  8) Exit
MENU
    read -rp "Choose an option [1-8, or Enter to exit]: " choice
    case "$choice" in
      1) action_change_domain || warn "Domain change did not complete." ;;
      2) action_check_update || warn "Update check did not complete." ;;
      3) action_full_install || warn "Reinstall did not complete." ;;
      4) action_change_admin_email || warn "Email change did not complete." ;;
      5) action_reset_admin_password || warn "Password reset did not complete." ;;
      6) action_restore_backup || warn "Restore did not complete." ;;
      7) action_show_status || true ;;
      8|"") echo "Bye."; exit 0 ;;
      *) echo "Invalid option." ;;
    esac
  done
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
detect_existing

if [ -z "$ACTION" ]; then
  if [ "$INSTALLED" != "1" ]; then
    ACTION="install"
  elif [ -t 0 ]; then
    ACTION="menu"
  else
    # No TTY (cron, CI, a piped `curl | bash`, etc.) and nothing installed
    # yet — keep the historical behavior: a full reinstall using whatever
    # DOMAIN/ADMIN_EMAIL are already on file, so existing automation that
    # calls this script unattended keeps working unchanged.
    ACTION="install"
  fi
fi

case "$ACTION" in
  install) action_full_install ;;
  check-update) action_check_update ;;
  change-domain) action_change_domain ;;
  change-admin-email) action_change_admin_email ;;
  reset-admin-password) action_reset_admin_password ;;
  restore-backup) action_restore_backup ;;
  status) action_show_status ;;
  menu) run_menu ;;
esac
