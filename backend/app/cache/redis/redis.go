package redis

import (
	"context"
	"crypto/tls"
	"log"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/zlnvch/webverse/cache"
)

type RedisWebverseCache struct {
	client redis.UniversalClient
}

func NewRedisWebverseCache(ctx context.Context, devMode bool, redis_endpoint string) (*RedisWebverseCache, error) {
	var client redis.UniversalClient
	if devMode {
		client = redis.NewClient(&redis.Options{
			Addr: redis_endpoint,
		})
	} else {
		client = redis.NewClient(&redis.Options{
			Addr: redis_endpoint,
			// AWS elasticache endpoints require TLS
			TLSConfig: &tls.Config{},
		})
	}

	err := client.Ping(ctx).Err()
	if err != nil {
		return nil, err
	}

	return &RedisWebverseCache{client: client}, nil
}

func (redisCache *RedisWebverseCache) Publish(ctx context.Context, channel string, message []byte) error {
	if err := redisCache.client.Publish(ctx, channel, message).Err(); err != nil {
		return err
	}
	return nil
}

func (redisCache *RedisWebverseCache) Subscribe(ctx context.Context, channel string, handler func(message []byte)) error {
	pubsub := redisCache.client.Subscribe(ctx, channel)
	// Ensure subscription is established
	if _, err := pubsub.Receive(ctx); err != nil {
		pubsub.Close()
		log.Printf("Pubsub channel closed: %s", channel)
		return err
	}

	ch := pubsub.Channel()

	go func() {
		defer pubsub.Close()

		for {
			select {
			case <-ctx.Done():
				return
			case msg, ok := <-ch:
				if !ok {
					return
				}
				handler([]byte(msg.Payload))
			}
		}
	}()

	return nil
}

// Helper functions to generate Redis keys with hash tags for cluster compatibility
func buildPageKey(pageKey string) string {
	return "page:{" + pageKey + "}"
}

func buildPageDataKey(pageKey string) string {
	return "page:{" + pageKey + "}:data"
}

func buildPageCompleteKey(pageKey string) string {
	return "page:{" + pageKey + "}:complete"
}

const cacheTTL = 10 * time.Minute

// Design Choice: Split Index/Data Pattern
// We use two Redis structures to store page strokes efficiently:
// 1. ZSet ("page:{key}"): Stores only StrokeIDs, ordered by Timestamp (Score).
//   - Purpose: Maintains chronological order and allows O(1) removal by ID (ZREM).
//   - Why? If we stored the full JSON blob here, we couldn't efficiently delete a stroke by its ID
//     without knowing the full JSON content or scanning the set.
//
// 2. Hash ("page:{key}:data"): Stores StrokeID -> JSON Blob.
//   - Purpose: fast O(1) data retrieval (HMGET) after getting IDs from the ZSet.
func (redisCache *RedisWebverseCache) AddStroke(ctx context.Context, pageKey string, strokeId string, score int64, strokeData []byte) error {
	key := buildPageKey(pageKey)
	dataKey := buildPageDataKey(pageKey)
	completeKey := buildPageCompleteKey(pageKey)

	pipe := redisCache.client.Pipeline()
	pipe.ZAdd(ctx, key, redis.Z{Score: float64(score), Member: strokeId})
	pipe.HSet(ctx, dataKey, strokeId, strokeData)
	pipe.Expire(ctx, completeKey, cacheTTL)
	pipe.Expire(ctx, key, cacheTTL)
	pipe.Expire(ctx, dataKey, cacheTTL)
	_, err := pipe.Exec(ctx)
	return err
}

func (redisCache *RedisWebverseCache) AddStrokesBatch(ctx context.Context, pageKey string, strokes []cache.StrokeCacheItem) error {
	if len(strokes) == 0 {
		return nil
	}

	key := buildPageKey(pageKey)
	dataKey := buildPageDataKey(pageKey)
	completeKey := buildPageCompleteKey(pageKey)

	zMembers := make([]redis.Z, len(strokes))
	// HSet accepts a map[string]interface{} or alternating key/values
	// A flat list of key, value, key, value... is usually most efficient for HSet in go-redis
	hValues := make([]interface{}, len(strokes)*2)

	for i, s := range strokes {
		zMembers[i] = redis.Z{
			Score:  float64(s.Score),
			Member: s.StrokeId,
		}
		hValues[i*2] = s.StrokeId
		hValues[i*2+1] = s.Data
	}

	pipe := redisCache.client.Pipeline()
	pipe.ZAdd(ctx, key, zMembers...)
	pipe.HSet(ctx, dataKey, hValues...)
	pipe.Expire(ctx, completeKey, cacheTTL)
	pipe.Expire(ctx, key, cacheTTL)
	pipe.Expire(ctx, dataKey, cacheTTL)
	_, err := pipe.Exec(ctx)
	return err
}

