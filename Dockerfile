# Build a static binary with the game files embedded.
FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY main.go ./
COPY web ./web
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/scb . \
 && mkdir -p /out/data

# Minimal runtime image: just the binary, running as a non-root user.
FROM scratch
COPY --from=build /out/scb /scb
COPY --from=build --chown=65532:65532 /out/data /data
USER 65532:65532
ENV SCB_ADDR=:8080 SCB_DATA=/data
EXPOSE 8080
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD ["/scb", "-healthcheck"]
ENTRYPOINT ["/scb"]
