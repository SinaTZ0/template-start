# syntax=docker/dockerfile:1

# The error viewer: one static binary (templates and static files embedded) on an empty base image. Built by
# compose.dev.yaml and compose.prod.yaml from this folder. Everything comes from Docker Hub.

# ===== Build =====
FROM golang:1.26-alpine AS build
# A Go module mirror, for a machine that can't reach proxy.golang.org. Empty uses Go's default.
ARG GOPROXY
WORKDIR /src
COPY . .
# Modules come from a `vendor/` folder when there is one (`go mod vendor`, for a machine that can't reach
# proxy.golang.org), and are downloaded otherwise. modernc.org/sqlite is pure Go, so no cgo: the binary runs without a
# libc.
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/error-viewer . \
    && mkdir -p /out/data /out/tmp && chmod 1777 /out/tmp

# ===== Runtime =====
# `scratch` is empty: no shell, no package manager, nothing to patch. The binary needs no libc, certificates or time
# zones (it makes no outgoing HTTPS calls and shows UTC).
FROM scratch
COPY --from=build /out/error-viewer /error-viewer
# SQLite may spill large sorts to a temporary file.
COPY --from=build /out/tmp /tmp
# A new named volume mounted here starts with this directory's owner, so the non-root user can write to it.
COPY --from=build --chown=65532:65532 /out/data /data
# An unprivileged user by number: scratch has no /etc/passwd.
USER 65532:65532
ENV LISTEN_ADDR=:8000 DATA_DIR=/data TMPDIR=/tmp
EXPOSE 8000
# No shell or curl in the image: the binary checks itself.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD ["/error-viewer", "healthcheck"]
ENTRYPOINT ["/error-viewer"]
