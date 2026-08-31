import * as aws from "@pulumi/aws"
import * as pulumi from "@pulumi/pulumi"
import { projectNs, type ClusterConfig } from "../config"

export interface NetworkArgs {
  config: ClusterConfig
}

/**
 * Lean VPC for EKS.
 *
 * Design choices (see README):
 *  - Public subnets only when `publicNodes` is true → nodes egress via their
 *    own public IP, so there is NO NAT gateway (~$32/mo + data saved).
 *  - When `publicNodes` is false we add private subnets + a single NAT gateway.
 *  - Subnets are tagged for EKS load balancer / cluster discovery.
 */
export class Network extends pulumi.ComponentResource {
  readonly vpc: aws.ec2.Vpc
  readonly publicSubnetIds: pulumi.Output<string>[]
  readonly privateSubnetIds: pulumi.Output<string>[]
  /** Subnets EKS should place nodes + the NLB in. */
  readonly nodeSubnetIds: pulumi.Output<string>[]

  constructor(name: string, args: NetworkArgs, opts?: pulumi.ComponentResourceOptions) {
    super("playground:net:Network", name, {}, opts)
    const { config } = args
    const parent = this

    const azs = aws.getAvailabilityZonesOutput(
      { state: "available" },
      { parent },
    ).names.apply((names) => names.slice(0, config.azCount))

    this.vpc = new aws.ec2.Vpc(
      `${projectNs}-vpc`,
      {
        cidrBlock: config.vpcCidr,
        enableDnsHostnames: true,
        enableDnsSupport: true,
        tags: { Name: `${projectNs}-vpc` },
      },
      { parent },
    )

    const igw = new aws.ec2.InternetGateway(
      `${projectNs}-igw`,
      { vpcId: this.vpc.id, tags: { Name: `${projectNs}-igw` } },
      { parent },
    )

    const publicRt = new aws.ec2.RouteTable(
      `${projectNs}-public-rt`,
      {
        vpcId: this.vpc.id,
        routes: [{ cidrBlock: "0.0.0.0/0", gatewayId: igw.id }],
        tags: { Name: `${projectNs}-public-rt` },
      },
      { parent },
    )

    this.publicSubnetIds = []
    this.privateSubnetIds = []

    for (let i = 0; i < config.azCount; i++) {
      const az = azs.apply((a) => a[i])

      const publicSubnet = new aws.ec2.Subnet(
        `${projectNs}-public-${i}`,
        {
          vpcId: this.vpc.id,
          // 10.0.0.0/24, 10.0.1.0/24, ...
          cidrBlock: cidrSubnet(config.vpcCidr, i),
          availabilityZone: az,
          mapPublicIpOnLaunch: true,
          tags: {
            Name: `${projectNs}-public-${i}`,
            // Required for EKS to find subnets for internet-facing LBs.
            "kubernetes.io/role/elb": "1",
          },
        },
        { parent },
      )
      new aws.ec2.RouteTableAssociation(
        `${projectNs}-public-rta-${i}`,
        { subnetId: publicSubnet.id, routeTableId: publicRt.id },
        { parent },
      )
      this.publicSubnetIds.push(publicSubnet.id)

      // Private subnets only needed when we run nodes privately (NAT path).
      if (!config.publicNodes) {
        const privateSubnet = new aws.ec2.Subnet(
          `${projectNs}-private-${i}`,
          {
            vpcId: this.vpc.id,
            // Offset private CIDRs above the public ones.
            cidrBlock: cidrSubnet(config.vpcCidr, i + 128),
            availabilityZone: az,
            mapPublicIpOnLaunch: false,
            tags: {
              Name: `${projectNs}-private-${i}`,
              "kubernetes.io/role/internal-elb": "1",
            },
          },
          { parent },
        )
        this.privateSubnetIds.push(privateSubnet.id)
      }
    }

    // Single NAT gateway (cheapest HA-ish option) only on the private path.
    if (!config.publicNodes) {
      const eip = new aws.ec2.Eip(
        `${projectNs}-nat-eip`,
        { domain: "vpc", tags: { Name: `${projectNs}-nat-eip` } },
        { parent },
      )
      const nat = new aws.ec2.NatGateway(
        `${projectNs}-nat`,
        {
          allocationId: eip.id,
          subnetId: this.publicSubnetIds[0],
          tags: { Name: `${projectNs}-nat` },
        },
        { parent },
      )
      const privateRt = new aws.ec2.RouteTable(
        `${projectNs}-private-rt`,
        {
          vpcId: this.vpc.id,
          routes: [{ cidrBlock: "0.0.0.0/0", natGatewayId: nat.id }],
          tags: { Name: `${projectNs}-private-rt` },
        },
        { parent },
      )
      this.privateSubnetIds.forEach((id, i) => {
        new aws.ec2.RouteTableAssociation(
          `${projectNs}-private-rta-${i}`,
          { subnetId: id, routeTableId: privateRt.id },
          { parent },
        )
      })
    }

    this.nodeSubnetIds = config.publicNodes
      ? this.publicSubnetIds
      : this.privateSubnetIds

    this.registerOutputs({
      vpcId: this.vpc.id,
      publicSubnetIds: this.publicSubnetIds,
      privateSubnetIds: this.privateSubnetIds,
    })
  }
}

/**
 * Derive a /24 subnet CIDR from a /16 VPC CIDR by replacing the third octet.
 * Keeps the playground dependency-free (no cidr library needed).
 */
function cidrSubnet(vpcCidr: string, index: number): string {
  const base = vpcCidr.split("/")[0].split(".")
  return `${base[0]}.${base[1]}.${index}.0/24`
}
