# syntax=docker/dockerfile:1

# --- Stage 1: build the static bundle -------------------------------------
# Pinned to the build host's architecture: the output is platform-neutral
# JavaScript, so building it once and reusing it for every target platform
# avoids running the whole toolchain under emulation.
FROM --platform=$BUILDPLATFORM node:lts-slim AS assets
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app
# Copy manifests first so dependency installation is cached independently
# of source changes.
COPY package.json pnpm-lock.yaml ./
# pnpm 11 blocks dependency build scripts by default and fails the install.
# esbuild needs its postinstall to place its platform binary, and @parcel/watcher
# is a transitive dev dependency; both are trusted, widely used packages.
RUN pnpm config set dangerouslyAllowAllBuilds true \
    && pnpm install --frozen-lockfile
COPY . .
# Emits dist/ along with pre-compressed .br/.gz siblings.
RUN pnpm run build

# --- Stage 2: build the file server ---------------------------------------
# Also pinned to the build host: Go cross-compiles natively, which is far
# faster than emulating the compiler on the target architecture.
#
# The Go minor version is deliberately left unpinned. A `scratch` image holds
# nothing a scanner can inspect except the toolchain version Go stamps into the
# binary, and scanners report every advisory for that version without checking
# whether the affected package is even reachable. So the toolchain is the only
# lever on the vulnerability report, and a pinned minor version silently rots:
# Go supports only its two most recent releases, so a pin becomes a permanent
# source of unpatched advisories a few months after it is written.
#
# Floating gives up bit-for-bit reproducibility, and picks up major bumps
# unreviewed. The `go test` below is what makes that safe — a toolchain that
# breaks this server fails the build instead of shipping. Pin a released
# image's digest if you need to reproduce one exactly.
#
# Note this only takes effect with `docker build --pull`; see the docker:build
# script in package.json.
FROM --platform=$BUILDPLATFORM golang:alpine AS server
ARG TARGETOS
ARG TARGETARCH
# Refuse to build with a toolchain older than go.mod's floor rather than
# quietly downloading a second one, so a stale cached base image is a loud
# failure instead of an old binary.
ENV GOTOOLCHAIN=local
WORKDIR /src
# No third-party modules, so there is nothing to download; go.mod alone is
# enough to compile and test.
COPY server/go.mod ./
COPY server/*.go ./
# Tests run on the build host's architecture. The server has no
# architecture-specific code, so one native run covers every target.
RUN go vet ./... && go test ./...
# Fully static so the binary can run on scratch: no cgo, no dynamic loader.
# Symbol tables and DWARF data are stripped since they are useless in an image.
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w" -o /out/fileserver .

# --- Stage 3: runtime -----------------------------------------------------
# `scratch` holds nothing but our binary and the bundle: no shell, no libc, no
# package manager, so there is essentially no OS attack surface to patch.
FROM scratch AS runtime

COPY --from=server /out/fileserver /fileserver
COPY --from=assets /app/dist /srv/http

# Matches the conventional distroless nonroot uid/gid. scratch has no
# /etc/passwd, so the numeric form is required.
USER 65532:65532

ENV LISTEN_ADDR=":8080" \
    STATIC_ROOT="/srv/http"
EXPOSE 8080

# The binary probes itself: scratch has no shell or curl for a normal healthcheck.
HEALTHCHECK --interval=30s --timeout=5s --start-period=2s --retries=3 \
    CMD ["/fileserver", "-healthcheck"]

# Unprivileged, so the port must be above 1024.
ENTRYPOINT ["/fileserver"]
