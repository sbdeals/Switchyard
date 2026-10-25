L=$1; S=/etc/dokploy-bridge-secrets; HOSTIP=$(hostname -I | awk '{print $1}')
sudo docker rm -f sy-c1 >/dev/null 2>&1; sudo docker volume rm sy-c1-data >/dev/null 2>&1
sudo docker run -d --name sy-c1 --network dokploy-network -p 127.0.0.1:3002:3001 -v /var/run/docker.sock:/var/run/docker.sock -v sy-c1-data:/app/data \
 -e DOKPLOY_URL=http://dokploy:3000 -e DOKPLOY_ORIGIN=http://localhost:3000 -e DOKPLOY_EMAIL=admin@switchyard.local -e DOKPLOY_PASSWORD="$(sudo cat $S/admin)" \
 -e SWITCHYARD_SESSION_SECRET="$(sudo cat $S/session)" -e SWITCHYARD_HOST_IP="$HOSTIP" -e BRIDGE_REPO_PORT_POLL_MS=60000 -l switchyard.managed=true switchyard-dash:c1-$L >/dev/null
sleep 12; curl -s -o /dev/null -w "dash %{http_code}\n" http://127.0.0.1:3002/login
