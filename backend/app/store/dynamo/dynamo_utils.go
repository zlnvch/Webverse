package dynamo

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/zlnvch/webverse/store"
)

func newDynamoDBClient(ctx context.Context, devMode bool, dynamodbEndpoint string) (*dynamodb.Client, error) {
	var cfg aws.Config
	var err error

	if devMode {
		// Load config with dummy credentials and region for local/dev
		cfg, err = config.LoadDefaultConfig(ctx,
			config.WithRegion("us-east-1"),
			config.WithCredentialsProvider(
				credentials.NewStaticCredentialsProvider("dummy", "dummy", ""),
			),
		)
		if err != nil {
			return nil, err
		}

		// Override endpoint for DynamoDB locally
		return dynamodb.New(dynamodb.Options{
			Credentials:      cfg.Credentials,
			Region:           cfg.Region,
			EndpointResolver: dynamodb.EndpointResolverFromURL(dynamodbEndpoint),
		}), nil
	}

	// Production/Fargate: default config (uses Task Role and AWS endpoints)
	cfg, err = config.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, err
	}

	return dynamodb.NewFromConfig(cfg), nil
}

func getTables(client *dynamodb.Client, ctx context.Context) ([]string, error) {
	output, err := client.ListTables(ctx, &dynamodb.ListTablesInput{})
	if err != nil {
		return nil, err
	}

	return output.TableNames, nil
}

// getItem retrieves an item of type T from DynamoDB by PK and SK
func getItem[T any](dynamoStore *DynamoWebverseStore, ctx context.Context, pk string, sk string, consistentRead bool) (T, error) {
	var zero T

	// Build the key
	key := map[string]types.AttributeValue{
		"PK": &types.AttributeValueMemberS{Value: pk},
		"SK": &types.AttributeValueMemberS{Value: sk},
	}

	// Get the item
	resp, err := dynamoStore.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:      aws.String(dynamoStore.tableName),
		Key:            key,
		ConsistentRead: aws.Bool(consistentRead),
	})
	if err != nil {
		return zero, fmt.Errorf("GetItem failed: %w", err)
	}
	if resp.Item == nil {
		return zero, store.ErrItemNotFound
	}

	// Unmarshal into T
	var item T
	if err := attributevalue.UnmarshalMap(resp.Item, &item); err != nil {
		return zero, fmt.Errorf("failed to unmarshal item: %w", err)
	}

	return item, nil
}

// Generic function to ensure any struct with PK and SK exists
func ensureItem[T any](dynamoStore *DynamoWebverseStore, ctx context.Context, item T) (T, bool, error) {
	// Marshal struct to DynamoDB map
	avMap, err := attributevalue.MarshalMap(item)
	if err != nil {
		var zero T
		return zero, false, fmt.Errorf("marshal error: %w", err)
	}

	// Check that PK and SK exist in the struct
	if _, ok := avMap["PK"]; !ok {
		var zero T
		return zero, false, errors.New("struct missing PK field")
	}
	if _, ok := avMap["SK"]; !ok {
		var zero T
		return zero, false, errors.New("struct missing SK field")
	}

	// Conditional PutItem: insert only if PK+SK does not exist
	_, err = dynamoStore.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName:           aws.String(dynamoStore.tableName),
		Item:                avMap,
		ConditionExpression: aws.String("attribute_not_exists(PK)"),
	})

	if err != nil {
		var cce *types.ConditionalCheckFailedException
		if errors.As(err, &cce) {
			// Already exists: fetch it
			key := map[string]types.AttributeValue{
				"PK": avMap["PK"],
				"SK": avMap["SK"],
			}
			getResp, err := dynamoStore.client.GetItem(ctx, &dynamodb.GetItemInput{
				TableName: aws.String(dynamoStore.tableName),
				Key:       key,
			})
			if err != nil {
				var zero T
				return zero, false, fmt.Errorf("failed to get existing item: %w", err)
			}
			if getResp.Item == nil {
				var zero T
				return zero, false, errors.New("item supposedly exists but GetItem returned nothing")
			}

			var existing T
			if err := attributevalue.UnmarshalMap(getResp.Item, &existing); err != nil {
				var zero T
				return zero, false, fmt.Errorf("failed to unmarshal existing item: %w", err)
			}
			return existing, false, nil
		}
		var zero T
		return zero, false, fmt.Errorf("failed to put item: %w", err)
	}

	return item, true, nil // Newly inserted
}

