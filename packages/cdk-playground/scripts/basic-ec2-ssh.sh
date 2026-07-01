#!/usr/bin/env bash
set -euo pipefail

# SSH to the instance created by the basic-ec2 stack.
# Fetches the instance IP and the SSH private key (from SSM Parameter Store)
# using the AWS CLI, loads the key into an in-memory ssh-agent (never written
# to disk), then opens an SSH session.

: "${PROJECT_NS:?PROJECT_NS must be set (see example.envrc)}"

STACK_NAME="${PROJECT_NS}-basic-ec2"
KEY_PAIR_NAME="${PROJECT_NS}-basic-ec2"
SSH_USER="ec2-user"

echo "Resolving instance for stack ${STACK_NAME}..."

PUBLIC_IP="$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --query "Stacks[0].Outputs[?OutputKey=='publicip'].OutputValue" \
  --output text)"

if [ -z "${PUBLIC_IP}" ] || [ "${PUBLIC_IP}" = "None" ]; then
  echo "Could not find a public IP output for stack ${STACK_NAME}" >&2
  exit 1
fi

KEY_PAIR_ID="$(aws ec2 describe-key-pairs \
  --key-names "${KEY_PAIR_NAME}" \
  --query "KeyPairs[0].KeyPairId" \
  --output text)"

if [ -z "${KEY_PAIR_ID}" ] || [ "${KEY_PAIR_ID}" = "None" ]; then
  echo "Could not find key pair ${KEY_PAIR_NAME}" >&2
  exit 1
fi

echo "Instance: ${PUBLIC_IP}  (key pair ${KEY_PAIR_NAME} / ${KEY_PAIR_ID})"

# Start a throwaway ssh-agent scoped to this script, and make sure it is
# killed on exit so the key never persists.
eval "$(ssh-agent -s)" >/dev/null
trap 'ssh-agent -k >/dev/null 2>&1 || true' EXIT

# Pull the private key from SSM and load it straight into the agent via stdin.
aws ssm get-parameter \
  --name "/ec2/keypair/${KEY_PAIR_ID}" \
  --with-decryption \
  --query Parameter.Value \
  --output text \
  | ssh-add - >/dev/null

echo "Connecting to ${SSH_USER}@${PUBLIC_IP}..."
ssh \
  -o StrictHostKeyChecking=accept-new \
  "${SSH_USER}@${PUBLIC_IP}" "$@"
