#!/usr/bin/env bash
# Supply-chain audit of a checkout's workflows: unpinned actions, curl|bash, unversioned modules, permissions blocks.
# usage: audit.sh <label> <repo-dir>
set -u; cd "$2/.github/workflows"
echo "## [$1] $(TZ=America/New_York date '+%H:%M:%S %Z')  $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "action refs total:      $(grep -hoE 'uses: [^ ]+' *.yml | wc -l)"
echo "  pinned to 40-hex SHA: $(grep -hoE 'uses: [^ ]+@[0-9a-f]{40}' *.yml | wc -l)"
echo "  mutable tag refs:     $(grep -hoE 'uses: [^ ]+' *.yml | grep -vcE '@[0-9a-f]{40}$')"
grep -hoE 'uses: [^ ]+' *.yml | grep -vE '@[0-9a-f]{40}$' | sort | uniq -c | sed 's/^/      /'
echo "curl | bash installers: $(grep -cE 'curl[^|]*\| *(sudo[^|]*)?(ba)?sh' *.yml | paste -sd' ')"
echo "sha256 --check steps:   $(grep -c 'sha256sum --check' *.yml | paste -sd' ')"
echo "Install-Module w/o version: $(grep -E 'Install-Module' *.yml | grep -vc RequiredVersion)"
for f in *.yml; do echo "top-level permissions in $f: $(awk '/^permissions:/{p=1;next} p&&/^[^ ]/{exit} p{printf "%s ", $0}' $f | tr -s ' ' || true)"; done