func (redisCache *RedisWebverseCache) RemoveStroke(ctx context.Context, pageKey string, strokeId string) error {
	key := buildPageKey(pageKey)
	dataKey := buildPageDataKey(pageKey)
	completeKey := buildPageCompleteKey(pageKey)

	pipe := redisCache.client.Pipeline()
	pipe.ZRem(ctx, key, strokeId)
	pipe.HDel(ctx, dataKey, strokeId)
	pipe.Expire(ctx, completeKey, cacheTTL)
	pipe.Expire(ctx, key, cacheTTL)
	pipe.Expire(ctx, dataKey, cacheTTL)
	_, err := pipe.Exec(ctx)
	return err
}

// GetPageStrokeCountFromZCard returns the number of strokes on a page using ZCard
// This is the source of truth for page stroke counts (replaces separate counter)
func (redisCache *RedisWebverseCache) GetPageStrokeCountFromZCard(ctx context.Context, pageKey string) (int64, error) {
	key := buildPageKey(pageKey)
	count, err := redisCache.client.ZCard(ctx, key).Result()
	if err != nil {
		return 0, err
	}
	return count, nil
}

func (redisCache *RedisWebverseCache) GetStrokes(ctx context.Context, pageKey string) ([][]byte, error) {
	key := buildPageKey(pageKey)
	dataKey := buildPageDataKey(pageKey)
	completeKey := buildPageCompleteKey(pageKey)

	// 1. Get last 1000 IDs from ZSet ordered by score
	ids, err := redisCache.client.ZRange(ctx, key, -1000, -1).Result()
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return [][]byte{}, nil
	}

	// 2. Fetch data from Hash
	// HMGet returns interface{}, need to cast
	dataMap, err := redisCache.client.HMGet(ctx, dataKey, ids...).Result()
	if err != nil {
		return nil, err
	}

	// 3. Assemble result
	strokes := make([][]byte, 0, len(ids))
	for _, item := range dataMap {
		if item == nil {
			continue // Should not happen if consistency is maintained
		}
		if s, ok := item.(string); ok {
			strokes = append(strokes, []byte(s))
		}
	}

	// Refresh TTL
	pipe := redisCache.client.Pipeline()
	pipe.Expire(ctx, completeKey, cacheTTL)
	pipe.Expire(ctx, key, cacheTTL)
	pipe.Expire(ctx, dataKey, cacheTTL)
	_, _ = pipe.Exec(ctx)

	return strokes, nil
}

func (redisCache *RedisWebverseCache) SetPageComplete(ctx context.Context, pageKey string) error {
	completeKey := buildPageCompleteKey(pageKey)
	return redisCache.client.Set(ctx, completeKey, "true", cacheTTL).Err()
}

func (redisCache *RedisWebverseCache) IsPageComplete(ctx context.Context, pageKey string) (bool, error) {
	completeKey := buildPageCompleteKey(pageKey)
	val, err := redisCache.client.Exists(ctx, completeKey).Result()
	if err != nil {
		return false, err
	}
	return val > 0, nil
}

func (redisCache *RedisWebverseCache) InvalidatePages(ctx context.Context, pageKeys []string) error {
	if len(pageKeys) == 0 {
		return nil
	}

	// In Redis Cluster, keys with different hash tags hash to different slots.
	// We must delete each page separately, but we can pipeline the 3 keys within each page.
	for _, pageKey := range pageKeys {
		key := buildPageKey(pageKey)
		dataKey := buildPageDataKey(pageKey)
		completeKey := buildPageCompleteKey(pageKey)

		// All 3 keys for this page have the same hash tag, so they hash to the same slot
		if err := redisCache.client.Del(ctx, key, dataKey, completeKey).Err(); err != nil {
			return err
		}
	}

	return nil
}

// User Stroke Count
func (redisCache *RedisWebverseCache) IncrementUserStrokeCount(ctx context.Context, userId string) (int64, error) {
	key := "user:" + userId + ":stroke_count"
	count, err := redisCache.client.Incr(ctx, key).Result()
	if err != nil {
		return 0, err
	}
	redisCache.client.Expire(ctx, key, cacheTTL)
	return count, nil
}

func (redisCache *RedisWebverseCache) DecrementUserStrokeCount(ctx context.Context, userId string) error {
	key := "user:" + userId + ":stroke_count"
	err := redisCache.client.Decr(ctx, key).Err()
	if err != nil {
		return err
	}
	redisCache.client.Expire(ctx, key, cacheTTL)
	return nil
}

func (redisCache *RedisWebverseCache) SeedUserStrokeCount(ctx context.Context, userId string, count int) error {
	key := "user:" + userId + ":stroke_count"
	return redisCache.client.SetNX(ctx, key, count, cacheTTL).Err()
}

func (redisCache *RedisWebverseCache) GetUserStrokeCount(ctx context.Context, userId string) (int, error) {
	key := "user:" + userId + ":stroke_count"
	val, err := redisCache.client.Get(ctx, key).Int()
	if err != nil {
		if err == redis.Nil {
			return -1, nil // Not found
		}
		return 0, err
	}
	return val, nil
}
