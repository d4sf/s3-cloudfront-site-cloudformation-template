import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import { CfnOutput, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { SiteConfig } from "./config";

export class SiteStack extends Stack {
  constructor(scope: Construct, id: string, config: SiteConfig, props: StackProps) {
    super(scope, id, props);

    if (config.mode === "content") {
      this.buildContentOnly(config);
      return;
    }
    this.buildFullStack(config);
  }

  private buildContentOnly(config: SiteConfig): void {
    const bucket = s3.Bucket.fromBucketAttributes(this, "SiteBucket", {
      bucketName: config.s3BucketName as string,
      region: config.s3BucketRegion,
    });

    const distribution = cloudfront.Distribution.fromDistributionAttributes(
      this,
      "SiteDistribution",
      {
        distributionId: config.cloudFrontDistributionId as string,
        domainName: "placeholder.example.com",
      }
    );

    new s3deploy.BucketDeployment(this, "SiteContentDeployment", {
      sources: [s3deploy.Source.asset(config.siteDir)],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ["/*"],
      prune: false,
    });

    new CfnOutput(this, "BucketName", { value: bucket.bucketName });
    new CfnOutput(this, "DistributionId", { value: distribution.distributionId });
  }

  private buildFullStack(config: SiteConfig): void {
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      "HostedZone",
      {
        hostedZoneId: config.hostedZoneId as string,
        zoneName: config.domainName as string,
      }
    );

    const certificate = new acm.Certificate(this, "SiteCertificate", {
      domainName: config.domainName as string,
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    const bucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    const origin = origins.S3BucketOrigin.withOriginAccessControl(bucket);

    const distribution = new cloudfront.Distribution(this, "SiteDistribution", {
      defaultRootObject: "index.html",
      domainNames: [config.domainName as string],
      certificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      },
    });

    new route53.ARecord(this, "SiteAliasRecord", {
      zone: hostedZone,
      recordName: config.domainName as string,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution)
      ),
    });

    new route53.AaaaRecord(this, "SiteAliasRecordAAAA", {
      zone: hostedZone,
      recordName: config.domainName as string,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution)
      ),
    });

    new s3deploy.BucketDeployment(this, "SiteContentDeployment", {
      sources: [s3deploy.Source.asset(config.siteDir)],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ["/*"],
    });

    new CfnOutput(this, "BucketName", { value: bucket.bucketName });
    new CfnOutput(this, "DistributionDomain", {
      value: distribution.distributionDomainName,
    });
    new CfnOutput(this, "DistributionId", { value: distribution.distributionId });
    new CfnOutput(this, "CertificateArn", { value: certificate.certificateArn });
    new CfnOutput(this, "SiteUrl", { value: `https://${config.domainName}` });
  }
}
