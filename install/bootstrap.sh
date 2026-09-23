#!/usr/bin/env bash
# Design Kit one-line install:
#   curl -fsSL https://raw.githubusercontent.com/feelthefusion/design-kit/main/install/bootstrap.sh | bash
set -euo pipefail
DEST="${DESIGN_KIT_DIR:-$HOME/design-kit}"
REPO="${DESIGN_KIT_REPO:-https://github.com/feelthefusion/design-kit.git}"
if [ -d "$DEST/.git" ]; then git -C "$DEST" pull --ff-only --quiet || echo "⚠ could not fast-forward $DEST — using it as is"
else git clone --quiet "$REPO" "$DEST"; fi
exec bash "$DEST/install/install.sh" "$@"
