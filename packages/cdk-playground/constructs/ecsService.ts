import { Construct } from "constructs";
import { Stack, Duration, CfnOutput } from "aws-cdk-lib";
import { IVpc, SecurityGroup, Peer, Port } from "aws-cdk-lib/aws-ec2";
import {
  ContainerImage,
  FargateTaskDefinition,
  CpuArchitecture,
  OperatingSystemFamily,
  LogDrivers,
  FargateService,
  ICluster,
  TaskDefinition,
} from "aws-cdk-lib/aws-ecs";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import {
  ApplicationLoadBalancer,
  ApplicationTargetGroup,
  ApplicationProtocol,
  TargetType,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { projectNs, getPublicIp } from "../config";

const publicIp = await getPublicIp();

export interface EcsServiceProps {
  vpc: IVpc;
  cluster: ICluster;
  /**
   * Docker build context. Use the repo root when the Dockerfile relies on
   * npm workspace files (package.json, package-lock.json, sibling packages).
   * @default "."
   */
  imagePath?: string;
  /**
   * Path to the Dockerfile, relative to `imagePath`.
   * @example "packages/sample-express/Dockerfile"
   */
  dockerfile: string;
  /** Logical service name; used for naming AWS resources. */
  serviceName: string;
  /** Container port the app listens on. */
  port: number;
  /** Path of the HTTP health check endpoint. @default "/health" */
  healthCheckPath?: string;
  /** @default {} */
  envVars?: Record<string, string>;
  /** @default true */
  arm?: boolean;
  /** @default 1024 */
  memoryLimitMiB?: number;
  /** @default 512 */
  cpu?: number;
  /** @default 1 */
  desiredCount?: number;
}

export class EcsService extends Construct {
  taskDefinition: TaskDefinition;
  fargateService: FargateService;
  image: ContainerImage;
  alb: ApplicationLoadBalancer;
  albUrl: string;
  albSg: SecurityGroup;

  constructor(scope: Construct, id: string, props: EcsServiceProps) {
    super(scope, id);

    const stack = Stack.of(this);
    const envVars = props.envVars ?? {};
    const arm = props.arm ?? true;
    const desiredCount = props.desiredCount ?? 1;
    const platform = arm ? Platform.LINUX_ARM64 : Platform.LINUX_AMD64;
    const cpuArchitecture = arm ? CpuArchitecture.ARM64 : CpuArchitecture.X86_64;
    const memoryLimitMiB = props.memoryLimitMiB ?? 1024;
    const cpu = props.cpu ?? 512;
    const healthCheckPath = props.healthCheckPath ?? "/health";

    this.image = ContainerImage.fromAsset(props.imagePath ?? ".", {
      platform,
      file: props.dockerfile,
    });

    const albSg = new SecurityGroup(this, "alb-sg", {
      vpc: props.vpc,
      description: `ALB security group for ECS Service: ${props.serviceName}`,
      allowAllOutbound: true,
    });

    albSg.addIngressRule(
      Peer.ipv4(`${publicIp}/32`),
      Port.tcp(80),
      "Allow HTTP from deployer IP",
    );

    const serviceSg = new SecurityGroup(this, "service-sg", {
      vpc: props.vpc,
      description: `Security group for ECS Service: ${props.serviceName}`,
      allowAllOutbound: true,
    });

    serviceSg.addIngressRule(albSg, Port.tcp(props.port), "Allow application traffic from ALB");

    this.alb = new ApplicationLoadBalancer(this, "alb", {
      vpc: props.vpc,
      loadBalancerName: `${projectNs}-${props.serviceName}`,
      internetFacing: true,
      securityGroup: albSg,
    });

    this.taskDefinition = new FargateTaskDefinition(this, "task-def", {
      memoryLimitMiB,
      cpu,
      family: `${projectNs}-${props.serviceName}`,
      runtimePlatform: {
        cpuArchitecture,
        operatingSystemFamily: OperatingSystemFamily.LINUX,
      },
    });

    const appLogGroup = new LogGroup(this, "logs", {
      logGroupName: `/ecs/${projectNs}/${props.serviceName}`,
      retention: RetentionDays.FIVE_DAYS,
    });

    appLogGroup.grantWrite(this.taskDefinition.taskRole);

    this.taskDefinition.addContainer("app", {
      containerName: "app",
      image: this.image,
      environment: {
        PORT: String(props.port),
        SERVICE_NAME: props.serviceName,
        PROJECT_NS: projectNs,
        ...envVars,
      },
      portMappings: [{ containerPort: props.port }],
      logging: LogDrivers.awsLogs({
        streamPrefix: "app",
        logGroup: appLogGroup,
      }),
      healthCheck: {
        command: [
          "CMD-SHELL",
          `wget -qO- http://127.0.0.1:${props.port}${healthCheckPath} || exit 1`,
        ],
        interval: Duration.seconds(15),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(30),
      },
    });

    this.fargateService = new FargateService(this, "service", {
      cluster: props.cluster,
      serviceName: props.serviceName,
      taskDefinition: this.taskDefinition,
      desiredCount,
      securityGroups: [serviceSg],
      assignPublicIp: false,
      enableExecuteCommand: true,
      minHealthyPercent: 0,
      maxHealthyPercent: 200,
      circuitBreaker: { enable: true, rollback: true },
    });

    const targetGroup = new ApplicationTargetGroup(this, "tg", {
      vpc: props.vpc,
      targetGroupName: `${projectNs}-${props.serviceName}`,
      port: props.port,
      protocol: ApplicationProtocol.HTTP,
      targetType: TargetType.IP,
      healthCheck: {
        path: healthCheckPath,
        interval: Duration.seconds(15),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        healthyHttpCodes: "200",
      },
      deregistrationDelay: Duration.seconds(10),
      targets: [
        this.fargateService.loadBalancerTarget({
          containerName: "app",
          containerPort: props.port,
        }),
      ],
    });

    this.alb.addListener("listener", {
      port: 80,
      open: false,
      defaultTargetGroups: [targetGroup],
    });

    this.albSg = albSg;
    this.albUrl = `http://${this.alb.loadBalancerDnsName}`;

    new CfnOutput(this, "alb-url", {
      key: `${props.serviceName.replace(/[^a-zA-Z0-9]/g, "")}Url`,
      value: this.albUrl,
      description: `${props.serviceName} ALB URL`,
    });

    // Silence unused-stack warnings; reserved for future region/account-aware logic.
    void stack;
  }
}
