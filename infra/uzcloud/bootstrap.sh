#!/bin/sh
# First-time setup of a fresh UzCloud machine (Ubuntu 24.04, run as root). Safe to run again.
#   sh bootstrap.sh web       on ilmora-web
#   sh bootstrap.sh admin     on ilmora-admin
#
# Installs Docker + Compose v2 and ufw, adds a 2 GB swap file, opens only what the machine needs:
#   web:   22/tcp (SSH), 80/tcp + 443/tcp + 443/udp (Caddy)
#   admin: 22/tcp from the private network only (it is reached through ilmora-web)
# Docker-published ports bypass ufw; that is why docker-compose.yml binds PostgreSQL, Redis, the api (4000) and the
# admin panel (3000) to the private address, and the UzCloud network firewall forwards only 22/80/443 to ilmora-web.
set -eu
ROLE=${1:?usage: bootstrap.sh web|admin}
case "$ROLE" in web|admin) ;; *) echo "usage: bootstrap.sh web|admin"; exit 2 ;; esac
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
PRIVATE_NET=10.0.0.0/24
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a

echo "== packages"
apt-get update -q
apt-get upgrade -yq
apt-get install -yq docker.io docker-compose-v2 ufw curl
systemctl enable --now docker

echo "== swap (2 GB)"
if ! swapon --show=NAME --noheadings | grep -q '^/swapfile$'; then
  [ -f /swapfile ] || { fallocate -l 2G /swapfile; chmod 600 /swapfile; mkswap /swapfile >/dev/null; }
  swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -q vm.swappiness=10
echo 'vm.swappiness=10' > /etc/sysctl.d/99-ilmora-swap.conf

echo "== firewall ($ROLE)"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
if [ "$ROLE" = web ]; then
  ufw allow 22/tcp >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 443/udp >/dev/null
else
  ufw allow from "$PRIVATE_NET" to any port 22 proto tcp >/dev/null
fi
ufw --force enable >/dev/null

echo "== result"
docker --version
docker compose version
swapon --show
ufw status verbose
echo "== $ROLE ready"
