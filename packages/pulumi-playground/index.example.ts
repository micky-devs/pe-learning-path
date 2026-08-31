import * as aws from "@pulumi/aws"
import { defaultClusterConfig, type ClusterConfig } from "./config"
import { Network } from "./components/network"
import { Cluster } from "./components/cluster"
import { LbController } from "./components/lb-controller"
import { Gateway } from "./components/gateway"

/**
 * Lean EKS playground entrypoint.
 *
 * Copy this file to `index.ts` (which is gitignored, like the cdk-playground)
 * and tweak it freely. Customise the stack by overriding any field of the
 * default cluster config, or by commenting out components you don't want.
 */

// --- Customise here -------------------------------------------------------
const config: ClusterConfig = {
  ...defaultClusterConfig,
  // e.g. swap to spot to cut node cost, or scale to a single AZ:
  // capacityType: "SPOT",
  // azCount: 1,
  // instanceTypes: ["t4g.medium"],
}
// -------------------------------------------------------------------------

const region = aws.config.requireRegion()

// 1. Network: VPC + public subnets, no NAT (egress via node public IPs).
const network = new Network("network", { config })

// 2. EKS: managed control plane + Graviton nodes + VPC CNI/NetworkPolicy +
//    Pod Identity agent.
const cluster = new Cluster("cluster", { config, network })

// 3. AWS Load Balancer Controller (needed for the NLB annotations).
const lbController = new LbController("lb-controller", {
  clusterName: cluster.cluster.eksCluster.name,
  vpcId: network.vpc.id,
  region,
  provider: cluster.cluster.provider,
})

// 4. Envoy Gateway behind a single cross-zone NLB. Apps attach HTTPRoutes
//    to the `${PROJECT_NS}-gateway` Gateway.
new Gateway(
  "gateway",
  { provider: cluster.cluster.provider },
  { dependsOn: lbController },
)

// Exports (kubeconfig is sensitive — use `pulumi stack output --show-secrets`).
export const kubeconfig = cluster.kubeconfig
export const clusterName = cluster.cluster.eksCluster.name
export const vpcId = network.vpc.id
