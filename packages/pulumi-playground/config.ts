import * as assert from "assert"

/**
 * Namespace prefix applied to every AWS/Kubernetes resource name, so multiple
 * people can deploy this playground into the same account without clashing.
 * Mirrors the cdk-playground convention (PROJECT_NS env var).
 */
export const projectNs = (() => {
  const ns = process.env.PROJECT_NS
  assert.notEqual(ns, undefined, "PROJECT_NS must be defined")
  return ns as string
})()

/** Your current public IP, used to scope ingress (e.g. SSH / admin access). */
export const getPublicIp = async (): Promise<string> => {
  const response = await fetch("https://ipinfo.io", {
    headers: { Accept: "application/json" },
  })
  const json = (await response.json()) as { ip: string }
  return json.ip
}

/**
 * Central, typed knobs for the lean EKS setup. Tweak these (or override per
 * field in index.ts) to customise the components without editing them.
 */
export interface ClusterConfig {
  /** EKS Kubernetes version. */
  k8sVersion: string
  /** How many AZs the VPC spans. 2 = HA with minimal cross-AZ cost. */
  azCount: number
  /** VPC CIDR. /16 leaves plenty of room for VPC-CNI pod IPs. */
  vpcCidr: string
  /** Graviton (arm64) instance type(s) for the managed node group. */
  instanceTypes: string[]
  /** Node group min/desired/max. 2 fixed nodes by default (no autoscaler). */
  nodeMin: number
  nodeDesired: number
  nodeMax: number
  /** Root EBS volume size per node, GiB. */
  nodeDiskGiB: number
  /** Spot is cheaper but interruptible; ON_DEMAND is steady for lean prod. */
  capacityType: "ON_DEMAND" | "SPOT"
  /**
   * Skip the NAT gateway and give nodes public IPs for egress (no ~$32/mo NAT).
   * Trade-off: each node's egress IP changes on replacement.
   */
  publicNodes: boolean
  /** Enable VPC CNI's built-in eBPF NetworkPolicy support. */
  networkPolicy: boolean
}

export const defaultClusterConfig: ClusterConfig = {
  k8sVersion: "1.32",
  azCount: 2,
  vpcCidr: "10.0.0.0/16",
  // 2 vCPU / 8 GiB Graviton — right-sized for a lean prod playground.
  instanceTypes: ["t4g.large"],
  nodeMin: 2,
  nodeDesired: 2,
  nodeMax: 2,
  nodeDiskGiB: 30,
  capacityType: "ON_DEMAND",
  publicNodes: true,
  networkPolicy: true,
}
