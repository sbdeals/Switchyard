# runsy.sh <name> <port> <image-tag>: throwaway Switchyard dashboard against local Dokploy
N=$1; P=$2; IMG=$3; S=/etc/dokploy-bridge-secrets; HOSTIP=$(hostname -I | awk '{print $1}')
sudo docker rm -f $N >/dev/null 2>&1; sudo docker volume rm $N-data >/dev/null 2>&1
sudo docker run -d --name $N --network dokploy-network -p 127.0.0.1:$P:3001 -v /var/run/docker.sock:/var/run/docker.sock -v $N-data:/app/data \
 -e DOKPLOY_URL=http://dokploy:3000 -e DOKPLOY_ORIGIN=http://localhost:3000 -e DOKPLOY_EMAIL=admin@switchyard.local -e DOKPLOY_PASSWORD="$(sudo cat $S/admin)" \
 -e SWITCHYARD_SESSION_SECRET="$(sudo cat $S/session)" -e SWITCHYARD_HOST_IP="$HOSTIP" -l switchyard.managed=true switchyard-dash:$IMG >/dev/null
for i in $(seq 1 30); do sleep 2; c=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:$P/login); [ "$c" = 200 ] && break; done; echo "$N :$P $IMG -> $c"
