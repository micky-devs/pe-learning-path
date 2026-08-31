import * as k8s from "@pulumi/kubernetes"
import * as pulumi from "@pulumi/pulumi"
import { projectNs } from "../config"

export interface GatewayArgs {
  /** Kubernetes provider pointed at the target cluster. */
  provider: k8s.Provider
  /** Chart version for Envoy Gateway. */
  chartVersion?: string
}

/**
 * Envoy Gateway (Gateway API) fronted by a single AWS NLB.
 *
 *  - One NLB total (not one ALB per service). TLS terminates in-cluster.
 *  - NLB cross-zone load balancing is ON so losing one node/AZ doesn't break
 *    routing — small data charge, worth it for 2-node HA.
 *  - An EnvoyProxy config patches the auto-created Service with the AWS
 *    Load Balancer Controller annotations to make it an internet-facing NLB.
 *
 * NOTE: this provisions the Gateway controller + a GatewayClass + a Gateway.
 * Your apps attach HTTPRoutes to the `${projectNs}-gateway` Gateway.
 */
export class Gateway extends pulumi.ComponentResource {
  readonly namespace: k8s.core.v1.Namespace

  constructor(name: string, args: GatewayArgs, opts?: pulumi.ComponentResourceOptions) {
    super("playground:net:Gateway", name, {}, opts)
    const parent = this
    const provider = args.provider

    this.namespace = new k8s.core.v1.Namespace(
      `${projectNs}-envoy-gateway`,
      { metadata: { name: "envoy-gateway-system" } },
      { parent, provider },
    )

    // Envoy Gateway controller via its Helm (OCI) chart.
    const release = new k8s.helm.v3.Release(
      `${projectNs}-envoy-gateway`,
      {
        chart: "oci://docker.io/envoyproxy/gateway-helm",
        version: args.chartVersion ?? "v1.2.6",
        namespace: this.namespace.metadata.name,
        // Wait for the controller + CRDs to be ready before we apply CRs.
        atomic: true,
      },
      { parent, provider },
    )

    // EnvoyProxy: turn the data-plane Service into an internet-facing NLB
    // with cross-zone load balancing enabled.
    const envoyProxy = new k8s.apiextensions.CustomResource(
      `${projectNs}-envoyproxy`,
      {
        apiVersion: "gateway.envoyproxy.io/v1alpha1",
        kind: "EnvoyProxy",
        metadata: { name: `${projectNs}-proxy`, namespace: "envoy-gateway-system" },
        spec: {
          provider: {
            type: "Kubernetes",
            kubernetes: {
              envoyService: {
                type: "LoadBalancer",
                annotations: {
                  "service.beta.kubernetes.io/aws-load-balancer-type": "external",
                  "service.beta.kubernetes.io/aws-load-balancer-nlb-target-type": "instance",
                  "service.beta.kubernetes.io/aws-load-balancer-scheme": "internet-facing",
                  // HA across nodes/AZs — accepts the small NLB data charge.
                  "service.beta.kubernetes.io/aws-load-balancer-attributes":
                    "load_balancing.cross_zone.enabled=true",
                },
              },
            },
          },
        },
      },
      { parent, provider, dependsOn: release },
    )

    // GatewayClass bound to the Envoy Gateway controller, using our proxy config.
    const gatewayClass = new k8s.apiextensions.CustomResource(
      `${projectNs}-gatewayclass`,
      {
        apiVersion: "gateway.networking.k8s.io/v1",
        kind: "GatewayClass",
        metadata: { name: `${projectNs}-eg` },
        spec: {
          controllerName: "gateway.envoyproxy.io/gatewayclass-controller",
          parametersRef: {
            group: "gateway.envoyproxy.io",
            kind: "EnvoyProxy",
            name: `${projectNs}-proxy`,
            namespace: "envoy-gateway-system",
          },
        },
      },
      { parent, provider, dependsOn: [release, envoyProxy] },
    )

    // The Gateway: HTTPS on 443. Apps attach HTTPRoutes to this.
    // Add a TLS cert (cert-manager / ACM) before serving real traffic.
    new k8s.apiextensions.CustomResource(
      `${projectNs}-gateway`,
      {
        apiVersion: "gateway.networking.k8s.io/v1",
        kind: "Gateway",
        metadata: { name: `${projectNs}-gateway`, namespace: "default" },
        spec: {
          gatewayClassName: `${projectNs}-eg`,
          listeners: [
            {
              name: "http",
              protocol: "HTTP",
              port: 80,
              allowedRoutes: { namespaces: { from: "All" } },
            },
          ],
        },
      },
      { parent, provider, dependsOn: gatewayClass },
    )

    this.registerOutputs({})
  }
}
