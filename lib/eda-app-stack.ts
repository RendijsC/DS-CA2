import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as events from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";

import * as dynamodb from "aws-cdk-lib/aws-dynamodb";

import { StreamViewType } from "aws-cdk-lib/aws-dynamodb";
import {  DynamoEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { StartingPosition } from "aws-cdk-lib/aws-lambda";

import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class EDAAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const imagesBucket = new s3.Bucket(this, "images", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
    });

    // DynamoDB Table
    const imageTable = new dynamodb.Table(this, "ImageTable", {
      partitionKey: { name: "imageName", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, 
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      tableName: "Images",
      stream: dynamodb.StreamViewType.NEW_IMAGE
    });


    // Integration infrastructure

    const deadLetterQueue = new sqs.Queue(this, "dead-letter-q", {
      retentionPeriod: cdk.Duration.minutes(10),
    });

    const imageProcessQueue = new sqs.Queue(this, "img-created-queue", {
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: 1,
      },
      receiveMessageWaitTime: cdk.Duration.seconds(10),
    });

    const mailerQ = new sqs.Queue(this, "mailer-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
    });


    const newImageTopic = new sns.Topic(this, "NewImageTopic", {
      displayName: "New Image topic",
    });

  // Lambda functions

  const processImageFn = new lambdanode.NodejsFunction(
    this,
    "ProcessImageFn",
    {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/processImage.ts`,
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      environment: {
        REGION: "eu-west-1",
        IMAGE_TABLE_NAME: imageTable.tableName,
      }
    }
  );


  // Lambda Function for Updating Table
  const updateTableFn = new lambdanode.NodejsFunction(this, "UpdateTableFn", {
    runtime: lambda.Runtime.NODEJS_18_X,
    entry: `${__dirname}/../lambdas/updateTable.ts`,
    environment: {
      REGION: "eu-west-1",
      TABLE_NAME: imageTable.tableName,
    },
  });

  const rejectionMailerFn = new lambdanode.NodejsFunction(this, "RejectionMailerFn", {
    runtime: lambda.Runtime.NODEJS_16_X,
    memorySize: 1024,
    timeout: cdk.Duration.seconds(5),
    entry: `${__dirname}/../lambdas/rejectionMailer.ts`,
  });

  const mailerFn = new lambdanode.NodejsFunction(this, "mailer-function", {
    runtime: lambda.Runtime.NODEJS_16_X,
    memorySize: 1024,
    timeout: cdk.Duration.seconds(3),
    entry: `${__dirname}/../lambdas/mailer.ts`,
  });

  // S3 --> SQS
  imagesBucket.addEventNotification(
    s3.EventType.OBJECT_CREATED,
    new s3n.SnsDestination(newImageTopic)
);

imagesBucket.addEventNotification(
  s3.EventType.OBJECT_REMOVED,
  new s3n.SnsDestination(newImageTopic)  // Changed
);

newImageTopic.addSubscription(
  new subs.SqsSubscription(imageProcessQueue)
);

newImageTopic.addSubscription(
  new subs.LambdaSubscription(updateTableFn, {
    filterPolicy: {
      metadata_type: sns.SubscriptionFilter.stringFilter({
        allowlist: ["Caption", "Date", "Photographer"],
      }),
    },
  })
);

 // SQS --> Lambda
  const newImageEventSource = new events.SqsEventSource(imageProcessQueue, {
    batchSize: 5,
    maxBatchingWindow: cdk.Duration.seconds(5),
  });

  const dlqEventSource = new events.SqsEventSource(deadLetterQueue, {
    batchSize: 5,
    maxBatchingWindow: cdk.Duration.seconds(5),
  });

  mailerFn.addEventSource(
    new events.DynamoEventSource(imageTable, {
      startingPosition: StartingPosition.LATEST,
      batchSize: 5,
    })
  );

  processImageFn.addEventSource(newImageEventSource);
  newImageTopic.addSubscription(new subs.SqsSubscription(mailerQ));
  rejectionMailerFn.addEventSource(dlqEventSource);
  

  mailerFn.addToRolePolicy(
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "ses:SendEmail",
        "ses:SendRawEmail",
        "ses:SendTemplatedEmail",
      ],
      resources: ["*"],
    })
  );

  rejectionMailerFn.addToRolePolicy(
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "ses:SendEmail", 
        "ses:SendRawEmail", 
        "ses:SendTemplatedEmail"
      ],
      resources: ["*"],
    })
  );

  // Permissions

  imagesBucket.grantRead(processImageFn);
  imageTable.grantWriteData(processImageFn);
  imageTable.grantWriteData(updateTableFn);
  // Output
  
  new cdk.CfnOutput(this, "bucketName", {
    value: imagesBucket.bucketName,
  });

  new cdk.CfnOutput(this, "topicARN", {
    value: newImageTopic.topicArn,
  });


  }
}
