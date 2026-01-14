package sqsmq

import (
	"context"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/zlnvch/webverse/mq"
)

type SQSMessageQueue struct {
	client   *sqs.Client
	queueURL string
}

func NewSQSMessageQueue(ctx context.Context, devMode bool, sqsEndpoint string, queueName string) (*SQSMessageQueue, error) {
	client, err := newSQSClient(context.Background(), devMode, sqsEndpoint)
	if err != nil {
		return nil, err
	}

	queues, err := getQueues(client, ctx)
	if err != nil {
		return nil, err
	}

	var queueURL string
	foundQueue := false
	for _, q := range queues {
		if strings.HasSuffix(q, "/"+queueName) {
			foundQueue = true
			queueURL = q
			break
		}
	}
	if !foundQueue {
		return nil, fmt.Errorf("given queue name '%s' not found in SQS", queueName)
	}

	return &SQSMessageQueue{client, queueURL}, nil
}

func (sqsmq *SQSMessageQueue) Send(ctx context.Context, body string) error {
	return sendMessage(sqsmq, ctx, body)
}

func (sqsmq *SQSMessageQueue) Receive(ctx context.Context, visibilityTimeout int32) (*mq.Message, error) {
	return receiveMessage(sqsmq, ctx, visibilityTimeout)
}

func (sqsmq *SQSMessageQueue) Delete(ctx context.Context, msg *mq.Message) error {
	return deleteMessage(sqsmq, ctx, msg)
}
