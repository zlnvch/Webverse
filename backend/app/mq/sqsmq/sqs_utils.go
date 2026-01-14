package sqsmq

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/zlnvch/webverse/mq"
)

func newSQSClient(ctx context.Context, devMode bool, sqsEndpoint string) (*sqs.Client, error) {
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

		// Override endpoint for SQS locally
		return sqs.New(sqs.Options{
			Credentials:      cfg.Credentials,
			Region:           cfg.Region,
			EndpointResolver: sqs.EndpointResolverFromURL(sqsEndpoint),
		}), nil
	}

	// Production/Fargate: default config (uses Task Role and AWS endpoints)
	cfg, err = config.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, err
	}

	return sqs.NewFromConfig(cfg), nil
}

func getQueues(client *sqs.Client, ctx context.Context) ([]string, error) {
	output, err := client.ListQueues(ctx, &sqs.ListQueuesInput{})
	if err != nil {
		return nil, err
	}

	// ListQueuesOutput.QueueUrls can be nil if no queues exist
	if output.QueueUrls == nil {
		return []string{}, nil
	}

	return output.QueueUrls, nil
}

func sendMessage(sqsmq *SQSMessageQueue, ctx context.Context, body string) error {
	_, err := sqsmq.client.SendMessage(ctx, &sqs.SendMessageInput{
		QueueUrl:    aws.String(sqsmq.queueURL),
		MessageBody: aws.String(body),
	})
	return err
}

func receiveMessage(sqsmq *SQSMessageQueue, ctx context.Context, visibilityTimeout int32) (*mq.Message, error) {
	resp, err := sqsmq.client.ReceiveMessage(ctx, &sqs.ReceiveMessageInput{
		QueueUrl:            aws.String(sqsmq.queueURL),
		MaxNumberOfMessages: 1,
		WaitTimeSeconds:     20, // long polling
		VisibilityTimeout:   visibilityTimeout,
	})
	if err != nil {
		return nil, err
	}

	if len(resp.Messages) == 0 {
		return nil, nil // no message this poll
	}

	msg := resp.Messages[0]
	return &mq.Message{
		Id:   aws.ToString(msg.ReceiptHandle),
		Body: aws.ToString(msg.Body),
	}, nil
}

func deleteMessage(sqsmq *SQSMessageQueue, ctx context.Context, msg *mq.Message) error {
	_, err := sqsmq.client.DeleteMessage(ctx, &sqs.DeleteMessageInput{
		QueueUrl:      aws.String(sqsmq.queueURL),
		ReceiptHandle: aws.String(msg.Id),
	})
	return err
}
