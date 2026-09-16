# Modo "solo-contenido" (distribución existente) — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer flexible el deploy del stack CDK para que, si ya existe una distribución CloudFront del dominio, solo suba `SITE_DIR` a un bucket S3 existente y ejecute la invalidación `/*`, sin crear recursos nuevos.

**Architecture:** `loadConfig()` deriva un `mode: "full" | "content"` según env vars (`CLOUDFRONT_DISTRIBUTION_ID` + `S3_BUCKET_NAME`, juntas o ninguna). `SiteStack` ramifica: en modo `content` importa el bucket y la distribución existentes y crea solo el `BucketDeployment` (subida + invalidación); en modo `full` conserva el comportamiento actual sin cambios.

**Tech Stack:** AWS CDK v2 (TypeScript), dotenv. Archivos: `lib/config.ts`, `lib/site-stack.ts`, `.env.example`, `README.md`, `TESTING.md`, `AGENTS.md`.

**Spec:** `docs/superpowers/specs/2026-09-17-content-only-deploy-mode-design.md`

> **Nota de verificación:** el proyecto carga `.env` automáticamente (dotenv con `override: true`), que **sobreescribe** las variables exportadas y fija `STACK_NAME`/`DOMAIN_NAME`/`SITE_DIR` actuales. Para que los comandos de verificación sean deterministas, mueve temporalmente `.env` fuera del repo antes de sintetizar y restáuralo al terminar:
> ```bash
> mv .env .env.bak
> # ... comandos de verificación ...
> mv .env.bak .env
> ```

---

## File Structure

| Archivo | Cambio |
|---|---|
| `lib/config.ts` | `SiteMode`, nuevos campos en `SiteConfig`, validación de mezcla, guardia `REGION` solo en modo full |
| `lib/site-stack.ts` | Rama `mode === "content"` (bucket + distribución importados, solo BucketDeployment); modo full extraído a `buildFullStack` |
| `.env.example` | Documentar `CLOUDFRONT_DISTRIBUTION_ID`, `S3_BUCKET_NAME`, `S3_BUCKET_REGION` |
| `README.md` | Tabla de config + sección del modo content |
| `TESTING.md` | Caso de prueba del modo content |
| `AGENTS.md` | Mención del modo content |

---

### Task 1: `lib/config.ts` + `lib/site-stack.ts` — modo y rama content

> Las dos tareas originales se fusionan porque son un cambio acoplado: hacer `domainName`/`hostedZoneId` opcionales en `SiteConfig` rompe el typecheck de `site-stack.ts` hasta que se añade la rama `content`. Se aplican juntas para que el repo quede en estado verde en cada commit.

**Files:**
- Modify: `lib/config.ts` (reemplazar contenido completo)
- Modify: `lib/site-stack.ts` (reemplazar contenido completo)

- [ ] **Step 1: Reemplazar `lib/config.ts`**

```typescript
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
```

- [ ] **Step 2: Reemplazar `lib/site-stack.ts`**

```typescript
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
```

- [ ] **Step 3: Verificar tipos**

Run: `npm run typecheck`
Expected: PASS (exit 0).

- [ ] **Step 4: Verificar synth en modo full**

Run: `DOMAIN_NAME=example.com HOSTED_ZONE_ID=Z000000000000000000000000000 npm run synth`
Expected: éxito; template con `AWS::S3::Bucket`, `AWS::CloudFront::OriginAccessControl`, `AWS::CertificateManager::Certificate`, `AWS::CloudFront::Distribution`, 2 `AWS::Route53::RecordSet` y `Custom::CDKBucketDeployment`.

- [ ] **Step 5: Verificar el error de mezcla**

Run: `DOMAIN_NAME=example.com HOSTED_ZONE_ID=Z000000000000000000000000000 CLOUDFRONT_DISTRIBUTION_ID=EN9ZLJHO8WF4X npm run synth`
Expected: falla (exit ≠ 0) con `CLOUDFRONT_DISTRIBUTION_ID y S3_BUCKET_NAME deben definirse juntas para el modo content.`

- [ ] **Step 6: Verificar synth en modo content**

Run: `CLOUDFRONT_DISTRIBUTION_ID=EN9ZLJHO8WF4X S3_BUCKET_NAME=mi-bucket SITE_DIR=www npm run synth`
Expected: éxito; template en `cdk.out/s3-cloudfront-site.template.json`. Confirmar contenido:

```bash
grep -c "AWS::S3::Bucket\b" cdk.out/s3-cloudfront-site.template.json          # 0
grep -c "AWS::CloudFront::Distribution\b" cdk.out/s3-cloudfront-site.template.json  # 0
grep -c "AWS::CertificateManager::Certificate" cdk.out/s3-cloudfront-site.template.json  # 0
grep -c "AWS::Route53::RecordSet" cdk.out/s3-cloudfront-site.template.json    # 0
grep -c "Custom::CDKBucketDeployment" cdk.out/s3-cloudfront-site.template.json  # ≥ 1
grep -c "EN9ZLJHO8WF4X" cdk.out/s3-cloudfront-site.template.json              # ≥ 1 (DistributionId)
```

- [ ] **Step 7: Commit**

```bash
git add lib/config.ts lib/site-stack.ts
git commit -m "feat: add content-only deploy mode"
```

---

### Task 2: `.env.example` — documentar nuevas variables

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Agregar las variables del modo content**

Contenido completo esperado de `.env.example`:

