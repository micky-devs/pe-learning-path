#!/bin/bash
set -euxo pipefail

echo "=== bootstrap starting at $(date -u) ==="

# Downgrade curl to the oldest available version so the patch-baseline scan
# flags it as needing a patch.
OLD_CURL=$(dnf --showduplicates list curl-minimal | awk '/curl-minimal/ {print $2}' | sort -V | head -n1)
dnf install -y --allowerasing "curl-minimal-${OLD_CURL}"

echo "Installed curl version: $(curl --version | head -n1)"
echo "=== bootstrap finished at $(date -u) ==="
