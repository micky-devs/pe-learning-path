import * as aws from "@pulumi/aws"
import * as eks from "@pulumi/eks"
import * as pulumi from "@pulumi/pulumi"
import { projectNs, type ClusterConfig } from "../config"
import type { Network } from "./network"

export interface ClusterArgs {
  config: ClusterConfig
  network: Network
}

/**
 * Lean EKS cluster.
 *
 *  - Managed control plane (the fixed ~$73/mo cost of EKS).
 *  - Graviton (arm64) managed node group, fixed size (no autoscaler).
 *  - VPC CNI addon with built-in eBPF NetworkPolicy (no Cilium to operate).
 *  - EKS Pod Identity Agent addon → pods get IAM roles without IRSA/OIDC fuss.
 *  - Nodes land in public subnets (egress via public IP) or private (NAT),
 *    driven by `config.publicNodes`.
 */
export class Cluster extends pulumi.ComponentResource {
  readonly cluster: eks.Cluster
  readonly kubeconfig: pulumi.Output<string>
  readonly nodeRole: aws.iam.Role

  constructor(name: string, args: ClusterArgs, opts?: pulumi.ComponentResourceOptions) {
    super("playground:eks:Cluster", name, {}, opts)
    const { config, network } = args
    const parent = this

    // IAM role assumed by the worker nodes. Includes ECR pull + SSM + CNI.
    this.nodeRole = new aws.iam.Role(
      `${projectNs}-node-role`,
      {
        name: `${projectNs}-node-role`,
        assumeRolePolicy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: { Service: "ec2.amazonaws.com" },
              Action: "sts:AssumeRole",
            },
          ],
        }),
        tags: { Name: `${projectNs}-node-role` },
      },
      { parent },
    )

    const nodePolicies = {
      worker: "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
      cni: "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
      ecr: "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
      ssm: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
    }
    for (const [key, arn] of Object.entries(nodePolicies)) {
      new aws.iam.RolePolicyAttachment(
        `${projectNs}-node-${key}`,
        { role: this.nodeRole.name, policyArn: arn },
        { parent },
      )
    }

    this.cluster = new eks.Cluster(
      `${projectNs}-eks`,
      {
        name: `${projectNs}-eks`,
        version: config.k8sVersion,
        vpcId: network.vpc.id,
        // Control-plane ENIs + LBs live in the public subnets.
        publicSubnetIds: network.publicSubnetIds,
        privateSubnetIds: config.publicNodes
          ? undefined
          : network.privateSubnetIds,
        // We manage our own node group below, so disable the default one.
        skipDefaultNodeGroup: true,
        // API server reachable publicly (lean: no bastion). Lock down via
        // publicAccessCidrs in config if you want to restrict it.
        endpointPublicAccess: true,
        endpointPrivateAccess: true,
        // VPC CNI with eBPF NetworkPolicy enabled — no extra CNI to run.
        useDefaultVpcCni: false,
        vpcCniOptions: {
          enableNetworkPolicy: config.networkPolicy,
        },
        // Pod Identity is the modern, simpler alternative to IRSA.
        // The agent is added as an addon below.
        createOidcProvider: false,
        tags: { Name: `${projectNs}-eks` },
      },
      { parent },
    )

    // Graviton managed node group.
    new eks.ManagedNodeGroup(
      `${projectNs}-nodes`,
      {
        cluster: this.cluster,
        nodeGroupName: `${projectNs}-nodes`,
        nodeRole: this.nodeRole,
        subnetIds: network.nodeSubnetIds,
        instanceTypes: config.instanceTypes,
        amiType: "AL2023_ARM_64_STANDARD",
        capacityType: config.capacityType,
        diskSize: config.nodeDiskGiB,
        scalingConfig: {
          minSize: config.nodeMin,
          desiredSize: config.nodeDesired,
          maxSize: config.nodeMax,
        },
        tags: { Name: `${projectNs}-nodes` },
      },
      { parent },
    )

    // EKS Pod Identity Agent — enables pod-level IAM role associations.
    new aws.eks.Addon(
      `${projectNs}-pod-identity`,
      {
        clusterName: this.cluster.eksCluster.name,
        addonName: "eks-pod-identity-agent",
        resolveConflictsOnCreate: "OVERWRITE",
        resolveConflictsOnUpdate: "OVERWRITE",
      },
      { parent },
    )

    this.kubeconfig = this.cluster.kubeconfig.apply((k) => JSON.stringify(k))

    this.registerOutputs({ kubeconfig: this.kubeconfig })
  }
}
