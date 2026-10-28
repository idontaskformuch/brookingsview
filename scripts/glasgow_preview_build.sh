#!/bin/sh
# Local launch preview of Glasgow with noindex OFF (owner 2026-10-28): builds into site/dist with the two noindex switches flipped,
# then ALWAYS restores them and checks they are back. NEVER deploy this dist: a marker file dist/.launch-preview is written and
# scripts/wrangler_deploy_retry.sh refuses to deploy a dist that has it.
# Usage: sh scripts/glasgow_preview_build.sh
set -u
cd "$(dirname "$0")/../site" || exit 2
CFG=src/lib/site-config.ts
AST=astro.config.mjs
cp "$CFG" /tmp/site-config.ts.preview.bak && cp "$AST" /tmp/astro.config.mjs.preview.bak || exit 2
restore() {
  cp /tmp/site-config.ts.preview.bak "$CFG"; cp /tmp/astro.config.mjs.preview.bak "$AST"
  if ! grep -q "noindexSite: true," "$CFG" || ! grep -q "NOINDEX_SITE_TOWNS = new Set(\['glasgow'\])" "$AST"; then
    echo "!! noindex switches NOT restored, fix by hand: git checkout site/src/lib/site-config.ts site/astro.config.mjs" >&2; exit 3
  fi
  echo "noindex switches restored (site-config.ts noindexSite: true, astro.config.mjs NOINDEX_SITE_TOWNS has glasgow)"
}
trap restore EXIT INT TERM
# content-based edits (no line numbers): only the Glasgow block's noindexSite and the town set
sed -i 's/^    noindexSite: true,$/    noindexSite: false,/' "$CFG"
sed -i "s/NOINDEX_SITE_TOWNS = new Set(\['glasgow'\])/NOINDEX_SITE_TOWNS = new Set([])/" "$AST"
SITE_CITY=glasgow npx astro build
status=$?
[ $status -eq 0 ] && echo "launch preview, never deploy" > dist/.launch-preview
exit $status
