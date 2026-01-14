#!/bin/sh

TABLE_NAME="Webverse"

# Wait until DynamoDB Local is ready
echo "Waiting for DynamoDB to start..."
until curl -s http://dynamodb:8000; do
  sleep 1
done

echo "Creating table '$TABLE_NAME'..."
aws dynamodb create-table \
    --endpoint-url $DYNAMODB_ENDPOINT \
    --table-name $TABLE_NAME \
    --attribute-definitions AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S AttributeName=UserId,AttributeType=S AttributeName=Layer,AttributeType=S \
    --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
    --global-secondary-indexes '[ { "IndexName": "GSI_UserStrokes", "KeySchema": [ { "AttributeName": "UserId", "KeyType": "HASH" }, { "AttributeName": "Layer", "KeyType": "RANGE" } ], "Projection": { "ProjectionType": "KEYS_ONLY" } } ]' \
    --billing-mode PAY_PER_REQUEST \
    || echo "Error creating table '$TABLE_NAME'"

echo "DynamoDB initialization done."