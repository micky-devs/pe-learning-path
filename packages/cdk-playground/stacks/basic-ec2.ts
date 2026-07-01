import { CfnOutput, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import {
  Vpc,
  SubnetType,
  Instance,
  InstanceType,
  InstanceClass,
  InstanceSize,
  MachineImage,
  AmazonLinuxCpuType,
  SecurityGroup,
  Peer,
  Port,
  KeyPair,
  BlockDeviceVolume,
  EbsDeviceVolumeType,
} from "aws-cdk-lib/aws-ec2";
import {
  Role,
  ServicePrincipal,
  ManagedPolicy,
} from "aws-cdk-lib/aws-iam";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { CfnAssociation } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { projectNs } from "../config";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface BasicEc2Props extends StackProps {
  /** Your public IP, used to scope SSH ingress. Resolve via getPublicIp() in index.ts. */
  allowedIp: string;
}

export class BasicEc2 extends Stack {
  vpc: Vpc;
  instance: Instance;

  constructor(scope: Construct, id: string, props: BasicEc2Props) {
    super(scope, id, {
      stackName: `${projectNs}-${id}`,
      ...props,
    });

    this.vpc = new Vpc(this, "vpc", {
      vpcName: `${projectNs}-vpc`,
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: "public",
          subnetType: SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: "private",
          subnetType: SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
      restrictDefaultSecurityGroup: false,
    });

    // SSH key pair — private key auto-stored in SSM Parameter Store
    const keyPair = new KeyPair(this, "key-pair", {
      keyPairName: `${projectNs}-basic-ec2`,
    });

    // Security group: SSH (22) from your IP only
    const securityGroup = new SecurityGroup(this, "sg", {
      vpc: this.vpc,
      securityGroupName: `${projectNs}-basic-ec2`,
      description: "Allow SSH from my IP",
      allowAllOutbound: true,
    });
    securityGroup.addIngressRule(
      Peer.ipv4(`${props.allowedIp}/32`),
      Port.tcp(22),
      "SSH from my IP",
    );

    // CloudWatch log group for bootstrap output (tailed by the CW agent).
    const bootstrapLogGroup = new LogGroup(this, "bootstrap-logs", {
      logGroupName: `/${projectNs}/basic-ec2/bootstrap`,
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Instance role: SSM managed (agent + associations) + CloudWatch agent.
    const role = new Role(this, "instance-role", {
      roleName: `${projectNs}-basic-ec2`,
      assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
        ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy"),
      ],
    });

    // The Graviton instance
    this.instance = new Instance(this, "instance", {
      instanceName: `${projectNs}-basic-ec2`,
      vpc: this.vpc,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
      associatePublicIpAddress: true,
      instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.MEDIUM),
      machineImage: MachineImage.latestAmazonLinux2023({
        cpuType: AmazonLinuxCpuType.ARM_64,
      }),
      securityGroup,
      keyPair,
      role,
      blockDevices: [
        {
          deviceName: "/dev/xvda",
          volume: BlockDeviceVolume.ebs(30, {
            volumeType: EbsDeviceVolumeType.GP3,
          }),
        },
      ],
    });

    const script = readFileSync(
      join(__dirname, "..", "scripts", "basic-ec2-userdata.sh"),
      "utf8",
    ).replaceAll("__LOG_GROUP__", bootstrapLogGroup.logGroupName);

    new CfnAssociation(this, "provision", {
      name: "AWS-RunShellScript",
      associationName: `${projectNs}-basic-ec2-provision`,
      targets: [{ key: "InstanceIds", values: [this.instance.instanceId] }],
      parameters: { commands: [script] },
      maxConcurrency: "1",
      maxErrors: "0",
    });

    new CfnAssociation(this, "patch-scan", {
      name: "AWS-RunPatchBaseline",
      associationName: `${projectNs}-basic-ec2-patch-scan`,
      targets: [{ key: "InstanceIds", values: [this.instance.instanceId] }],
      parameters: { Operation: ["Scan"] },
      scheduleExpression: "rate(30 minutes)",
      maxConcurrency: "1",
      maxErrors: "0",
    });

    new CfnOutput(this, "public-ip", {
      value: this.instance.instancePublicIp,
    });
    new CfnOutput(this, "public-dns", {
      value: this.instance.instancePublicDnsName,
    });
    new CfnOutput(this, "get-private-key-command", {
      value: `aws ssm get-parameter --name /ec2/keypair/${keyPair.keyPairId} --with-decryption --query Parameter.Value --output text`,
    });
    new CfnOutput(this, "ssh-command", {
      value: `ssh -i <private-key.pem> ec2-user@${this.instance.instancePublicIp}`,
    });
    new CfnOutput(this, "bootstrap-logs-command", {
      value: `aws logs tail ${bootstrapLogGroup.logGroupName} --follow`,
    });
    new CfnOutput(this, "patch-status-command", {
      value: `aws ssm describe-instance-patch-states --instance-ids ${this.instance.instanceId}`,
    });
  }
}
