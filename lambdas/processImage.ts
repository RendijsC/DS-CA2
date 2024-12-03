/* eslint-disable import/extensions, import/no-absolute-path */
import { SQSHandler } from "aws-lambda";
import {
  GetObjectCommand,
  PutObjectCommandInput,
  GetObjectCommandInput,
  S3Client,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { DeleteItemCommand, DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";


const s3 = new S3Client();

//Dynamo DB
const dynamodb = new DynamoDBClient();
const imageTableName = process.env.IMAGE_TABLE_NAME!;

export const handler: SQSHandler = async (event) => {
  console.log("Event ", JSON.stringify(event));
  for (const record of event.Records) {
    const recordBody = JSON.parse(record.body);        // Parse SQS message
    const snsMessage = JSON.parse(recordBody.Message); // Parse SNS message

    if (snsMessage.Records) {
      console.log("Record body ", JSON.stringify(snsMessage));
      for (const messageRecord of snsMessage.Records) {
        const s3e = messageRecord.s3;
        const srcBucket = s3e.bucket.name;
        // Object key may have spaces or unicode non-ASCII characters.
        const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));
        const eventName = messageRecord.eventName;

        if (!srcKey.match(/\.(jpeg|png)$/i)) {
          console.warn(`Unsupported file type: ${srcKey}`);
          throw new Error(`Unsupported file type: ${srcKey}`);
        }

        try {
          if (eventName.startsWith("ObjectCreated")) {
            console.log(`Processing image upload: ${srcKey}`);

            // Download the image from the S3 source bucket
            const params: GetObjectCommandInput = {
              Bucket: srcBucket,
              Key: srcKey,
            };
            
            const dynamoParams = {
              TableName: imageTableName,
              Item: {
                imageName: { S: srcKey },
              },
            };
            await dynamodb.send(new PutItemCommand(dynamoParams));
            console.log(`Saved valid image: ${srcKey} to DynamoDB`);

            
          } else if (eventName.startsWith("ObjectRemoved")) {
            console.log(`Processing image deletion: ${srcKey}`);

            // Delete the image metadata from DynamoDB
            const dynamoParams = {
              TableName: imageTableName,
              Key: {
                imageName: { S: srcKey },
              },
            };
            await dynamodb.send(new DeleteItemCommand(dynamoParams));
            console.log(`Deleted image: ${srcKey} from DynamoDB`);
          }

        } catch (error) {
          console.log(error);
        }
      }  
    }
  }
};