/* eslint-disable import/extensions, import/no-absolute-path */
import { SQSHandler } from "aws-lambda";
import {
  GetObjectCommand,
  PutObjectCommandInput,
  GetObjectCommandInput,
  S3Client,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";


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


        if (!srcKey.match(/\.(jpeg|png)$/i)) {
          console.warn(`Unsupported file type: ${srcKey}`);
          continue;
        }

        let origimage = null;
        try {
          // Download the image from the S3 source bucket.
          const params: GetObjectCommandInput = {
            Bucket: srcBucket,
            Key: srcKey,
          };
          origimage = await s3.send(new GetObjectCommand(params));
          // Process the image ......

          const dynamoParams = {
            TableName: imageTableName,
            Item: {
              imageName: { S: srcKey },
            },
          };
          await dynamodb.send(new PutItemCommand(dynamoParams));
          console.log(`Saved valid image: ${srcKey} to DynamoDB`);

        } catch (error) {
          console.log(error);
        }
      }
    }
  }
};