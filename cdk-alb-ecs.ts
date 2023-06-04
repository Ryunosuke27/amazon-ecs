// @ts-nocheck
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as ecr from "aws-cdk-lib/aws-ecr";

export class SpringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ECRリポジトリを作成
    const repo = new ecr.Repository(this, "Repository");

    // VPC, PublicSubnet x2, PrivateSubnet x2, SG, RouteTable, IGWを作成
    const vpc = new ec2.Vpc(this, "Vpc", {
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "alb",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "ecs",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // ECS → ECR接続用のVPCエンドポイントを作成
    vpc.addInterfaceEndpoint("EcrEndpoint", {
      service: ec2.InterfaceVpcEndpointAwsService.ECR,
    });
    vpc.addInterfaceEndpoint("EcrDkrEndpoint", {
      service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
    });
    vpc.addGatewayEndpoint("S3Endpoint", {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [
        {
          subnets: vpc.isolatedSubnets,
        },
      ],
    });
    vpc.addInterfaceEndpoint("LogsEndpoint", {
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
    });

    // ECSクラスターを作成
    const cluster = new ecs.Cluster(this, "Cluster", { vpc });

    // ALB, ターゲットグループ, ECS サービス, タスク定義を作成
    const loadBalancedFargateService =
      new ecs_patterns.ApplicationLoadBalancedFargateService(
        this,
        "FargateService",
        {
          cluster,
          desiredCount: 2,
          taskImageOptions: {
            image: ecs.ContainerImage.fromEcrRepository(repo),
            containerPort: 8080,
          },
        }
      );

    // オートスケーリング設定
    const autoScaling = loadBalancedFargateService.service.autoScaleTaskCount({
      maxCapacity: 4,
    });
    autoScaling.scaleOnMemoryUtilization("ScalingOnMemory", {
      targetUtilizationPercent: 50,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });
    autoScaling.scaleOnCpuUtilization("ScalingOnCpu", {
      targetUtilizationPercent: 50,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    // ALBのヘルスチェックパスを指定
    loadBalancedFargateService.targetGroup.configureHealthCheck({
      path: "/actuator/health",
    });
  }
}