// queryAllByPK returns all items of type T with the given PK, ordered by SK, with a limit.
func queryAllByPK[T any](dynamoStore *DynamoWebverseStore, ctx context.Context, pk string, scanIndexForward bool, limit int32) ([]T, error) {
	var results []T

	input := &dynamodb.QueryInput{
		TableName:              aws.String(dynamoStore.tableName),
		KeyConditionExpression: aws.String("PK = :pk"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk": &types.AttributeValueMemberS{Value: pk},
		},
		ScanIndexForward: aws.Bool(scanIndexForward),
	}

	if limit > 0 {
		input.Limit = aws.Int32(limit)
	}

	// Use pagination to retrieve all items
	// dynamodb uses limit per page, so we also need to handle limit globally
	paginator := dynamodb.NewQueryPaginator(dynamoStore.client, input)

	for paginator.HasMorePages() {
		if limit > 0 && len(results) >= int(limit) {
			break
		}

		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("query failed: %w", err)
		}

		var pageItems []T
		if err := attributevalue.UnmarshalListOfMaps(page.Items, &pageItems); err != nil {
			return nil, fmt.Errorf("failed to unmarshal page items: %w", err)
		}

		results = append(results, pageItems...)
	}

	if limit > 0 && len(results) > int(limit) {
		results = results[:limit]
	}

	return results, nil
}

// queryAllByGSI returns the main table PK strings for all items in a GSI with the given PK.
func queryAllByGSI(dynamoStore *DynamoWebverseStore, ctx context.Context, indexName string, pkField string, pkValue string) ([]string, error) {
	var results []string

	input := &dynamodb.QueryInput{
		TableName:              aws.String(dynamoStore.tableName),
		IndexName:              aws.String(indexName),
		KeyConditionExpression: aws.String("#pk = :pk"),
		ExpressionAttributeNames: map[string]string{
			"#pk": pkField,
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk": &types.AttributeValueMemberS{Value: pkValue},
		},
		ProjectionExpression: aws.String("PK"), // Only fetch the PK from the main table
	}

	// Use pagination to retrieve all items
	paginator := dynamodb.NewQueryPaginator(dynamoStore.client, input)

	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("query GSI failed: %w", err)
		}

		for _, item := range page.Items {
			if pkAttr, ok := item["PK"]; ok {
				if pk, ok := pkAttr.(*types.AttributeValueMemberS); ok {
					results = append(results, pk.Value)
				}
			}
		}
	}

	return results, nil
}

// countByGSI counts items matching a GSI query without fetching them
// If sortKeyValue is empty, counts all items for the partition key
// If sortKeyValue is provided, counts only items matching the sort key
func countByGSI(dynamoStore *DynamoWebverseStore, ctx context.Context, indexName string, pkField string, pkValue string, sortKeyField string, sortKeyValue string) (int, error) {
	keyConditionExpr := "#pk = :pk"
	exprAttrNames := map[string]string{
		"#pk": pkField,
	}
	exprAttrValues := map[string]types.AttributeValue{
		":pk": &types.AttributeValueMemberS{Value: pkValue},
	}

	// Add sort key condition if provided
	if sortKeyField != "" && sortKeyValue != "" {
		keyConditionExpr += " AND #sk = :sk"
		exprAttrNames["#sk"] = sortKeyField
		exprAttrValues[":sk"] = &types.AttributeValueMemberS{Value: sortKeyValue}
	}

	input := &dynamodb.QueryInput{
		TableName:              aws.String(dynamoStore.tableName),
		IndexName:              aws.String(indexName),
		Select:                 types.SelectCount, // Only return count, not items
		KeyConditionExpression: aws.String(keyConditionExpr),
		ExpressionAttributeNames: exprAttrNames,
		ExpressionAttributeValues: exprAttrValues,
	}

	// Use pagination to count all items
	var totalCount int32
	paginator := dynamodb.NewQueryPaginator(dynamoStore.client, input)

	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return 0, fmt.Errorf("count GSI failed: %w", err)
		}
		totalCount += page.Count
	}

	return int(totalCount), nil
}

