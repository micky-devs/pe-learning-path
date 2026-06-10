import { Stack, StackProps } from "aws-cdk-lib";
import { Vpc, NatProvider, CfnEIP, SubnetType } from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";
import { projectNs } from "../config";


export class BasicNetworkingStack extends Stack {
  vpc: Vpc

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

  }
}
