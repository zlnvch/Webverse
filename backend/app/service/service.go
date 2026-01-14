package service

import (
	"github.com/zlnvch/webverse/cache"
	"github.com/zlnvch/webverse/mq"
	"github.com/zlnvch/webverse/store"
	"github.com/zlnvch/webverse/worker"
	"golang.org/x/oauth2"
)

type Service struct {
	Store          store.WebverseStore
	Cache          cache.WebverseCache
	MQ             mq.MessageQueue
	StrokeBatcher  *worker.StrokeBatcher
	CounterBatcher *worker.CounterBatcher
	OAuthConfigs   map[string]*oauth2.Config
	JWTSecret      []byte
}

func NewService(
	store store.WebverseStore,
	cache cache.WebverseCache,
	mq mq.MessageQueue,
	strokeBatcher *worker.StrokeBatcher,
	counterBatcher *worker.CounterBatcher,
	oauthConfigs map[string]*oauth2.Config,
	jwtSecret []byte,
) (*Service, error) {
	oauthConfigs, err := addOauthEndpointsAndScopes(oauthConfigs)
	if err != nil {
		return nil, err
	}

	return &Service{
		Store:          store,
		Cache:          cache,
		MQ:             mq,
		StrokeBatcher:  strokeBatcher,
		CounterBatcher: counterBatcher,
		OAuthConfigs:   oauthConfigs,
		JWTSecret:      jwtSecret,
	}, nil
}