// writeBatchRequests handles batch writes (Put or Delete) with retries
// Returns any unprocessed items as []T
func writeBatchRequests[T any](dynamoStore *DynamoWebverseStore, ctx context.Context, requests []types.WriteRequest) ([]T, error) {
	if len(requests) == 0 {
		return nil, nil
	}

	backoff := 50 * time.Millisecond

	for {
		select {
		case <-ctx.Done():
			return unmarshalUnprocessed[T](requests), ctx.Err()
		default:
		}

		resp, err := dynamoStore.client.BatchWriteItem(ctx, &dynamodb.BatchWriteItemInput{
			RequestItems: map[string][]types.WriteRequest{
				dynamoStore.tableName: requests,
			},
		})
		if err != nil {
			return unmarshalUnprocessed[T](requests), fmt.Errorf("BatchWriteItem failed: %w", err)
		}

		unprocessed := resp.UnprocessedItems[dynamoStore.tableName]
		if len(unprocessed) == 0 {
			return nil, nil // all items processed successfully
		}

		// Prepare next retry set
		requests = unprocessed

		timer := time.NewTimer(backoff)
		select {
		case <-ctx.Done():
			timer.Stop()
			return unmarshalUnprocessed[T](requests), ctx.Err()
		case <-timer.C:
		}

		if backoff < time.Second {
			backoff *= 2
		}
	}
}

// helper to convert WriteRequests back to []T
func unmarshalUnprocessed[T any](reqs []types.WriteRequest) []T {
	failed := make([]T, 0, len(reqs))
	for _, wr := range reqs {
		if wr.PutRequest != nil {
			var item T
			if err := attributevalue.UnmarshalMap(wr.PutRequest.Item, &item); err == nil {
				failed = append(failed, item)
			}
		} else if wr.DeleteRequest != nil {
			// For deletes, just populate a minimal struct with PK/SK
			var item T
			if err := attributevalue.UnmarshalMap(wr.DeleteRequest.Key, &item); err == nil {
				failed = append(failed, item)
			}
		}
	}
	return failed
}

// deleteItemWithCondition deletes an item by PK and SK, only if a specified field equals a given value.
// Returns an error if the item does not exist, the condition is not met, or other DB issues occur.
func deleteItemWithCondition(dynamoStore *DynamoWebverseStore, ctx context.Context, pk string, sk string, conditionField string, expectedValue string) error {
	// Build the key
	key := map[string]types.AttributeValue{
		"PK": &types.AttributeValueMemberS{Value: pk},
		"SK": &types.AttributeValueMemberS{Value: sk},
	}

	// Prepare DeleteItemInput
	input := &dynamodb.DeleteItemInput{
		TableName: aws.String(dynamoStore.tableName),
		Key:       key,
	}

	// Only set ConditionExpression if a field is specified
	if conditionField != "" {
		input.ConditionExpression = aws.String(fmt.Sprintf("%s = :val", conditionField))
		input.ExpressionAttributeValues = map[string]types.AttributeValue{
			":val": &types.AttributeValueMemberS{Value: expectedValue},
		}
	}

	_, err := dynamoStore.client.DeleteItem(ctx, input)

	if err != nil {
		// Check if it's a conditional check failure
		var cce *types.ConditionalCheckFailedException
		if errors.As(err, &cce) {
			// Could be because the item doesn't exist or condition not met
			// Try a GetItem to see if the item exists
			getResp, getErr := dynamoStore.client.GetItem(ctx, &dynamodb.GetItemInput{
				TableName: aws.String(dynamoStore.tableName),
				Key:       key,
			})
			if getErr != nil {
				return fmt.Errorf("delete failed, and GetItem check also failed: %w", getErr)
			}
			if getResp.Item == nil {
				return store.ErrItemNotFound
			}
			return store.ErrConditionFailed
		}
		return fmt.Errorf("delete failed: %w", err)
	}

	return nil
}

