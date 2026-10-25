IMG=$1; S=/etc/dokploy-bridge-secrets; HOSTIP=$(hostname -I | awk '{print $1}')
sudo docker rm -f sy-b2 >/dev/null 2>&1; sudo docker volume rm sy-b2-data >/dev/null 2>&1
sudo docker run -d --name sy-b2 --network dokploy-network -p 127.0.0.1:3005:3001 -v sy-b2-data:/app/data \
 -e DOKPLOY_URL=http://dokploy:3000 -e DOKPLOY_ORIGIN=http://localhost:3000 -e DOKPLOY_EMAIL=admin@switchyard.local -e DOKPLOY_PASSWORD="$(sudo cat $S/admin)" \
 -e SWITCHYARD_SESSION_SECRET="$(sudo cat $S/session)" -e SWITCHYARD_HOST_IP="$HOSTIP" -l switchyard.managed=true switchyard-dash:$IMG >/dev/null
for i in $(seq 1 30); do sleep 2; c=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3005/login); [ "$c" = 200 ] && break; done; echo "dash $c ($IMG)"
