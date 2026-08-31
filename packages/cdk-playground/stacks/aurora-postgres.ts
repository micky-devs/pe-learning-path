import { Stack, CfnOutput, RemovalPolicy } from "aws-cdk-lib"
import { Vpc, SubnetType, SecurityGroup, Peer, Port, InstanceType, InstanceClass, InstanceSize } from "aws-cdk-lib/aws-ec2"
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam"
import { Construct } from "constructs"
import { projectNs, getPublicIp } from "../config"
import { AuroraPostgresEngineVersion, CfnDBProxy, CfnDBProxyTargetGroup, ClusterInstance, Credentials, DatabaseCluster, DatabaseClusterEngine } from "aws-cdk-lib/aws-rds";

const publicIp = await getPublicIp();

export class AuroraPostgresStack extends Stack {
  vpc: Vpc
  dbCluster: DatabaseCluster

  constructor(scope: Construct, id: string) {
    super(scope, id)

    this.vpc = new Vpc(this, `${projectNs}-aurora-postgres-vpc`, {
      vpcName: `${projectNs}-aurora-postgres`,
      maxAzs: 2,
      restrictDefaultSecurityGroup: false,
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
      ]
    })

    const primaryAz = this.vpc.availabilityZones[0]
    const secondaryAz = this.vpc.availabilityZones[1]

    const dbSecurityGroup = new SecurityGroup(this, `${projectNs}-aurora-postgres-main`, {
      allowAllOutbound: true,
      description: "Main security group for aurora postgres database",
      vpc: this.vpc
    });

    dbSecurityGroup.addIngressRule(Peer.ipv4(`${publicIp}/32`), Port.POSTGRES);

    const credentials = Credentials.fromGeneratedSecret("postgres", { 
      secretName: `${projectNs}-aurora-postgres-creds`
    })
    const instanceType = InstanceType.of(InstanceClass.T4G, InstanceSize.MEDIUM)

    const primaryInstanceId = "primary"
    const secondaryInstanceId = "secondary"
    const opsInstanceId = "ops"

    this.dbCluster = new DatabaseCluster(this, `${projectNs}-aurora-postgres-db`, {
      engine: DatabaseClusterEngine.auroraPostgres({
        version: AuroraPostgresEngineVersion.VER_17_9
      }),
      credentials,
      vpc: this.vpc,
      vpcSubnets: {
        subnetType: SubnetType.PUBLIC
      },
      removalPolicy: RemovalPolicy.DESTROY,
      securityGroups: [dbSecurityGroup],
      writer: ClusterInstance.provisioned("writer", {
        instanceType,
        publiclyAccessible: true,
        availabilityZone: primaryAz,
        instanceIdentifier: primaryInstanceId
      }),
      readers: [
        ClusterInstance.provisioned("secondary", {
          instanceType,
          publiclyAccessible: true,
          availabilityZone: secondaryAz,
          instanceIdentifier: secondaryInstanceId,
          promotionTier: 1
        }),
        ClusterInstance.provisioned("ops", {
          instanceType,
          publiclyAccessible: true,
          availabilityZone: primaryAz,
          instanceIdentifier: opsInstanceId,
          promotionTier: 15
        })
      ],
      defaultDatabaseName: "postgres"
    })


    const dbSecret = this.dbCluster.secret!

    const proxyName = `${projectNs}-aurora-postgres-proxy`

    const proxyRole = new Role(this, `${projectNs}-aurora-postgres-proxy-role`, {
      assumedBy: new ServicePrincipal("rds.amazonaws.com"),
    })
    dbSecret.grantRead(proxyRole)

    const proxySecurityGroup = new SecurityGroup(this, `${projectNs}-aurora-postgres-proxy-sg`, {
      allowAllOutbound: true,
      description: "Security group for the aurora postgres RDS proxy",
      vpc: this.vpc,
    })

    dbSecurityGroup.addIngressRule(proxySecurityGroup, Port.POSTGRES, "Allow RDS proxy to reach the database instances")
    proxySecurityGroup.addIngressRule(Peer.ipv4(`${publicIp}/32`), Port.POSTGRES)

    const proxy = new CfnDBProxy(this, `${projectNs}-aurora-postgres-proxy-resource`, {
      dbProxyName: proxyName,
      engineFamily: "POSTGRESQL",
      roleArn: proxyRole.roleArn,
      auth: [
        {
          authScheme: "SECRETS",
          iamAuth: "DISABLED",
          secretArn: dbSecret.secretArn,
        },
      ],
      requireTls: true,
      vpcSecurityGroupIds: [proxySecurityGroup.securityGroupId],
      vpcSubnetIds: this.vpc.selectSubnets({ subnetType: SubnetType.PUBLIC }).subnetIds,
    })

    const proxyTargetGroup = new CfnDBProxyTargetGroup(this, `${projectNs}-aurora-postgres-proxy-targets`, {
      dbProxyName: proxy.ref,
      targetGroupName: "default",
      dbInstanceIdentifiers: [primaryInstanceId],
    })
    proxyTargetGroup.addDependency(proxy)
    proxyTargetGroup.node.addDependency(this.dbCluster)

    new CfnOutput(this, "DbSecretArn", {
      value: dbSecret.secretArn,
    })

    new CfnOutput(this, "DbClusterEndpoint", {
      value: `${this.dbCluster.clusterEndpoint.hostname}:5432`,
    })

    new CfnOutput(this, "DbProxyEndpoint", {
      value: proxy.attrEndpoint,
    })
  }
}
