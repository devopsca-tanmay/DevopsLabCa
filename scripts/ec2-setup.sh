#!/usr/bin/env bash
# =============================================================================
# FinTrack - one-time EC2 instance bootstrap
# -----------------------------------------------------------------------------
# Run ONCE on a fresh Ubuntu 22.04/24.04 EC2 instance, as the default `ubuntu`
# user, before the first deployment:
#
#   scp -i key.pem scripts/ec2-setup.sh ubuntu@<EC2-IP>:~
#   ssh -i key.pem ubuntu@<EC2-IP> 'bash ~/ec2-setup.sh'
#
# It installs Docker, creates /opt/fintrack, and leaves the instance ready for
# the CD pipeline. It deliberately does NOT clone the repository or build
# anything: the application arrives as pre-built images from the registry.
# =============================================================================

set -euo pipefail

DEPLOY_DIR=/opt/fintrack
TARGET_USER="${SUDO_USER:-$USER}"

echo "==> Updating package index"
sudo apt-get update -y

echo "==> Installing prerequisites"
sudo apt-get install -y ca-certificates curl gnupg lsb-release

# --- Docker Engine + Compose plugin ------------------------------------------
# Installed from Docker's own apt repository rather than Ubuntu's, because the
# distro package is older and ships docker-compose v1 (the `docker-compose`
# binary) instead of the v2 `docker compose` plugin this project uses.
if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker Engine"
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

  sudo apt-get update -y
  sudo apt-get install -y \
    docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin
else
  echo "==> Docker already installed: $(docker --version)"
fi

echo "==> Enabling Docker to start on boot"
sudo systemctl enable --now docker

# --- Let the deploy user run docker without sudo ------------------------------
# The CD pipeline connects over SSH as this user and runs `docker compose`
# non-interactively, so it must not be prompted for a password.
if ! groups "$TARGET_USER" | grep -qw docker; then
  echo "==> Adding ${TARGET_USER} to the docker group"
  sudo usermod -aG docker "$TARGET_USER"
  echo "    NOTE: log out and back in (or run 'newgrp docker') for this to apply."
fi

# --- Deployment directory ------------------------------------------------------
echo "==> Creating ${DEPLOY_DIR}"
sudo mkdir -p "${DEPLOY_DIR}"
sudo chown -R "${TARGET_USER}:${TARGET_USER}" "${DEPLOY_DIR}"
# The .env written here holds the database password and the JWT secret, so the
# directory is not world-readable.
sudo chmod 750 "${DEPLOY_DIR}"

# --- Log rotation ---------------------------------------------------------------
# docker-compose.prod.yml already caps each container's logs at 3 x 10MB. This
# is a second line of defence for anything started outside compose.
echo "==> Configuring the Docker daemon log cap"
sudo tee /etc/docker/daemon.json > /dev/null <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
JSON
sudo systemctl restart docker

# --- Swap ------------------------------------------------------------------------
# A t2.micro / t3.micro has 1GB of RAM. Postgres plus four containers can spike
# past that, and the OOM killer taking out the database mid-deploy is a
# confusing failure. 2GB of swap makes the instance tolerate the peak.
if [ ! -f /swapfile ]; then
  echo "==> Creating a 2GB swap file"
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
fi

echo ""
echo "============================================================"
echo " EC2 bootstrap complete."
echo ""
echo " Docker:  $(docker --version)"
echo " Compose: $(docker compose version --short 2>/dev/null || echo 'run newgrp docker first')"
echo " Deploy dir: ${DEPLOY_DIR}"
echo ""
echo " Next steps:"
echo "   1. Log out and back in so the docker group applies."
echo "   2. Confirm the security group allows inbound 22 (your IP) and 80 (0.0.0.0/0)."
echo "   3. Add the GitHub Secrets listed in docs/deployment.md."
echo "   4. Push to main - the CD pipeline does the rest."
echo "============================================================"
