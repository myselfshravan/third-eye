#!/usr/bin/env bash
# EC2 user-data bootstrap for third-eye (Amazon Linux 2023).
# Paste into the "User data" field when launching the instance, OR run manually
# after SSH. Installs Docker + compose, adds swap, clones the repo, and writes a
# starter .env. You still fill in secrets (.env) before bringing the stack up.
#
# For Ubuntu instead: replace the dnf block with `curl -fsSL https://get.docker.com | sh`.
set -euo pipefail

REPO="https://github.com/myselfshravan/third-eye.git"
APP_DIR="/opt/third-eye"

echo "── installing docker + git ──"
dnf update -y
dnf install -y docker git
systemctl enable --now docker
usermod -aG docker ec2-user || true

echo "── docker compose plugin ──"
mkdir -p /usr/local/lib/docker/cli-plugins
ARCH="$(uname -m)"; [ "$ARCH" = "aarch64" ] && CARCH="aarch64" || CARCH="x86_64"
curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${CARCH}" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

echo "── 2GB swap (guards against browser OOM on smaller instances) ──"
if [ ! -f /swapfile ]; then
  dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "── clone repo ──"
rm -rf "$APP_DIR"
git clone "$REPO" "$APP_DIR"
cd "$APP_DIR"
[ -f .env ] || cp .env.production.example .env
chown -R ec2-user:ec2-user "$APP_DIR"

cat <<'NEXT'

────────────────────────────────────────────────────────────────────────
third-eye bootstrapped to /opt/third-eye. Next steps (as ec2-user):

  cd /opt/third-eye
  nano .env          # set API_KEYS, TUNNEL_TOKEN, STORAGE_DRIVER=s3, S3_* ...
  docker compose -f docker-compose.prod.yml --env-file .env up -d --build

See DEPLOY-AWS.md for the S3 bucket, IAM, IMDSv2, and Cloudflare Tunnel setup.
────────────────────────────────────────────────────────────────────────
NEXT
