#!/bin/bash
# run-live.sh <label> <store.ts>: Postgres is down at start, comes up 3s later (simulates the store container starting after the dashboard).
L=$1; F=$2; N=sy-store-demo-pg
sudo docker rm -f $N >/dev/null 2>&1
export SWITCHYARD_STORE_URL=postgres://demo:demo-throwaway@127.0.0.1:55432/demo
( sleep 3; sudo docker run -d --rm --name $N -e POSTGRES_USER=demo -e POSTGRES_PASSWORD=demo-throwaway -e POSTGRES_DB=demo -p 127.0.0.1:55432:5432 postgres:16 >/dev/null; echo "  (t+~3s: throwaway postgres:16 container started)" ) &
node "$(dirname "$0")/live-store.cjs" $L $F
wait; sudo docker rm -f $N >/dev/null 2>&1
