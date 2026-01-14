package dynamo

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/gofrs/uuid/v5"

	"github.com/zlnvch/webverse/models"
)

type DynamoWebverseStore struct {
	client    *dynamodb.Client
	tableName string
}

func NewDynamoWebverseStore(ctx context.Context, devMode bool, dynamodbEndpoint string, tableName string) (*DynamoWebverseStore, error) {
	client, err := newDynamoDBClient(context.Background(), devMode, dynamodbEndpoint)
	if err != nil {
		return nil, err
	}

	tables, err := getTables(client, ctx)
	if err != nil {
		return nil, err
	}

	foundTable := false
	for _, table := range tables {
		if table == tableName {
			foundTable = true
			break
		}
	}
	if !foundTable {
		return nil, fmt.Errorf("given table name '%s' not found in dynamodb", tableName)
	}

	return &DynamoWebverseStore{client: client, tableName: tableName}, nil
}

func (dynamoStore *DynamoWebverseStore) CreateUser(ctx context.Context, user models.User) (models.User, error) {
	userId, err := uuid.NewV4()
	if err != nil {
		return models.User{}, err
	}
	user.Id = userId.String()

	du := userToDynamo(user)
	du.Created = time.Now().Unix()
	du, _, err = ensureItem(dynamoStore, ctx, du)
	if err != nil {
		return models.User{}, err
	}

	user = userFromDynamo(du)
	return user, nil
}

func (dynamoStore *DynamoWebverseStore) GetUser(ctx context.Context, provider string, providerId string) (models.User, error) {
	du, err := getItem[dynamoUser](dynamoStore, ctx, "USER#"+provider+"#"+providerId, "PROFILE", false)
	if err != nil {
		return models.User{}, err
	}

	user := userFromDynamo(du)
	return user, nil
}

func (dynamoStore *DynamoWebverseStore) GetStrokeRecords(ctx context.Context, pageKey string) ([]models.Stroke, error) {
	// Fetch newest 1100 strokes (ScanIndexForward: false)
	// There should be only 1000 or a little more, but just to be safe, we will enforce 1100 limit here
	dynamoStrokes, err := queryAllByPK[dynamoStroke](dynamoStore, ctx, "STROKE#"+pageKey, false, 1100)
	if err != nil {
		return []models.Stroke{}, err
	}

	// Reverse them to return chronological order (Oldest -> Newest)
	strokes := make([]models.Stroke, 0, len(dynamoStrokes))
	for i := len(dynamoStrokes) - 1; i >= 0; i-- {
		strokes = append(strokes, strokeFromDynamo(dynamoStrokes[i]))
	}

	return strokes, nil
}

func (dynamoStore *DynamoWebverseStore) WriteStrokeBatch(ctx context.Context, strokes []models.StrokeRecord) ([]models.StrokeRecord, error) {
	// Convert strokes to Dynamo structs and then to WriteRequests
	var writeRequests []types.WriteRequest
	for _, stroke := range strokes {
		dynamoStroke := strokeRecordToDynamo(stroke)
		avMap, err := attributevalue.MarshalMap(dynamoStroke)
		if err != nil {
			return nil, fmt.Errorf("marshal error: %w", err)
		}

		writeRequests = append(writeRequests, types.WriteRequest{
			PutRequest: &types.PutRequest{
				Item: avMap,
			},
		})
	}

	// Use the generic writeBatchRequests function
	unprocessed, err := writeBatchRequests[dynamoStroke](dynamoStore, ctx, writeRequests)

	// Convert unprocessed Dynamo items back to models.StrokeRecord
	unbatchedStrokes := make([]models.StrokeRecord, 0, len(unprocessed))
	for _, u := range unprocessed {
		unbatchedStrokes = append(unbatchedStrokes, strokeRecordFromDynamo(u))
	}

	return unbatchedStrokes, err
}

func (dynamoStore *DynamoWebverseStore) DeleteStroke(ctx context.Context, pageKey string, strokeId string, userId string) error {
	return deleteItemWithCondition(dynamoStore, ctx, "STROKE#"+pageKey, strokeId, "UserId", userId)
}

func (dynamoStore *DynamoWebverseStore) DeleteUser(ctx context.Context, provider string, providerId string) error {
	return deleteItemWithCondition(dynamoStore, ctx, "USER#"+provider+"#"+providerId, "PROFILE", "", "")
}

func (dynamoStore *DynamoWebverseStore) DeleteUserStrokes(ctx context.Context, userId string, layer string) error {
	return batchDeleteByGSIThrottled(dynamoStore, ctx, "GSI_UserStrokes", "UserId", "Layer", userId, layer, time.Duration(50*time.Millisecond))
}

func (dynamoStore *DynamoWebverseStore) GetUserPages(ctx context.Context, userId string) ([]string, error) {
	results, err := queryAllByGSI(dynamoStore, ctx, "GSI_UserStrokes", "UserId", userId)
	if err != nil {
		return nil, err
	}

	uniquePages := make(map[string]struct{})
	for _, pk := range results {
		// PK format is STROKE#<PageKey>
		if len(pk) > 7 && pk[:7] == "STROKE#" {
			pageKey := pk[7:]
			uniquePages[pageKey] = struct{}{}
		}
	}

	pages := make([]string, 0, len(uniquePages))
	for p := range uniquePages {
		pages = append(pages, p)
	}

	return pages, nil
}

func (dynamoStore *DynamoWebverseStore) GetUserStrokeCount(ctx context.Context, userId string, layer string) (int, error) {
	if layer == "" {
		// Count all strokes across all layers (no sort key condition)
		return countByGSI(dynamoStore, ctx, "GSI_UserStrokes", "UserId", userId, "", "")
	}

	// Count strokes for specific layer using sort key condition
	return countByGSI(dynamoStore, ctx, "GSI_UserStrokes", "UserId", userId, "Layer", layer)
}

func (dynamoStore *DynamoWebverseStore) SetUserEncryptionKeys(ctx context.Context, user models.User, incrementKeyVersion bool) (int, error) {
	du := userToDynamo(user)
	du, err := updateItem(dynamoStore, ctx, du, []string{"SaltKEK", "EncryptedDEK1", "NonceDEK1", "EncryptedDEK2", "NonceDEK2"}, "KeyVersion", incrementKeyVersion)
	return du.KeyVersion, err
}

func (dynamoStore *DynamoWebverseStore) IncrementUserStrokeCount(ctx context.Context, provider string, providerId string, count int) error {
	// Strict mode: only increment if user exists (prevents partial records after delete)
	return incrementCounter(dynamoStore, ctx, "USER#"+provider+"#"+providerId, "PROFILE", "StrokeCount", count, false)
}
