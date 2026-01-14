package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/zlnvch/webverse/api"
	"github.com/zlnvch/webverse/cache/redis"
	"github.com/zlnvch/webverse/mq/sqsmq"
	"github.com/zlnvch/webverse/store/dynamo"
	"golang.org/x/oauth2"
)

const (
	DynamoDBTable             = "Webverse"
	SQSDeleteUserStrokesQueue = "DeleteUserStrokesQueue"
)

func main() {
	ctx := context.Background()
	devMode := os.Getenv("DEV_MODE") == "true"

	webverseStore, err := dynamo.NewDynamoWebverseStore(ctx, devMode, os.Getenv("DYNAMODB_ENDPOINT"), DynamoDBTable)
	if err != nil {
		log.Fatalf("Failed to create dynamodb store: %v", err)
	}

	deleteUserStrokesQueue, err := sqsmq.NewSQSMessageQueue(ctx, devMode, os.Getenv("SQS_ENDPOINT"), SQSDeleteUserStrokesQueue)
	if err != nil {
		log.Fatalf("Failed to create SQS MQ: %v", err)
	}

	webverseCache, err := redis.NewRedisWebverseCache(ctx, devMode, os.Getenv("REDIS_ENDPOINT"))
	if err != nil {
		log.Fatalf("Failed to create redis cache: %v", err)
	}

	extensionId := os.Getenv("EXTENSION_ID")

	var oauthConfigs = map[string]*oauth2.Config{
		"github": {
			ClientID:     os.Getenv("GITHUB_CLIENT_ID"),
			ClientSecret: os.Getenv("GITHUB_CLIENT_SECRET"),
			RedirectURL:  fmt.Sprintf("https://%s.chromiumapp.org/", extensionId),
		},
		"google": {
			ClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
			ClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
			RedirectURL:  fmt.Sprintf("https://%s.chromiumapp.org/", extensionId),
		},
	}

	jwtSecret, err := base64.StdEncoding.DecodeString(os.Getenv("JWT_SECRET"))
	if err != nil {
		log.Fatalf("Failed to decode base64 jwtSecret: %v", err)
	}

	shutdownCtx, stop := signal.NotifyContext(
		context.Background(),
		os.Interrupt,
		syscall.SIGTERM,
	)
	defer stop()

	webverseApi, err := api.NewWebverseAPI(webverseStore, deleteUserStrokesQueue, webverseCache, oauthConfigs, jwtSecret, shutdownCtx)
	if err != nil {
		log.Fatalf("Failed to create webverse api: %v", err)
	}

	mux := http.NewServeMux()
	webverseApi.RegisterRoutes(mux, "chrome-extension://"+extensionId)

	hostPort := "8080"
	if p := os.Getenv("HOST_PORT"); p != "" {
		hostPort = p
	}
	log.Printf("Starting server on host port: %s\n", hostPort)
	log.Fatal(http.ListenAndServe(":8080", mux))

	log.Printf("Server shutting down...")
}
