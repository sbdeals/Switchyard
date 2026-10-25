#!/bin/bash
# usage: cli-config-demo.sh <label> <path-to-dist/cli.js>   (throwaway temp config only; never touches Docker)
L=$1; CLI=$2; D=$(mktemp -d); export SWITCHYARD_CONFIG=$D/sy/config.json NO_COLOR=1; HERE=$(dirname "$0")
echo "## [$L] $(date '+%H:%M:%S %Z %b %d')  cli=$CLI"
umask 000; echo "\$ umask 000"
for v in 0 -1 65536; do echo "\$ switchyard config set --no-restart dashboardPort -- $v"; node $CLI config set --no-restart dashboardPort -- $v 2>&1 | sed "s#$D#<tmp>#; s/^/  /" | head -4; echo "  exit=${PIPESTATUS[0]}"; echo "  persisted dashboardPort: $(node -e "try{console.log(require('$SWITCHYARD_CONFIG').dashboardPort)}catch{console.log('(no file)')}")"; done
echo "\$ switchyard config set --no-restart dashboardPort 8081"; node $CLI config set --no-restart dashboardPort 8081 2>&1 | sed "s#$D#<tmp>#; s/^/  /" | head -3
echo "\$ stat -c '%a %n' config dir + file (umask 000)"; stat -c '  %a %n' $D/sy $D/sy/config.json | sed "s#$D#<tmp>#"
echo "\$ hand-edit dashboardPort=70000, then: switchyard config list"; node -e "const f='$SWITCHYARD_CONFIG';const c=require(f);c.dashboardPort=70000;require('fs').writeFileSync(f,JSON.stringify(c))"; node $CLI config list 2>&1 | grep -iE 'dashboardPort|invalid|error' | sed "s#$D#<tmp>#; s/^/  /" | head -3
echo "\$ umask 022; fresh save with mode-probe.mjs preloaded (prints the file mode the moment it exists)"
(umask 022; SWITCHYARD_CONFIG=$D/c2.json node --import $HERE/mode-probe.mjs $CLI config set --no-restart dashboardPort 8082 2>&1 | grep probe)
rm -rf $D
