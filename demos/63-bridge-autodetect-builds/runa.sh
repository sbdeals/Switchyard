L=$1; S=/etc/dokploy-bridge-secrets; HOSTIP=$(hostname -I | awk '{print $1}')
sudo docker rm -f sy-a >/dev/null 2>&1; sudo docker volume rm sy-a-data >/dev/null 2>&1
sudo docker run -d --name sy-a --network dokploy-network -p 127.0.0.1:3003:3001 -v /var/run/docker.sock:/var/run/docker.sock -v sy-a-data:/app/data \
 -e DOKPLOY_URL=http://dokploy:3000 -e DOKPLOY_ORIGIN=http://localhost:3000 -e DOKPLOY_EMAIL=admin@switchyard.local -e DOKPLOY_PASSWORD="$(sudo cat $S/admin)" \
 -e SWITCHYARD_SESSION_SECRET="$(sudo cat $S/session)" -e SWITCHYARD_HOST_IP="$HOSTIP" -l switchyard.managed=true switchyard-dash:a-$L >/dev/null
for i in $(seq 1 30); do sleep 2; c=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3003/login); [ "$c" = 200 ] && break; done; echo "dash $c"
