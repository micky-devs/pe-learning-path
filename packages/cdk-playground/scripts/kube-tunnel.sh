#!/usr/bin/env bash
# Set up local kubectl access to the k3s cluster on the basic-ec2 instance,
# tunneled over SSH so the Kubernetes API is never exposed publicly.
#
# Assumes you can already SSH to the instance (key/host config in place).
#
# What it does:
#   1. Reads the CloudFormation stack outputs to find the instance address.
#   2. Pulls the node kubeconfig over SSH.
#   3. Merges it into ~/.kube/config as a NEW, namespaced context
#      (existing contexts/clusters/users are left untouched).
#   4. Opens an SSH local port-forward (127.0.0.1:6443 -> node 127.0.0.1:6443).
#
# Usage:
#   PROJECT_NS=micky ./scripts/kube-tunnel.sh
#
# Then, in another terminal (while this stays running):
#   kubectl --context <context-name> get nodes
#
# Requirements: aws cli, kubectl, ssh, scp.
set -euo pipefail

PROJECT_NS="${PROJECT_NS:?PROJECT_NS must be set (e.g. micky)}"
STACK_NAME="${PROJECT_NS}-basic-ec2"
LOCAL_PORT="${LOCAL_PORT:-6443}"
CONTEXT_NAME="${CONTEXT_NAME:-${PROJECT_NS}-basic-ec2}"
SSH_USER="${SSH_USER:-ec2-user}"

for bin in aws kubectl ssh scp; do
  command -v "$bin" >/dev/null 2>&1 || { echo "ERROR: '$bin' is required but not installed." >&2; exit 1; }
done

echo "==> Reading outputs from stack '${STACK_NAME}'..."
PUBLIC_IP=$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --query "Stacks[0].Outputs[?OutputKey=='publicip'].OutputValue | [0]" \
  --output text)

if [ -z "${PUBLIC_IP}" ] || [ "${PUBLIC_IP}" = "None" ]; then
  echo "ERROR: could not read 'publicip' output from ${STACK_NAME}." >&2
  exit 1
fi

SSH_TARGET="${SSH_USER}@${PUBLIC_IP}"
echo "==> Instance: ${SSH_TARGET}"

# Temp working dir, cleaned up on exit.
WORKDIR=$(mktemp -d)
REMOTE_KUBECONFIG="${WORKDIR}/remote-kubeconfig.yaml"
cleanup() { rm -rf "${WORKDIR}"; }
trap cleanup EXIT

echo "==> Fetching kubeconfig from the node..."
scp "${SSH_TARGET}:/home/${SSH_USER}/.kube/config" "${REMOTE_KUBECONFIG}"

# Point the server at the local tunnel endpoint. k3s already binds the API at
# 127.0.0.1:6443 and its serving cert includes 127.0.0.1, so TLS verifies.
echo "==> Preparing namespaced context '${CONTEXT_NAME}'..."
KUBECONFIG="${REMOTE_KUBECONFIG}" kubectl config set-cluster default \
  --server="https://127.0.0.1:${LOCAL_PORT}" >/dev/null

# Flatten (embeds certs so the merged config is self-contained), then rename the
# stock k3s "default" cluster/user/context to namespaced names so a merge can't
# clobber any existing entries in ~/.kube/config.
FLAT="${WORKDIR}/flat.yaml"
KUBECONFIG="${REMOTE_KUBECONFIG}" kubectl config view --flatten --minify > "${FLAT}"
sed -i.bak \
  -e "s/name: default$/name: ${CONTEXT_NAME}/g" \
  -e "s/cluster: default$/cluster: ${CONTEXT_NAME}/g" \
  -e "s/user: default$/user: ${CONTEXT_NAME}/g" \
  "${FLAT}"
rm -f "${FLAT}.bak"

# Merge into ~/.kube/config WITHOUT overwriting existing entries.
mkdir -p "${HOME}/.kube"
MAIN_KUBECONFIG="${HOME}/.kube/config"
touch "${MAIN_KUBECONFIG}"
chmod 600 "${MAIN_KUBECONFIG}"

echo "==> Merging context into ${MAIN_KUBECONFIG} (backup created)..."
cp "${MAIN_KUBECONFIG}" "${MAIN_KUBECONFIG}.bak.$(date +%s)"
MERGED="${WORKDIR}/merged.yaml"
KUBECONFIG="${MAIN_KUBECONFIG}:${FLAT}" kubectl config view --flatten > "${MERGED}"
cp "${MERGED}" "${MAIN_KUBECONFIG}"
chmod 600 "${MAIN_KUBECONFIG}"

echo "==> Context '${CONTEXT_NAME}' added."
echo "==> Opening SSH tunnel 127.0.0.1:${LOCAL_PORT} -> node 127.0.0.1:6443"
echo "    Leave this running. In another terminal:"
echo
echo "      kubectl --context ${CONTEXT_NAME} get nodes"
echo
echo "    Press Ctrl-C here to close the tunnel."
echo

exec ssh -N -L "${LOCAL_PORT}:127.0.0.1:6443" "${SSH_TARGET}"
