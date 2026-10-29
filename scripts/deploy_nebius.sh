#!/usr/bin/env bash
# Deploy Prometheus to a small Nebius AI Cloud VM: Docker + persistent data + automatic HTTPS (Caddy + sslip.io).
#
# Run from the repo root on your own machine (macOS/Linux/WSL):  bash scripts/deploy_nebius.sh
# Re-run it at any time to ship the current commit to the same VM.
#
# Needs: the nebius CLI with a profile (`nebius profile create`), jq, ssh, git, an SSH key, and a .env holding
# NEBIUS_API_KEY. The key is copied to the VM's .env over SSH; it is never baked into the image.
#
# Cost: one small CPU VM plus a 30 GiB disk, running until you delete it (see "Tear down" in docs/DEPLOY.md).
set -euo pipefail

NAME="${NAME:-prometheus}"
PLATFORM="${PLATFORM:-cpu-d3}"         # use cpu-e2 if your region doesn't list cpu-d3
PRESET="${PRESET:-2vcpu-8gb}"
IMAGE_FAMILY="${IMAGE_FAMILY:-ubuntu24.04-driverless}"
DISK_GIB="${DISK_GIB:-30}"
SSH_USER=prometheus
SSH_PUBKEY="${SSH_PUBKEY:-$(ls ~/.ssh/id_ed25519.pub ~/.ssh/id_rsa.pub 2>/dev/null | head -1)}"
STATE=var/nebius-deploy.env
PARENT=(); [[ -n "${NB_PROJECT_ID:-}" ]] && PARENT=(--parent-id "$NB_PROJECT_ID")

die() { echo "error: $*" >&2; exit 1; }
for t in nebius jq ssh git; do command -v "$t" >/dev/null || die "'$t' not found"; done
[[ -f backend/app/main.py ]] || die "run this from the repo root"
[[ -f .env ]] && grep -q '^NEBIUS_API_KEY=.\+' .env || die ".env with NEBIUS_API_KEY is required"
[[ -n "$SSH_PUBKEY" && -f "$SSH_PUBKEY" ]] || die "no SSH public key found; set SSH_PUBKEY=/path/to/key.pub"
mkdir -p var
[[ -f "$STATE" ]] && source "$STATE"

if [[ -z "${INSTANCE_ID:-}" ]]; then
  echo "→ Creating VM '$NAME' ($PLATFORM / $PRESET)…"
  SUBNET_ID=$(nebius vpc subnet list ${PARENT[@]+"${PARENT[@]}"} --format json | jq -r '.items[0].metadata.id')
  [[ "$SUBNET_ID" != null ]] || die "no VPC subnet found in this project"

  DISK_ID=$(nebius compute disk create ${PARENT[@]+"${PARENT[@]}"} --name "$NAME-boot" --size-gibibytes "$DISK_GIB" \
    --type network_ssd --block-size-bytes 4096 --source-image-family-image-family "$IMAGE_FAMILY" \
    --format json | jq -r '.metadata.id')

  CLOUD_INIT=$(cat <<EOF
#cloud-config
users:
  - name: $SSH_USER
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys: ["$(cat "$SSH_PUBKEY")"]
runcmd:
  - curl -fsSL https://get.docker.com | sh
  - usermod -aG docker $SSH_USER
  - mkdir -p /opt/prometheus /srv/prometheus/data /srv/prometheus/caddy
  - chown -R $SSH_USER /opt/prometheus
EOF
)
  INSTANCE_ID=$(jq -n --arg name "$NAME" --arg ci "$CLOUD_INIT" --arg disk "$DISK_ID" --arg subnet "$SUBNET_ID" \
      --arg platform "$PLATFORM" --arg preset "$PRESET" '{
        metadata: {name: $name},
        spec: {
          stopped: false,
          cloud_init_user_data: $ci,
          resources: {platform: $platform, preset: $preset},
          boot_disk: {attach_mode: "READ_WRITE", existing_disk: {id: $disk}},
          network_interfaces: [{name: "eth0", subnet_id: $subnet, ip_address: {}, public_ip_address: {}}]
        }}' | nebius compute instance create ${PARENT[@]+"${PARENT[@]}"} --format json - | jq -r '.metadata.id')
  printf "INSTANCE_ID=%s\nDISK_ID=%s\n" "$INSTANCE_ID" "$DISK_ID" > "$STATE"
  echo "  instance $INSTANCE_ID (saved to $STATE)"
fi

echo "→ Waiting for a public IP…"
for _ in $(seq 60); do
  IP=$(nebius compute instance get --id "$INSTANCE_ID" --format json \
       | jq -r '.status.network_interfaces[0].public_ip_address.address // empty')
  [[ -n "$IP" ]] && break; sleep 5
done
IP="${IP%/*}"; [[ -n "$IP" ]] || die "VM has no public IP yet; re-run in a minute"
DOMAIN="${DOMAIN:-${IP//./-}.sslip.io}"
SSH=(ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 "$SSH_USER@$IP")
echo "  $IP → https://$DOMAIN"

echo "→ Waiting for SSH and cloud-init (first boot installs Docker, ~2-3 min)…"
for _ in $(seq 60); do "${SSH[@]}" true 2>/dev/null && break; sleep 5; done
"${SSH[@]}" 'cloud-init status --wait >/dev/null; command -v docker >/dev/null' || die "Docker isn't installed on the VM"

echo "→ Shipping commit $(git rev-parse --short HEAD) and the server .env…"
git archive HEAD | "${SSH[@]}" 'tar -x -C /opt/prometheus'
grep -E '^(NEBIUS_API_KEY|NEBIUS_BASE_URL|NEBIUS_MODEL|PROMETHEUS_DAILY_TURNS_[A-Z_]+)=' .env \
  | "${SSH[@]}" 'umask 077; cat > /opt/prometheus/.env'

echo "→ Building and starting containers…"
"${SSH[@]}" "cd /opt/prometheus && sudo DOMAIN='$DOMAIN' docker compose -f deploy/docker-compose.yml up -d --build"

echo "→ Checking https://$DOMAIN/api/ai/verify (the TLS certificate can take a minute)…"
for _ in $(seq 30); do
  if out=$(curl -fsS --max-time 20 "https://$DOMAIN/api/ai/verify" 2>/dev/null); then
    echo "  $out"; echo; echo "✓ Live at https://$DOMAIN"; exit 0
  fi
  sleep 10
done
die "https://$DOMAIN didn't answer. Check: ${SSH[*]} 'cd /opt/prometheus && sudo docker compose -f deploy/docker-compose.yml logs'"
