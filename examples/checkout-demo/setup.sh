#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  printf 'Usage: bash setup.sh <new-directory>\n' >&2
  exit 1
fi

example_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
mkdir -- "$1"
destination=$(cd -- "$1" && pwd)
cp -R -- "$example_dir/src" "$example_dir/test" "$destination"

# Keep repository-local Git settings from the caller out of the demo.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
export GIT_AUTHOR_NAME='CodeRipple Demo' GIT_AUTHOR_EMAIL='demo@example.invalid'
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
export GIT_AUTHOR_DATE='2026-01-01T00:00:00Z'
export GIT_COMMITTER_DATE="$GIT_AUTHOR_DATE"

git -C "$destination" init --quiet --template= --initial-branch=demo-head --object-format=sha1
git -C "$destination" -c core.autocrlf=false add -- src test
base_tree=$(git -C "$destination" write-tree)
base=$(git -C "$destination" -c commit.gpgsign=false commit-tree "$base_tree" -m 'Free shipping at 50')
git -C "$destination" update-ref refs/heads/demo-base "$base"

git -C "$destination" apply --index "$example_dir/shipping-threshold.patch"
head_tree=$(git -C "$destination" write-tree)
head=$(git -C "$destination" -c commit.gpgsign=false commit-tree "$head_tree" -p "$base" -m 'Raise free shipping threshold to 75')
git -C "$destination" update-ref HEAD "$head"
printf 'Demo repository ready at %s (demo-base → demo-head)\n' "$destination"