// batchDeleteByGSIThrottled queries items by GSI and deletes them in batches until none remain.
// Query pages are larger for efficiency, but deletion is done in 25-item batches with throttling.
func batchDeleteByGSIThrottled(
	dynamoStore *DynamoWebverseStore,
	ctx context.Context,
	indexName, gsiPKField, gsiSKField, gsiPK, gsiSK string,
	throttle time.Duration,
) error {
	var lastEvaluatedKey map[string]types.AttributeValue

	const queryPageSize int32 = 200

	for {
		// Build KeyConditionExpression safely (handles reserved words like "Layer")
		keyCond := "#pk = :gsiPK"

		exprAttrNames := map[string]string{
			"#pk": gsiPKField,
		}

		exprAttrValues := map[string]types.AttributeValue{
			":gsiPK": &types.AttributeValueMemberS{Value: gsiPK},
		}

		if gsiSK != "" {
			keyCond += " AND #sk = :gsiSK"
			exprAttrNames["#sk"] = gsiSKField
			exprAttrValues[":gsiSK"] = &types.AttributeValueMemberS{Value: gsiSK}
		}

		// Query a page
		input := &dynamodb.QueryInput{
			TableName:                 aws.String(dynamoStore.tableName),
			IndexName:                 aws.String(indexName),
			KeyConditionExpression:    aws.String(keyCond),
			ExpressionAttributeNames:  exprAttrNames,
			ExpressionAttributeValues: exprAttrValues,
			Limit:                     aws.Int32(queryPageSize),
			ExclusiveStartKey:         lastEvaluatedKey,
		}

		resp, err := dynamoStore.client.Query(ctx, input)
		if err != nil {
			return fmt.Errorf("query GSI failed: %w", err)
		}

		if len(resp.Items) == 0 {
			return nil
		}

		// Prepare DeleteRequests
		delRequests := make([]types.WriteRequest, 0, len(resp.Items))
		for _, item := range resp.Items {
			pkAttr, okPK := item["PK"]
			skAttr, okSK := item["SK"]
			if !okPK || !okSK {
				continue
			}
			delRequests = append(delRequests, types.WriteRequest{
				DeleteRequest: &types.DeleteRequest{
					Key: map[string]types.AttributeValue{
						"PK": pkAttr,
						"SK": skAttr,
					},
				},
			})
		}

		if len(delRequests) == 0 {
			return fmt.Errorf("query returned items without PK/SK")
		}

		// Batch delete in chunks of 25 with throttling
		for i := 0; i < len(delRequests); i += 25 {
			end := i + 25
			if end > len(delRequests) {
				end = len(delRequests)
			}

			startTime := time.Now()

			_, err := writeBatchRequests[map[string]types.AttributeValue](
				dynamoStore,
				ctx,
				delRequests[i:end],
			)
			if err != nil {
				return fmt.Errorf("batch delete failed: %w", err)
			}

			// Throttle between batches
			elapsed := time.Since(startTime)
			if elapsed < throttle {
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-time.After(throttle - elapsed):
				}
			}
		}

		// Prepare for next page
		lastEvaluatedKey = resp.LastEvaluatedKey
		if lastEvaluatedKey == nil {
			break
		}
	}

	return nil
}