```
# Requeridas
DOMAIN_NAME=misitio.com
HOSTED_ZONE_ID=Z1234567890ABC
# Opcionales
SITE_DIR=www
STACK_NAME=s3-cloudfront-site
REGION=us-east-1 # ACM para CloudFront exige us-east-1

# Modo content (opcional): si ya existe la distribucion CloudFront, el deploy solo
# sube SITE_DIR al bucket indicado y ejecuta la invalidacion "/*". Ambas deben
# definirse juntas; si estan presentes, DOMAIN_NAME y HOSTED_ZONE_ID no se usan.
CLOUDFRONT_DISTRIBUTION_ID=
S3_BUCKET_NAME=
S3_BUCKET_REGION=us-east-1
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: document content-mode env vars in .env.example"
```

---

### Task 3: Documentación — README, TESTING, AGENTS

**Files:**
- Modify: `README.md`
- Modify: `TESTING.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: `README.md` — agregar filas a la tabla de configuración**

En la sección `## Configuración`, reemplazar el bloque de tabla por:

```markdown
| Variable | Requerida | Default | Descripción |
|---|---|---|---|
| `DOMAIN_NAME` | full | — | Dominio del sitio (apex) |
| `HOSTED_ZONE_ID` | full | — | ID de la Hosted Zone pública |
| `CLOUDFRONT_DISTRIBUTION_ID` | content | — | ID de una distribución existente (modo content) |
| `S3_BUCKET_NAME` | content | — | Bucket S3 existente al que subir (modo content) |
| `S3_BUCKET_REGION` | content | `REGION` | Región del bucket existente |
| `SITE_DIR` | no | `www` | Carpeta con el contenido estático |
| `STACK_NAME` | no | `s3-cloudfront-site` | Nombre del stack |
| `REGION` | no | `us-east-1` | Región del stack (debe ser `us-east-1` en modo full) |

**Modos de deploy:** el stack tiene dos modos.
- **Full** (default): crea toda la infraestructura (bucket, OAC, ACM, distribución, registros A/AAAA) y publica `SITE_DIR`. Requiere `DOMAIN_NAME` y `HOSTED_ZONE_ID`.
- **Content**: si ya existe una distribución CloudFront del dominio, solo sube `SITE_DIR` al bucket `S3_BUCKET_NAME` y ejecuta la invalidación `/*` en `CLOUDFRONT_DISTRIBUTION_ID`. No crea ningún recurso nuevo. `CLOUDFRONT_DISTRIBUTION_ID` y `S3_BUCKET_NAME` deben definirse **juntas**.
```

- [ ] **Step 2: `TESTING.md` — agregar sección del modo content**

Agregar después de la sección `## 8. Prueba de actualización (redeploy)`:

```markdown
## 8.bis Modo content (distribución existente)

Cuando ya existe una distribución CloudFront para el dominio, el deploy solo sube el contenido e invalida:

```bash
CLOUDFRONT_DISTRIBUTION_ID=<DistributionId> S3_BUCKET_NAME=<bucket-origen> npm run synth
```

Esperado: el template solo contiene `Custom::CDKBucketDeployment` (sin `AWS::S3::Bucket`, sin `AWS::CloudFront::Distribution`, sin ACM ni Route 53).

Para desplegar:

```bash
CLOUDFRONT_DISTRIBUTION_ID=<DistributionId> S3_BUCKET_NAME=<bucket-origen> npm run deploy
```

Pruebas negativas:
- Definir solo `CLOUDFRONT_DISTRIBUTION_ID` (sin `S3_BUCKET_NAME`) → error `CLOUDFRONT_DISTRIBUTION_ID y S3_BUCKET_NAME deben definirse juntas`.
- En modo content no hace falta `DOMAIN_NAME`/`HOSTED_ZONE_ID`.
```

- [ ] **Step 3: `AGENTS.md` — mención del modo content**

En la sección `## Toolchain and commands`, agregar la línea:

```markdown
- Two deploy modes (env-driven): `full` creates all infra (default); `content` only uploads `SITE_DIR` and invalidates an existing distribution (set `CLOUDFRONT_DISTRIBUTION_ID` and `S3_BUCKET_NAME`).
```

- [ ] **Step 4: Verificación**

Run: `npm run typecheck` → PASS
Run: `DOMAIN_NAME=example.com HOSTED_ZONE_ID=Z000000000000000000000000000 npm run synth` → éxito
Run: `CLOUDFRONT_DISTRIBUTION_ID=EN9ZLJHO8WF4X S3_BUCKET_NAME=mi-bucket SITE_DIR=www npm run synth` → éxito

- [ ] **Step 5: Commit**

```bash
git add README.md TESTING.md AGENTS.md
git commit -m "docs: document content-only deploy mode"
```

---

### Task 4: Verificación final del feature

**Files:**
- Modify: ninguno (verificación)

- [ ] **Step 1: Verificación completa**

Run: `npm run typecheck` → PASS
Run: `DOMAIN_NAME=example.com HOSTED_ZONE_ID=Z000000000000000000000000000 npm run synth` → PASS (modo full)
Run: `CLOUDFRONT_DISTRIBUTION_ID=EN9ZLJHO8WF4X S3_BUCKET_NAME=mi-bucket SITE_DIR=www npm run synth` → PASS (modo content)
Run: `CLOUDFRONT_DISTRIBUTION_ID=EN9ZLJHO8WF4X npm run synth` → falla con error de mezcla (exit ≠ 0)

- [ ] **Step 2: Confirmar árbol limpio**

Run: `git status --short`
Expected: sin cambios de archivos trackeados (solo untracked conocidos si los hay).

- [ ] **Step 3: Reporte**

Confirmar con el resultado de los cuatro comandos del Step 1.