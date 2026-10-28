#!/usr/bin/env bash
# Build the release AppImage plus SHA256SUMS and create (or update) a DRAFT
# GitHub release for the version in package.json. Nothing is published: open
# the draft on GitHub and click Publish when it's ready.
#
#   scripts/release.sh             build + draft release
#   DRY_RUN=1 scripts/release.sh   build + checksums only, no GitHub
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"
APPIMAGE="dist/live-studio-linux-$VERSION-x86_64.AppImage"
OUT="dist/release-$VERSION"
DRY_RUN=${DRY_RUN:-}

die() { echo "release: $*" >&2; exit 1; }

# Release notes come from the "## <version>" section of CHANGELOG.md.
NOTES=$(awk -v v="$VERSION" '
  $0 ~ "^## " { if (found) exit; if ($2 == v || $2 == "["v"]") { found = 1; next } }
  found { print }
' CHANGELOG.md)
[ -n "$(echo "$NOTES" | tr -d '[:space:]')" ] || die "add a \"## $VERSION\" section to CHANGELOG.md first"

if [ -n "$(git status --porcelain)" ]; then
  if [ -n "$DRY_RUN" ]; then echo "release: working tree has uncommitted changes (ignored for a dry run)"
  else die "commit or stash your changes first"; fi
fi

make check
rm -f "$APPIMAGE"
npx electron-builder --linux AppImage
[ -f "$APPIMAGE" ] || die "expected $APPIMAGE after the build"

rm -rf "$OUT"
mkdir -p "$OUT"
cp "$APPIMAGE" "$OUT/"
(cd "$OUT" && sha256sum ./*.AppImage | sed 's#  \./#  #' > SHA256SUMS)
printf '%s\n' "$NOTES" > "$OUT/NOTES.md"
echo "release: built $OUT"
ls -la "$OUT"

if [ -n "$DRY_RUN" ]; then
  echo "release: dry run, skipping GitHub"
  exit 0
fi

command -v gh >/dev/null || die "gh (GitHub CLI) is not installed"
git push -q origin HEAD
COMMIT=$(git rev-parse HEAD)
if gh release view "$TAG" >/dev/null 2>&1; then
  [ "$(gh release view "$TAG" --json isDraft -q .isDraft)" = "true" ] || die "$TAG is already published; bump the version"
  gh release upload "$TAG" "$OUT"/*.AppImage "$OUT/SHA256SUMS" --clobber
  gh release edit "$TAG" --notes-file "$OUT/NOTES.md" --target "$COMMIT"
  echo "release: updated draft $TAG"
else
  gh release create "$TAG" "$OUT"/*.AppImage "$OUT/SHA256SUMS" \
    --draft --target "$COMMIT" --title "LIVE Studio for Linux $VERSION" --notes-file "$OUT/NOTES.md"
  echo "release: created draft $TAG"
fi
gh release view "$TAG" --json url -q .url
