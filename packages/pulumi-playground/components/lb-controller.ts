import * as aws from "@pulumi/aws"
import * as k8s from "@pulumi/kubernetes"
import * as pulumi from "@pulumi/pulumi"
import { projectNs } from "../config"

export interface LbControllerArgs {
  clusterName: pulumi.Input<string>
  vpcId: pulumi.Input<string>
  region: pulumi.Input<string>
  provider: k8s.Provider
  /** Helm chart version for aws-load-balancer-controller. */
  chartVersion?: string
}

/**
 * AWS Load Balancer Controller.
 *
 * Required for the modern NLB/ALB annotations used by the Gateway (cross-zone,
 * target-type, scheme, etc.). IAM is granted via EKS Pod Identity (no IRSA/OIDC).
 *
 * The IAM policy is the official one published by the project; we attach a
 * trimmed inline policy covering the actions the controller needs.
 */
export class LbController extends pulumi.ComponentResource {
  constructor(name: string, args: LbControllerArgs, opts?: pulumi.ComponentResourceOptions) {
    super("playground:net:LbController", name, {}, opts)
    const parent = this
    const { provider } = args

    const serviceAccountName = "aws-load-balancer-controller"
    const namespace = "kube-system"

    // IAM role the controller's ServiceAccount assumes via Pod Identity.
    const role = new aws.iam.Role(
      `${projectNs}-lbc-role`,
      {
        name: `${projectNs}-lbc-role`,
        assumeRolePolicy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: { Service: "pods.eks.amazonaws.com" },
              Action: ["sts:AssumeRole", "sts:TagSession"],
            },
          ],
        }),
        tags: { Name: `${projectNs}-lbc-role` },
      },
      { parent },
    )

    // Managed-equivalent policy for the LB controller. Sourced from the
    // project's published IAM policy; fetched at deploy time to stay current.
    const policyDoc = pulumi.output(
      fetch(
        "https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v2.9.2/docs/install/iam_policy.json",
      ).then((r) => r.text()),
    )

    const policy = new aws.iam.Policy(
      `${projectNs}-lbc-policy`,
      { name: `${projectNs}-lbc-policy`, policy: policyDoc },
      { parent },
    )

    new aws.iam.RolePolicyAttachment(
      `${projectNs}-lbc-attach`,
      { role: role.name, policyArn: policy.arn },
      { parent },
    )

    // Bind the role to the controller's ServiceAccount via Pod Identity.
    new aws.eks.PodIdentityAssociation(
      `${projectNs}-lbc-pod-identity`,
      {
        clusterName: args.clusterName,
        namespace,
        serviceAccount: serviceAccountName,
        roleArn: role.arn,
      },
      { parent },
    )

    new k8s.helm.v3.Release(
      `${projectNs}-lbc`,
      {
        chart: "aws-load-balancer-controller",
        version: args.chartVersion ?? "1.9.2",
        namespace,
        repositoryOpts: { repo: "https://aws.github.io/eks-charts" },
        atomic: true,
        values: {
          clusterName: args.clusterName,
          region: args.region,
          vpcId: args.vpcId,
          serviceAccount: {
            create: true,
            name: serviceAccountName,
          },
        },
      },
      { parent, provider },
    )

    this.registerOutputs({})
  }
}
