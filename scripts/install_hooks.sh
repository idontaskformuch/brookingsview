#!/bin/sh
# One-time per clone: use the versioned hooks in .githooks (gitleaks secret scan before every commit).
git config core.hooksPath .githooks && echo "core.hooksPath = .githooks"
