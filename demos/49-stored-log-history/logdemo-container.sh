#!/bin/sh
# fresh log-demo container named like a swarm task of registry-app (appName app-input-bluetooth-panel-c7aegs)
C=app-input-bluetooth-panel-c7aegs.1.logdemo
docker rm -f $C >/dev/null 2>&1
docker run -d --name $C -l com.docker.swarm.service.name=app-input-bluetooth-panel-c7aegs alpine sh -c 'echo "=== container started $(date +%T) ==="; i=0; while [ $i -lt 5 ]; do i=$((i+1)); echo "tick $i ✅ café 日本語"; sleep 1; done; sleep 3600' >/dev/null
sleep 7
