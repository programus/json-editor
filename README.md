# JSON Editor

A json editor based on [svelt-jsoneditor](https://github.com/josdejong/svelte-jsoneditor) with a [docker image](https://hub.docker.com/repository/docker/programus/json-editor/general), which you can use to self-host one by yourself.

## Using by docker

docker-compose.yml

```yaml
services:
  json-editor:
    platform: linux/amd64
    container_name: json-editor
    image: programus/json-editor:latest
    ports:
      - "8080:8080"
    restart: unless-stopped
    read_only: true
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
```

or docker command

```sh
docker run --rm --platform linux/amd64 --name json-editor -p 8080:8080 programus/json-editor:latest
```

and then open http://localhost:8080 by browser.

> The container listens on **8080**, not 80: it runs as an unprivileged user
> (uid 65532), which cannot bind ports below 1024.

### The image

The image is built on `scratch` and contains nothing but a statically linked
file server and the built assets — no shell, no libc, no package manager, so
there is essentially no OS attack surface to patch.

| | |
|---|---|
| Size | ~7.5 MB |
| Serves | pre-compressed brotli/gzip, negotiated per request |
| Cache headers | `immutable` for hashed assets, `no-cache` for `index.html` |
| Health check | `GET /healthz`, also wired into `HEALTHCHECK` |
| Runs as | uid/gid 65532, read-only rootfs, no capabilities |

Configurable through environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `LISTEN_ADDR` | `:8080` | Address and port to bind |
| `STATIC_ROOT` | `/srv/http` | Directory served |

## Development

```sh
pnpm install
pnpm dev              # dev server with hot reload

pnpm verify           # typecheck + tests + production build
pnpm test             # the frontend regression suite
pnpm run test:server  # the file server's Go tests (requires Go)
pnpm run docker:build # build the production image
```
