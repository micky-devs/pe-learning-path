import { Stack, StackProps } from "aws-cdk-lib";
import { Vpc, NatProvider, CfnEIP, SubnetType } from "aws-cdk-lib/aws-ec2";
import { Cluster, ContainerInsights } from "aws-cdk-lib/aws-ecs";
import { Construct } from "constructs";
import { projectNs } from "../config";
import { Fe } from "../constructs/fe";
import { EcsService } from "../constructs/ecsService";


export class MainStack extends Stack {
  vpc: Vpc
  cluster: Cluster
  fe: Fe
  sampleExpress: EcsService

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, {
      stackName: `${projectNs}-${id}`,
      ...props
    });

    const eip = new CfnEIP(this, "nat-eip", { domain: "vpc" });

    const natGatewayProvider = NatProvider.gateway({
      eipAllocationIds: [eip.attrAllocationId],
    });

    this.vpc = new Vpc(this, "vpc", {
      vpcName: `${projectNs}-vpc`,
      maxAzs: 2,
      natGateways: 1,
      natGatewayProvider,
      subnetConfiguration: [
        {
          name: "public",
          subnetType: SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: "private",
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
      restrictDefaultSecurityGroup: false,
    });

    this.cluster = new Cluster(this, "ecs-cluster", {
      vpc: this.vpc,
      clusterName: projectNs,
      containerInsightsV2: ContainerInsights.ENHANCED,
    });

    this.fe = new Fe(this, 'frontend', {
      packagePath: "packages/sample-fe"
    });

    this.sampleExpress = new EcsService(this, "sample-express", {
      vpc: this.vpc,
      cluster: this.cluster,
      dockerfile: "packages/sample-express/Dockerfile",
      serviceName: "sample-express",
      port: 3000,
    });
  }
}
