#!/bin/bash
# Real Docker on the bridge VM: the branch's name-only patterns (`-e NAME`, and `--env-file` with a name-only line)
# still deliver the secret into the container, although the secret is no longer in the docker argv.
set -eu
SECRET="SYNTH-live-$(date +%s)"
f=$(mktemp); printf 'POSTGRES_PASSWORD\n' > "$f"
check() { # $1 = var to read inside, rest = docker run args
  local var=$1; shift; local name=argv-check-$RANDOM
  local args=(run -d --rm --name "$name" "$@" alpine sleep 30)
  DOKPLOY_PASSWORD="$SECRET" POSTGRES_PASSWORD="$SECRET" docker "${args[@]}" >/dev/null
  local inside; inside=$(docker exec "$name" printenv "$var")
  echo "docker ${args[*]}"
  echo "  secret present in argv: $(printf '%s ' "${args[@]}" | grep -c -- "$SECRET" || true)   container sees correct $var: $([ "$inside" = "$SECRET" ] && echo yes || echo NO)"
  docker rm -f "$name" >/dev/null
}
echo "## main pattern"; check DOKPLOY_PASSWORD -e "DOKPLOY_PASSWORD=$SECRET"
echo "## branch: dashboard container (-e NAME)"; check DOKPLOY_PASSWORD -e DOKPLOY_PASSWORD
echo "## branch: metrics store (--env-file, name-only line)"; check POSTGRES_PASSWORD --env-file "$f"
rm -f "$f"
