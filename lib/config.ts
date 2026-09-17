export type SiteMode = "full" | "content";

export interface SiteConfig {
  domainName?: string;
  hostedZoneId?: string;
  siteDir: string;
  stackName: string;
  region: string;
  mode: SiteMode;
  cloudFrontDistributionId?: string;
  s3BucketName?: string;
  s3BucketRegion: string;
}

const DEFAULTS = {
  siteDir: "www",
  stackName: "s3-cloudfront-site",
  region: "us-east-1",
} as const;

export function loadConfig(): SiteConfig {
  const distributionId = process.env.CLOUDFRONT_DISTRIBUTION_ID;
  const bucketName = process.env.S3_BUCKET_NAME;

  if (Boolean(distributionId) !== Boolean(bucketName)) {
    throw new Error(
      "CLOUDFRONT_DISTRIBUTION_ID y S3_BUCKET_NAME deben definirse juntas para el modo content."
    );
  }

  const mode: SiteMode = distributionId && bucketName ? "content" : "full";

  if (mode === "full") {
    const missing: string[] = [];
    for (const key of ["DOMAIN_NAME", "HOSTED_ZONE_ID"] as const) {
      if (!process.env[key]) {
        missing.push(key);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `Variables de entorno requeridas: ${missing.join(", ")}. Revisa .env.example.`
      );
    }
    const region = process.env.REGION ?? DEFAULTS.region;
    if (region !== "us-east-1") {
      throw new Error(
        "REGION debe ser 'us-east-1' (requerido por ACM para CloudFront)."
      );
    }
    return {
      domainName: process.env.DOMAIN_NAME as string,
      hostedZoneId: process.env.HOSTED_ZONE_ID as string,
      siteDir: process.env.SITE_DIR ?? DEFAULTS.siteDir,
      stackName: process.env.STACK_NAME ?? DEFAULTS.stackName,
      region,
      mode,
      s3BucketRegion: DEFAULTS.region,
    };
  }

  return {
    siteDir: process.env.SITE_DIR ?? DEFAULTS.siteDir,
    stackName: process.env.STACK_NAME ?? DEFAULTS.stackName,
    region: process.env.REGION ?? DEFAULTS.region,
    mode,
    cloudFrontDistributionId: distributionId,
    s3BucketName: bucketName,
    s3BucketRegion:
      process.env.S3_BUCKET_REGION ?? process.env.REGION ?? DEFAULTS.region,
  };
}
