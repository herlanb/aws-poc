import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';

export class AwsPocStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Tabla DynamoDB
    const table = new dynamodb.Table(this, 'PersonasTable', {
      tableName: 'Personas',
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Para POC - borra todo al hacer destroy
    });

    new dynamodb.Table(this, 'PersonasTable-Aux', {
      tableName: 'Personas-Aux',
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Para POC - borra todo al hacer destroy
    });


    // Bucket S3
    const bucket = new s3.Bucket(this, 'CsvBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true, // Para POC - borra todo al hacer destroy
    });

    // Lambda Function
    const procesarCsvLambda = new lambda.Function(this, 'ProcesarCsvLambda', {
      functionName: 'ProcesarCsvPersonas',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'procesarCsv.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        TABLE_NAME: table.tableName,
      },
      timeout: cdk.Duration.seconds(30),
    });

    // Permisos
    bucket.grantRead(procesarCsvLambda);
    table.grantWriteData(procesarCsvLambda);

    // Trigger: cuando se sube un .csv
    bucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(procesarCsvLambda),
      { suffix: '.csv' }
    );

    // Outputs
    new cdk.CfnOutput(this, 'BucketName', {
      value: bucket.bucketName,
      description: 'Sube tu CSV aquí',
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: table.tableName,
      description: 'Tabla DynamoDB',
    });
  }
}