// updateItem updates an existing item in DynamoDB.
// Only fields listed in fieldsToUpdate are updated.
// The "incrementField" is only incremented if "increment" is true.
// Returns an error if the item does not exist.
func updateItem[T any](
	dynamoStore *DynamoWebverseStore,
	ctx context.Context,
	item T,
	fieldsToUpdate []string,
	incrementField string,
	increment bool,
) (T, error) {
	var zero T

	// Marshal the item into a DynamoDB map
	avMap, err := attributevalue.MarshalMap(item)
	if err != nil {
		return zero, fmt.Errorf("marshal error: %w", err)
	}

	// Extract PK and SK
	pkAttr, ok := avMap["PK"]
	if !ok {
		return zero, errors.New("struct missing PK field")
	}
	skAttr, ok := avMap["SK"]
	if !ok {
		return zero, errors.New("struct missing SK field")
	}

	// Build a lookup for allowed update fields
	updateSet := make(map[string]struct{}, len(fieldsToUpdate))
	for _, f := range fieldsToUpdate {
		updateSet[f] = struct{}{}
	}

	updateExpr := "SET "
	exprAttrValues := make(map[string]types.AttributeValue)
	exprAttrNames := make(map[string]string)
	first := true

	// Add only explicitly requested fields
	for field := range updateSet {
		// Never update keys
		if field == "PK" || field == "SK" {
			continue
		}

		val, ok := avMap[field]
		if !ok {
			continue // field not present on struct
		}

		if !first {
			updateExpr += ", "
		}
		first = false

		updateExpr += fmt.Sprintf("#%s = :%s", field, field)
		exprAttrNames["#"+field] = field
		exprAttrValues[":"+field] = val
	}

	// Add conditional increment if needed
	if increment && incrementField != "" {
		if !first {
			updateExpr += ", "
		}

		updateExpr += fmt.Sprintf(
			"#%s = if_not_exists(#%s, :zero) + :inc",
			incrementField,
			incrementField,
		)

		exprAttrNames["#"+incrementField] = incrementField
		exprAttrValues[":inc"] = &types.AttributeValueMemberN{Value: "1"}
		exprAttrValues[":zero"] = &types.AttributeValueMemberN{Value: "0"}
	}

	// Key
	key := map[string]types.AttributeValue{
		"PK": pkAttr,
		"SK": skAttr,
	}

	// Perform the update with a condition that the item exists
	out, err := dynamoStore.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:                 aws.String(dynamoStore.tableName),
		Key:                       key,
		UpdateExpression:          aws.String(updateExpr),
		ExpressionAttributeNames:  exprAttrNames,
		ExpressionAttributeValues: exprAttrValues,
		ConditionExpression:       aws.String("attribute_exists(PK) AND attribute_exists(SK)"),
		ReturnValues:              types.ReturnValueAllNew,
	})
	if err != nil {
		var cce *types.ConditionalCheckFailedException
		if errors.As(err, &cce) {
			return zero, store.ErrItemNotFound
		}
		return zero, fmt.Errorf("update failed: %w", err)
	}

	// Unmarshal the updated item
	var updated T
	if err := attributevalue.UnmarshalMap(out.Attributes, &updated); err != nil {
		return zero, fmt.Errorf("failed to unmarshal updated item: %w", err)
	}

	return updated, nil
}

// incrementCounter atomically increments a numeric field.
// If createIfNotExists is true, creates the item/field with initial value if it doesn't exist (for pages).
// If createIfNotExists is false, returns error if item doesn't exist (for users - prevents partial records).
func incrementCounter(
	dynamoStore *DynamoWebverseStore,
	ctx context.Context,
	pk string,
	sk string,
	counterField string,
	count int,
	createIfNotExists bool,
) error {
	key := map[string]types.AttributeValue{
		"PK": &types.AttributeValueMemberS{Value: pk},
		"SK": &types.AttributeValueMemberS{Value: sk},
	}

	var updateExpr string
	exprAttrNames := map[string]string{
		"#c": counterField,
	}
	exprAttrValues := map[string]types.AttributeValue{
		":val": &types.AttributeValueMemberN{Value: strconv.Itoa(count)},
	}
	var conditionExpr *string

	if createIfNotExists {
		// For pages: create item/field if doesn't exist
		updateExpr = "SET #c = if_not_exists(#c, :zero) + :val"
		exprAttrValues[":zero"] = &types.AttributeValueMemberN{Value: "0"}
		// No condition - allows creating new items
	} else {
		// For users: only increment if item exists (prevents partial records)
		updateExpr = "SET #c = #c + :val"
		conditionExpr = aws.String("attribute_exists(PK)")
	}

	_, err := dynamoStore.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:                 aws.String(dynamoStore.tableName),
		Key:                       key,
		UpdateExpression:          aws.String(updateExpr),
		ExpressionAttributeNames:  exprAttrNames,
		ExpressionAttributeValues: exprAttrValues,
		ConditionExpression:       conditionExpr,
	})

	if err != nil {
		var cce *types.ConditionalCheckFailedException
		if errors.As(err, &cce) {
			return fmt.Errorf("item does not exist: PK=%s, SK=%s, field=%s", pk, sk, counterField)
		}
		return fmt.Errorf("increment counter failed: %w", err)
	}

	return nil
}
