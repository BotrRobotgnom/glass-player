#!/usr/bin/env bash
# Uploads files to the draft release whose id is in $RELEASE_ID (used by .github/workflows/release.yml).
# A file with the same name already on the release (a re-run) is replaced. A missing file fails the job.
set -euo pipefail
: "${RELEASE_ID:?RELEASE_ID is not set}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set}"

shopt -s nullglob
files=()
for pattern in "$@"; do
  matches=($pattern)
  if [ ${#matches[@]} -eq 0 ]; then
    echo "::error::No file matches $pattern"
    exit 1
  fi
  files+=("${matches[@]}")
done

for file in "${files[@]}"; do
  name=$(basename "$file")
  for old in $(gh api "repos/$GITHUB_REPOSITORY/releases/$RELEASE_ID/assets" --paginate --jq ".[] | select(.name==\"$name\") | .id"); do
    echo "Replacing the existing $name"
    gh api -X DELETE "repos/$GITHUB_REPOSITORY/releases/assets/$old"
  done
  echo "Uploading $name"
  gh api -X POST -H "Content-Type: application/octet-stream" \
    "https://uploads.github.com/repos/$GITHUB_REPOSITORY/releases/$RELEASE_ID/assets?name=$name" \
    --input "$file" > /dev/null
done
