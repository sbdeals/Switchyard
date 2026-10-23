#!/usr/bin/env bash
# BEFORE (origin/main CLI @ 1fc46d5): container recreate on the same disposable dind daemon
set -eu; set +x; umask 077
export DOCKER_HOST=tcp://172.17.0.4:2375
docker network inspect dokploy-network >/dev/null 2>&1 || docker network create dokploy-network >/dev/null
docker tag switchyard-dash:integration-52fix-53-54-55 localhost/switchyard-cp25-live:before
docker tag switchyard-dash:integration-52fix-53-54-55 localhost/switchyard-cp25-live:after
T=$(mktemp -d); export SWITCHYARD_CONFIG="$T/config.json"
node -e 'require("fs").writeFileSync(process.env.SWITCHYARD_CONFIG, JSON.stringify({schemaVersion:1,platform:"docker-desktop",image:"localhost/switchyard-cp25-live",imageTag:"before",dashboardPort:43001,store:false,skipTraefik:true,adminEmail:"",adminPassword:"",sessionSecret:"",dokployUrlInContainer:"http://127.0.0.1:9"}))'
cd /workspace/wt-main-cli
echo '$ docker run -d --name switchyard -v /var/run/docker.sock:/var/run/docker.sock …:before   # same layout main renderContainer() produces (socket mount only)'
docker run -d --name switchyard --network dokploy-network -p 127.0.0.1:43001:3001 -v /var/run/docker.sock:/var/run/docker.sock localhost/switchyard-cp25-live:before >/dev/null
echo '$ docker inspect switchyard mounts:'; docker inspect switchyard --format '{{range .Mounts}}{{.Type}}:{{.Destination}} {{end}}'
echo '# user saves an agent key in the dashboard (fixture: dummy key written in-container)'
docker exec switchyard node -e 'const f=require("fs");f.mkdirSync("/root/.switchyard",{recursive:true});f.writeFileSync("/root/.switchyard/agent-key.json",JSON.stringify({provider:"anthropic",key:"dummy-"+require("crypto").randomBytes(8).toString("hex")}),{mode:0o600})'
echo -n '$ key file present? '; docker exec switchyard test -f /root/.switchyard/agent-key.json && echo yes
echo '$ switchyard config set imageTag after    # upgrade => container recreated'
node cli/dist/cli.js config set imageTag after 2>&1 | grep -v "^│$" | tail -3 || true
echo -n '$ key file present after recreate? '; docker exec switchyard test -f /root/.switchyard/agent-key.json && echo yes || echo 'NO — saved agent key lost (C-P2-5)'
echo '$ switchyard down --yes'; node cli/dist/cli.js down --yes >/dev/null 2>&1 || true
docker volume ls --format '{{.Name}}' | grep -c '^switchyard-data$' | sed 's/^/switchyard-data volumes: /' || true
rm -rf "$T"
