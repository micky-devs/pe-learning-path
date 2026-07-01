#!/bin/bash
# Bootstrap a single-node k3s cluster with Cilium (kube-proxy replacement).
# Designed to run via an SSM State Manager association (AWS-RunShellScript),
# so it must be idempotent: it can run on first boot AND re-run on every deploy.
# Target: Amazon Linux 2023 on arm64 (Graviton).
#
# The LOG_GROUP_NAME placeholder token below is replaced by the CDK stack with
# the real CloudWatch log group name before the script is handed to SSM.
set -euxo pipefail

# Capture all output to a file that the CloudWatch agent tails.
BOOTSTRAP_LOG=/var/log/k3s-bootstrap.log
exec > >(tee -a "${BOOTSTRAP_LOG}") 2>&1

# Pinned versions (bump as needed)
K3S_VERSION="v1.36.1+k3s1"
CILIUM_CLI_VERSION="v0.19.4"
CILIUM_VERSION="1.18.1"
LOG_GROUP_NAME="__LOG_GROUP__"

echo "=== bootstrap starting at $(date -u) ==="

# AL2023 minimal images may lack tar
command -v tar >/dev/null 2>&1 || dnf install -y tar

#------------------------------------------------------------------------------
# 0) CloudWatch agent: tail the bootstrap log into CloudWatch Logs.
#    Always (re)write the config + (re)apply it so a corrected log group name
#    takes effect on re-runs. `fetch-config` is safe to run repeatedly.
#------------------------------------------------------------------------------
CW_CONFIG=/opt/aws/amazon-cloudwatch-agent/etc/k3s-bootstrap.json
command -v amazon-cloudwatch-agent-ctl >/dev/null 2>&1 \
  || /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a status >/dev/null 2>&1 \
  || dnf install -y amazon-cloudwatch-agent

mkdir -p "$(dirname "${CW_CONFIG}")"
cat > "${CW_CONFIG}" <<EOF
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "${BOOTSTRAP_LOG}",
            "log_group_name": "${LOG_GROUP_NAME}",
            "log_stream_name": "{instance_id}",
            "retention_in_days": -1
          }
        ]
      }
    }
  }
}
EOF

/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 -s -c "file:${CW_CONFIG}"

#------------------------------------------------------------------------------
# 1) k3s without flannel / kube-proxy / traefik / servicelb / network-policy
#------------------------------------------------------------------------------
if ! command -v k3s >/dev/null 2>&1; then
  curl -sfL https://get.k3s.io | \
    INSTALL_K3S_VERSION="${K3S_VERSION}" \
    INSTALL_K3S_EXEC="--flannel-backend=none --disable-network-policy --disable-kube-proxy --disable=traefik --disable=servicelb --write-kubeconfig-mode=644" \
    sh -
fi

export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

# Wait for the k3s API to be reachable before touching it with Cilium.
for _ in $(seq 1 30); do
  if k3s kubectl get --raw='/readyz' >/dev/null 2>&1; then
    break
  fi
  sleep 5
done

#------------------------------------------------------------------------------
# 2) Cilium CLI (pinned, arm64 for Graviton)
#------------------------------------------------------------------------------
if ! command -v cilium >/dev/null 2>&1; then
  curl -L --fail "https://github.com/cilium/cilium-cli/releases/download/${CILIUM_CLI_VERSION}/cilium-linux-arm64.tar.gz" \
    | tar xzC /usr/local/bin
fi

#------------------------------------------------------------------------------
# 3) Install Cilium with kube-proxy replacement (needs explicit API host/port).
#    Re-running `cilium install` on an existing cluster errors, so branch on
#    whether Cilium is already present.
#------------------------------------------------------------------------------
API_IP=$(hostname -I | awk '{print $1}')
if cilium status >/dev/null 2>&1; then
  echo "Cilium already installed; skipping install."
else
  cilium install \
    --version "${CILIUM_VERSION}" \
    --set kubeProxyReplacement=true \
    --set k8sServiceHost="${API_IP}" \
    --set k8sServicePort=6443
fi
cilium status --wait

#------------------------------------------------------------------------------
# 4) kubeconfig + kubectl for ec2-user (idempotent)
#------------------------------------------------------------------------------
mkdir -p /home/ec2-user/.kube
cp /etc/rancher/k3s/k3s.yaml /home/ec2-user/.kube/config
chown -R ec2-user:ec2-user /home/ec2-user/.kube
ln -sf /usr/local/bin/k3s /usr/local/bin/kubectl

echo "=== bootstrap finished at $(date -u) ==="

