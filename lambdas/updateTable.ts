import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { SNSHandler } from "aws-lambda";


const ddbClient = new DynamoDBClient({ region: process.env.REGION });

export const handler: SNSHandler = async (event) => {
  for (const record of event.Records) {
    try {
      const snsMessage = JSON.parse(record.Sns.Message);

      const metadataType = record.Sns.MessageAttributes?.metadata_type?.Value;

      if (!snsMessage.id || !snsMessage.value || !metadataType) {
        console.error("Invalid message format", snsMessage);
        continue;
      }

      const updateParams = {
        TableName: process.env.TABLE_NAME,
        Key: { imageName: snsMessage.id },
        UpdateExpression: `SET ${metadataType.toLowerCase()} = :value`,
        ExpressionAttributeValues: {
          ":value": snsMessage.value,
        },
      };

      await ddbClient.send(new UpdateCommand(updateParams));
      console.log(
        `Successfully updated ${metadataType} for image ${snsMessage.id}`
      );
    } catch (error) {
      console.error("Error processing record:", error);
    }
  }
};