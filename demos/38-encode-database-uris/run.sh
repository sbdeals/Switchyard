#!/bin/bash
# Live check: a real postgres:16 whose password is p@ss:w/rd#1, connected with the exact URL the dashboard copies.
cd "$(dirname "$0")"
say(){ printf '\n\033[1;35m$ %s\033[0m\n' "$*"; }
for v in "BEFORE main:./main"  # main/ holds origin/main connection.ts+engines.ts; symlink main/dashboard/node_modules to a dashboard node_modules first "AFTER codex/encode-database-uris:/workspace/wt-encode-database-uris"; do
  label=${v%%:*}; root=$(realpath "${v#*:}")
  echo; echo "########## $label ##########"
  url=$(node url.cjs "$root"); say "dashboard connection string"; echo "$url"
  say "psql \"\$url\" -c 'select current_user, current_database()'"
  docker run --rm --network pgdemo-net postgres:16 psql "$url" -c 'select current_user, current_database()' 2>&1 | sed 's/^/  /'
done
