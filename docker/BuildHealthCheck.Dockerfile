############################################
# Build in Golang
############################################
FROM golang:1.27.3-bookworm@sha256:972b4110ba0f47539a975c31e52c64765e1ff19f2d74469ae4a595c6676e80a5
WORKDIR /app
ARG TARGETPLATFORM
COPY ./extra/healthcheck.go ./extra/healthcheck.go

# Compile healthcheck.go
RUN go build -x -o ./extra/healthcheck ./extra/healthcheck.go
