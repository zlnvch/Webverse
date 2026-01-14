#!/bin/sh

QUEUE_NAME="DeleteUserStrokesQueue"

echo "Waiting for ElasticMQ to start..."
until curl -s $SQS_ENDPOINT >/dev/null; do
  sleep 1
done

echo "Creating SQS queue '$QUEUE_NAME'..."

aws sqs create-queue \
    --endpoint-url "$SQS_ENDPOINT" \
    --queue-name "$QUEUE_NAME" \
    || echo "Queue '$QUEUE_NAME' already exists or failed to create"

echo "SQS initialization done."
