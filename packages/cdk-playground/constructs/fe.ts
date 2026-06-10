import { execSync } from "node:child_process";
import * as path from "node:path";
import { Construct } from "constructs";
import { RemovalPolicy, DockerImage, CfnOutput } from "aws-cdk-lib";
import { Bucket, BlockPublicAccess, BucketEncryption } from "aws-cdk-lib/aws-s3";
import {
  Distribution,
  ViewerProtocolPolicy,
  AllowedMethods,
  CachedMethods,
  CachePolicy,
  ResponseHeadersPolicy,
  PriceClass,
} from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { projectNs } from "../config";

export interface FeProps {
  /**
   * Workspace-relative path to the package to build and deploy.
   * Resolved relative to the repo root (cwd at synth time).
   * @example "packages/sample-fe"
   */
  packagePath: string;
  /**
   * Output directory produced by the package's build, relative to packagePath.
   * @default "dist"
   */
  buildOutputDir?: string;
  /**
   * Build command run inside the package directory before sync.
   * @default "npm run build"
   */
  buildCommand?: string;
  /**
   * Default root object served by CloudFront.
   * @default "index.html"
   */
  defaultRootObject?: string;
}

export class Fe extends Construct {
  readonly bucket: Bucket;
  readonly distribution: Distribution;

  constructor(scope: Construct, id: string, props: FeProps) {
    super(scope, id);

    const buildOutputDir = props.buildOutputDir ?? "dist";
    const buildCommand = props.buildCommand ?? "npm run build";
    const defaultRootObject = props.defaultRootObject ?? "index.html";

    const repoRoot = process.cwd();
    const packageAbsPath = path.resolve(repoRoot, props.packagePath);
    const buildOutputAbsPath = path.join(packageAbsPath, buildOutputDir);

    this.bucket = new Bucket(this, "bucket", {
      bucketName: `${projectNs}-${id}`,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    this.distribution = new Distribution(this, "distribution", {
      comment: `${projectNs}-${id}`,
      defaultRootObject,
      priceClass: PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: CachedMethods.CACHE_GET_HEAD_OPTIONS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: ResponseHeadersPolicy.SECURITY_HEADERS,
        compress: true,
      },
      // SPA fallback: serve index.html for client-side routes
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: `/${defaultRootObject}` },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: `/${defaultRootObject}` },
      ],
    });

    new BucketDeployment(this, "deployment", {
      destinationBucket: this.bucket,
      distribution: this.distribution,
      distributionPaths: ["/*"],
      sources: [
        Source.asset(packageAbsPath, {
          // Try to build locally; fall back to Docker if local build fails.
          bundling: {
            image: DockerImage.fromRegistry("public.ecr.aws/docker/library/node:22-alpine"),
            command: [
              "sh",
              "-c",
              `npm ci --prefix ${path.relative(repoRoot, packageAbsPath) || "."} && ${buildCommand} --prefix ${path.relative(repoRoot, packageAbsPath) || "."} && cp -r ${buildOutputDir}/. /asset-output/`,
            ],
            local: {
              tryBundle(outputDir: string) {
                try {
                  execSync(buildCommand, {
                    cwd: packageAbsPath,
                    stdio: "inherit",
                    env: { ...process.env },
                  });
                  execSync(`cp -r "${buildOutputAbsPath}/." "${outputDir}/"`, {
                    stdio: "inherit",
                  });
                  return true;
                } catch (err) {
                  console.error(`[Fe] local bundle failed for ${props.packagePath}:`, err);
                  return false;
                }
              },
            },
          },
        }),
      ],
    });

    new CfnOutput(this, "bucket-name", { value: this.bucket.bucketName });
    new CfnOutput(this, "distribution-id", { value: this.distribution.distributionId });
    new CfnOutput(this, "distribution-domain", {
      value: `https://${this.distribution.distributionDomainName}`,
    });
  }
}
