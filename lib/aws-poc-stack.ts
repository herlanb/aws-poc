import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as logs from 'aws-cdk-lib/aws-logs';

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
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Bucket S3
    const bucket = new s3.Bucket(this, 'CsvBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ========== SNS + SQS ==========
    
    // SNS Topic para notificaciones de S3
    const topic = new sns.Topic(this, 'CsvUploadTopic', {
      displayName: 'CSV Upload Notifications',
    });

    // SQS Queue para procesar mensajes
    const queue = new sqs.Queue(this, 'CsvProcessQueue', {
      queueName: 'csv-process-queue',
      visibilityTimeout: cdk.Duration.seconds(60),
      retentionPeriod: cdk.Duration.days(1),
    });

    // Conectar SNS a SQS
    topic.addSubscription(new subscriptions.SqsSubscription(queue));

    // S3 notifica a SNS cuando se sube un CSV
    bucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(topic),
      { suffix: '.csv' }
    );

    // ========== VPC ==========
    
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1, // Para POC, 1 es suficiente
    });

    // ========== ECS ==========
    
    // Cluster ECS
    const cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: 'csv-processor-cluster',
      vpc,
      containerInsights: true, // Habilita métricas detalladas
    });

    // ECR Repository
    const repository = new ecr.Repository(this, 'Repository', {
      repositoryName: 'csv-processor',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    // Task Definition (Fargate)
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      memoryLimitMiB: 512,
      cpu: 256,
      family: 'csv-processor-task',
    });

    // Container
    const container = taskDefinition.addContainer('Worker', {
      image: ecs.ContainerImage.fromEcrRepository(repository, 'latest'),
      environment: {
        QUEUE_URL: queue.queueUrl,
        TABLE_NAME: table.tableName,
        AWS_REGION: this.region,
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'csv-processor',
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
    });

    // ECS Service (Fargate)
    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition,
      serviceName: 'csv-processor-service',
      desiredCount: 2, // 2 workers
      assignPublicIp: false, // En subnets privadas
      enableExecuteCommand: true, // Para debugging
    });

    // ========== PERMISOS ==========
    
    bucket.grantRead(taskDefinition.taskRole);
    table.grantWriteData(taskDefinition.taskRole);
    queue.grantConsumeMessages(taskDefinition.taskRole);

    // ========== OUTPUTS ==========
    
    new cdk.CfnOutput(this, 'BucketName', {
      value: bucket.bucketName,
      description: 'Sube tu CSV aquí',
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: table.tableName,
      description: 'Tabla DynamoDB',
    });

    new cdk.CfnOutput(this, 'QueueUrl', {
      value: queue.queueUrl,
      description: 'SQS Queue URL',
    });

    new cdk.CfnOutput(this, 'ClusterName', {
      value: cluster.clusterName,
      description: 'ECS Cluster Name',
    });

    new cdk.CfnOutput(this, 'ServiceName', {
      value: service.serviceName,
      description: 'ECS Service Name',
    });

    new cdk.CfnOutput(this, 'RepositoryUri', {
      value: repository.repositoryUri,
      description: 'ECR Repository URI',
    });

    new cdk.CfnOutput(this, 'LogGroup', {
      value: `/ecs/csv-processor`,
      description: 'CloudWatch Log Group',
    });
  }
}