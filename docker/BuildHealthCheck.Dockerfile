############################################
# Build in Golang
############################################
FROM golang:1.27.1-bookworm@sha256:69a7b9788769bec032d238959b61854e9ae87f57be9029ec04e9885fabf99195
WORKDIR /app
ARG TARGETPLATFORM
COPY ./extra/healthcheck.go ./extra/healthcheck.go

# Compile healthcheck.go
RUN go build -x -o ./extra/healthcheck ./extra/healthcheck.go
