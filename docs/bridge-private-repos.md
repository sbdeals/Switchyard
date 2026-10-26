# Private Git on bridge hosts

The connected-repo form lists the current Dokploy user's GitHub, GitLab,
Bitbucket and Gitea providers, then SSH keys. Custom Git accepts credential-free
SSH URLs only. Swarm hosts support GitHub only and reject other providers before
creating anything.

Dokploy owns authentication and cloning. Switchyard uses `patch.ensureRepo` for
a preflight clone, then a networkless, read-only `alpine/git:2.49.1` helper
archives HEAD into a temporary `/source`. Only bounded, regular build manifests
reach the existing Node/Python/Go/static detector. A Dockerfile takes priority;
a custom Dockerfile must exist. The explicit app port wins, otherwise the
detected builder port or Dockerfile EXPOSE supplies the first domain's port.
Overview shows the builder and port.

Native deployment clones again, applies `../switchyard.compose.yaml` through
`patch.saveFileAsPatch`, and archives into `.switchyard-source` before building.
Compose, its generated `.env`, and staging live beside the clone so tracked
symlinks cannot redirect their writes. The repo's `.dockerignore` survives;
`.git/config` and generated env files never enter the build context.
[Native clone/patch/build order](https://github.com/Dokploy/dokploy/blob/v0.30.10/packages/server/src/services/compose.ts),
[file-editor clone API](https://github.com/Dokploy/dokploy/blob/v0.30.10/packages/server/src/services/patch-repo.ts).

Limits: the local Docker socket and standard `/etc/dokploy` host bind are required.
Manifest reads cap at 128 KiB each; staging caps at 128 MiB and 30 seconds, after
the bounded image pull. Clone calls use the configured Dokploy API timeout.
Submodules and Git LFS hydration are unsupported; `git archive` honors
export-ignore. A branch changing between the two clones can invalidate the
initial plan; later redeploys retain that plan. Set the app port when a
Dockerfile's listening port cannot be inferred. No provider credentials are
returned to client props, Compose or managed metadata.

Deploy logs already stream Dokploy's native clone and Compose build output:
`dashboard/src/components/service/DeployActivity.tsx:99` opens the SSE route,
which uses `deploymentLogTarget` / `openDeploymentLogSocket` in
`dashboard/src/lib/dokploy.ts:1043`. No alternate log pipeline was added.

## Repeat the proof on this VM only

Use local Dokploy :3000 and Switchyard :3001, signed in through the existing login
page. Do not read credential files or use a real Git host. Create this fixture:

```sh
proof=$(mktemp -d "$PWD/.bridge-private-proof.XXXXXX")
suffix=$(basename "$proof" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9' | tail -c 6)
fixture="sy-a-gitssh-$suffix"
keyname="sy-a-throwaway-$suffix"
ssh-keygen -q -t ed25519 -N '' -C "$keyname" -f "$proof/client"
printf '*\n!Dockerfile\n!repo.fi\n' > "$proof/.dockerignore"
python3 - "$proof" <<'PY'
from pathlib import Path
import sys
files = {"index.html": "<h1>Switchyard private SSH proof</h1>\n",
         ".dockerignore": "ignored.txt\n", "ignored.txt": "must not enter image\n"}
data = "commit refs/heads/main\ncommitter Proof <proof@example.test> 1792900000 +0000\ndata 7\ninitial\n"
for name, content in files.items():
    data += f"M 100644 inline {name}\ndata {len(content.encode())}\n{content}\n"
Path(sys.argv[1], "repo.fi").write_text(data + "\ndone\n")
PY
cat > "$proof/Dockerfile" <<'EOF'
FROM alpine:3.22
RUN apk add --no-cache openssh git && adduser -D -s /usr/bin/git-shell git && passwd -d git \
    && mkdir -p /repos /home/git/.ssh && chmod 700 /home/git/.ssh \
    && printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\nAllowUsers git\n' > /etc/ssh/sshd_config.d/proof.conf
COPY repo.fi /tmp/repo.fi
RUN git init --bare --initial-branch=main /repos/demo.git && git -C /repos/demo.git fast-import --quiet < /tmp/repo.fi \
    && rm /tmp/repo.fi && chown -R git:git /repos /home/git
CMD ["sh", "-ec", "ssh-keygen -A; cp /client.pub /home/git/.ssh/authorized_keys; chmod 600 /home/git/.ssh/authorized_keys; chown git:git /home/git/.ssh/authorized_keys; exec /usr/sbin/sshd -D -e"]
EOF
sudo docker build -t "$fixture:ssh" "$proof"
sudo docker run -d --name "$fixture" --network dokploy-network \
  --mount "type=bind,src=$proof/client.pub,dst=/client.pub,readonly" "$fixture:ssh"
printf 'Key name: %s\nRepo: ssh://git@%s:22/repos/demo.git\n' "$keyname" "$fixture"
```

1. In Dokploy **Settings → SSH Keys** (`/dashboard/settings/ssh-keys`), register
   the newly generated private/public key pair under the printed name. Use your
   editor; never print the private key, put it in argv or paste it into chat.
2. In a new throwaway project, choose Switchyard **Connected Git repo**, that SSH
   key, the printed URL and branch `main`. Leave port blank and Dockerfile at
   `Dockerfile`. The repo has **no Dockerfile**. Expect Static (nginx), port 80,
   native clone/build logs, and HTTP 200 on the first deploy.
3. Use the generated host against **local** Traefik, without public DNS:
   `curl --max-time 5 -H "Host: <generated-host>" http://127.0.0.1/`.
   Expect `/.git/config`, `/.env`, and `/ignored.txt` to return 404. In the
   created app container, verify those files are absent under
   `/usr/share/nginx/html`; do not exec into pre-existing demo apps.
4. Record this app's `appName`, then remove only this app/project and registered
   SSH key in their UIs. Remove its `<appName>-app:latest` image and its own
   `/etc/dokploy/patch-repos/compose/<appName>` preflight clone. Then clean up:

```sh
sudo docker rm -f "$fixture"
sudo docker image rm "$fixture:ssh"
rm -f "$proof/client" "$proof/client.pub" "$proof/Dockerfile" "$proof/.dockerignore" "$proof/repo.fi"
rmdir "$proof"
```

No host port or named volume is created by the SSH fixture. Preserve
`dokploy-network`, existing images and proof apps. Dokploy v0.30.10's native
SSH clone manages shared `/tmp/id_rsa` and known-hosts files; this proof does not
inspect or modify those shared credential files.

## Executed proof — 2026-10-25

Ran the current `quickDeployConnectedGitAction` through a temporary bundled
action harness in the local dashboard container. Only Next request-cookie,
redirect and revalidation plumbing was shimmed; login, provider checks, native
clone, Docker helper, Compose deployment, domains and cleanup used real local
APIs. The dashboard's existing login action kept credentials/session in memory.
No dashboard image, npm dependency or production resource was changed.

The VM ran Dokploy v0.30.10 and Docker Compose 5.6.1. The final run built
`ssh://git@sy-a-gitssh-kzdlrl:22/repos/demo.git` without a
Dockerfile: static builder, port 80, native clone → build → HTTP 200 through local
Traefik. All three protected paths returned 404; container filesystem checks
confirmed absence. No throwaway key appeared in Compose or deployment logs.

Created and removed (including two earlier HTTP-harness attempts):

| Resource | Exact name(s) |
| --- | --- |
| SSH server container/image | `sy-a-gitssh-kzdlrl`, `sy-a-gitssh-kzdlrl:ssh` |
| SSH key | `sy-a-throwaway-kzdlrl` (three registrations, each deleted) |
| Project | `sy-a-private-proof-kzdlrl` (three creations, each deleted) |
| Compose apps | `demo-k29v-g0inzj`, `demo-s4du-jhfhkd`, `demo-csfc-ixqwte` |
| App containers/images | Each app's `-app-1` container and `-app:latest` image |
| Clone/staging directories | Each app's own Compose directory and patch-repo clone |
| Helper resources | Three detection containers and three Compose staging jobs; freshly pulled `alpine/git:2.49.1` removed |
| Anonymous helper volumes | `d74701e274fabf1f9c097ff30d8dddac05824c8035f1cc9eaa259f74484af7d0`, `dca2ef36a3d7f5fba7328db66e265d5c2d7047869e237d810d3ee1552cafd379`, `5a321e9a9927143b23eaa52a38a56492247213bb291f4302fd5aed2430f482ef` |
| Local files | `.private-repo-live.kzDlrL` fixture, throwaway keypair and temporary harness |

The cleanup audit found the helper image's anonymous `/git` volumes; the three
proof volumes were identified by creation time and removed. Helper cleanup now
passes `v: true` so subsequent detections remove their volumes automatically.
No named volumes were created. All proof login sessions were signed out.
The pre-existing `nginx:alpine` image and local stack were preserved.
