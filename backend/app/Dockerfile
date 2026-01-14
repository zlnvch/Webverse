FROM golang:1.25-alpine

RUN apk add --no-cache git ca-certificates

WORKDIR /app

# Install Air via go install
RUN go install github.com/air-verse/air@latest

# Copy dependencies first
COPY go.mod go.sum ./
RUN go mod download

# Source code will be bind-mounted in dev
EXPOSE 8080

CMD ["air"]