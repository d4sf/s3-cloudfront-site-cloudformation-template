# Sitio estático S3 + CloudFront (CDK) — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir un proyecto AWS CDK (TypeScript) que cree y despliegue un sitio web estático en S3 + CloudFront a partir de un dominio, con DNS automático vía Route 53 y configuración por variables de entorno (sin credenciales hardcodeadas).

**Architecture:** Un stack CDK único en `us-east-1` que crea: bucket S3 privado, Origin Access Control (OAC), certificado ACM con validación DNS automática en la Hosted Zone existente, distribución CloudFront con cache policy moderno, registros A/AAAA alias hacia CloudFront, y un `BucketDeployment` que sincroniza `SITE_DIR` e invalida la caché. La configuración se lee y valida en `lib/config.ts` desde variables de entorno; las credenciales AWS provienen de la cadena estándar del SDK.

**Tech Stack:** AWS CDK v2 (`aws-cdk-lib`, `constructs`), TypeScript, Node.js 18+. Scripts npm: `synth`, `deploy`, `diff`, `destroy`, `typecheck`.

**Spec:** `docs/superpowers/specs/2026-09-16-s3-cloudfront-cdk-static-site-design.md`

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `package.json` | Dependencias y scripts npm |
| `tsconfig.json` | Configuración TypeScript |
| `cdk.json` | Entrypoint de la app CDK |
| `.gitignore` | Excluir `node_modules/`, `cdk.out/`, `.env` |
| `.env.example` | Documenta variables de entorno (sin valores) |
| `www/index.html` | Contenido estático de ejemplo (sitio de prueba) |
| `lib/config.ts` | Lee y valida variables de entorno → `SiteConfig` |
| `lib/site-stack.ts` | Define todos los recursos de infraestructura |
| `bin/site-stack.ts` | Entrypoint: `App` + instancia `SiteStack` |
| `README.md` | Setup, variables, comandos, troubleshooting |
| `AGENTS.md` | Actualizar sección de comandos/herramientas |
| `plan_implementacion_aws.md:Zone.Identifier` | Eliminar (basura de Windows ADS) |

---

### Task 1: Scaffold del proyecto

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `cdk.json`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Crear `package.json`**

```json
{
  "name": "s3-cloudfront-site-cloudformation-template",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "synth": "cdk synth",
    "deploy": "cdk deploy --all",
    "diff": "cdk diff",
    "destroy": "cdk destroy --all",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "aws-cdk-lib": "^2.150.0",
    "constructs": "^10.3.0"
  },
  "devDependencies": {
    "aws-cdk": "^2.150.0",
    "ts-node": "^10.9.0",
    "source-map-support": "^0.5.21",
    "typescript": "^5.5.0",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 2: Crear `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "moduleResolution": "node",
    "strict": true,
    "noImplicitAny": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "inlineSourceMap": true,
    "declaration": true,
    "outDir": "cdk.out"
  },
  "exclude": ["node_modules", "cdk.out"]
}
```

- [ ] **Step 3: Crear `cdk.json`**

```json
{
  "app": "npx ts-node bin/site-stack.ts",
  "watch": {
    "include": ["**"],
    "exclude": ["README.md", "cdk*.json", "**/*.d.ts", "**/*.js", "tsconfig.json", "package*.json", "node_modules", "**/node_modules/**", "www/**"]
  },
  "context": {
    "@aws-cdk/aws-lambda:recognizeLayerVersion": true,
    "@aws-cdk/core:checkSecretUsage": true,
    "@aws-cdk/core:target-partitions": ["aws", "aws-cn"]
  }
}
```

- [ ] **Step 4: Crear `.gitignore`**

```
node_modules/
cdk.out/
.env
*.tsbuildinfo
*.log
```

- [ ] **Step 5: Crear `.env.example`**

```
# Requeridas
DOMAIN_NAME=misitio.com
HOSTED_ZONE_ID=Z1234567890ABC
# Opcionales
SITE_DIR=www
STACK_NAME=s3-cloudfront-site
REGION=us-east-1
```

- [ ] **Step 6: Instalar dependencias**

Run: `npm install`
Expected: crea `package-lock.json` y `node_modules/` sin errores.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json cdk.json .gitignore .env.example
git commit -m "chore: scaffold AWS CDK project"
```

---

### Task 2: Contenido estático de ejemplo

**Files:**
- Create: `www/index.html`

- [ ] **Step 1: Crear `www/index.html`**

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Mi Sitio</title>
</head>
<body>
  <h1>Hola desde S3 + CloudFront</h1>
</body>
</html>
```

> `SITE_DIR` apunta por defecto a `www/`. `cdk synth` falla si la carpeta no existe (staging de assets), así que este archivo es obligatorio.

- [ ] **Step 2: Commit**

```bash
git add www/index.html
git commit -m "feat: add sample static site content"
```

---

### Task 3: `lib/config.ts` — configuración por variables de entorno

**Files:**
- Create: `lib/config.ts`

- [ ] **Step 1: Escribir `lib/config.ts`**

```typescript
export interface SiteConfig {
  domainName: string;
  hostedZoneId: string;
  siteDir: string;
  stackName: string;
  region: string;
}

const DEFAULTS = {
  siteDir: "www",
  stackName: "s3-cloudfront-site",
  region: "us-east-1",
} as const;

export function loadConfig(): SiteConfig {
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
  return {
    domainName: process.env.DOMAIN_NAME as string,
    hostedZoneId: process.env.HOSTED_ZONE_ID as string,
    siteDir: process.env.SITE_DIR ?? DEFAULTS.siteDir,
    stackName: process.env.STACK_NAME ?? DEFAULTS.stackName,
    region: process.env.REGION ?? DEFAULTS.region,
  };
}
```

- [ ] **Step 2: Verificar que falla sin variables**

Run: `npm run typecheck`
Expected: PASS (el archivo compila).

Run: `node -e "require('./lib/config').loadConfig()"` (TypeScript no se ejecuta con node directo; verificar con typecheck es suficiente aquí).
Nota: la validación en runtime se verifica en el Task 6 vía `cdk synth` sin variables.

- [ ] **Step 3: Commit**

```bash
git add lib/config.ts
git commit -m "feat: add environment-based config loader"
```

---

### Task 4: `lib/site-stack.ts` — recursos de infraestructura

**Files:**
- Create: `lib/site-stack.ts`

- [ ] **Step 1: Escribir `lib/site-stack.ts`**

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

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      "HostedZone",
      {
        hostedZoneId: config.hostedZoneId,
        zoneName: config.domainName,
      }
    );

    const certificate = new acm.Certificate(this, "SiteCertificate", {
      domainName: config.domainName,
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
      domainNames: [config.domainName],
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
      recordName: config.domainName,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });

    new route53.AaaaRecord(this, "SiteAliasRecordAAAA", {
      zone: hostedZone,
      recordName: config.domainName,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
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

> Detalles: `origins.S3BucketOrigin.withOriginAccessControl(bucket)` crea el OAC moderno (`AWS::CloudFront::OriginAccessControl`) y la bucket policy que restringe `s3:GetObject` solo a CloudFront. `HostedZone.fromHostedZoneAttributes` aporta `zoneName` (necesario para que los registros alias resuelvan su FQDN; `fromHostedZoneId` falla en synth). `BucketDeployment` sube el contenido y crea la invalidación `/*` automáticamente.

- [ ] **Step 2: Verificar tipos**

Run: `npm run typecheck`
Expected: PASS (sin errores).

- [ ] **Step 3: Commit**

```bash
git add lib/site-stack.ts
git commit -m "feat: add S3 + CloudFront + Route53 site stack"
```

---

### Task 5: `bin/site-stack.ts` — entrypoint de la app

**Files:**
- Create: `bin/site-stack.ts`

- [ ] **Step 1: Escribir `bin/site-stack.ts`**

```typescript
#!/usr/bin/env node
import "source-map-support/register";
import { App } from "aws-cdk-lib";
import { loadConfig } from "../lib/config";
import { SiteStack } from "../lib/site-stack";

const app = new App();
const config = loadConfig();

new SiteStack(app, config.stackName, config, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: config.region,
  },
});

app.synth();
```

- [ ] **Step 2: Verificar tipos**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add bin/site-stack.ts
git commit -m "feat: add CDK app entrypoint"
```

---

### Task 6: Verificación — typecheck + synth

**Files:**
- Modify: ninguno (verificación)

- [ ] **Step 1: Verificar que `synth` falla sin variables de entorno**

Run: `npm run synth`
Expected: FAIL con el mensaje `Variables de entorno requeridas: DOMAIN_NAME, HOSTED_ZONE_ID. Revisa .env.example.` (valida la lógica de `config.ts` en runtime).

- [ ] **Step 2: Generar el template con variables dummy**

Run: `DOMAIN_NAME=example.com HOSTED_ZONE_ID=Z000000000000000000000000000 npm run synth`
Expected: `Successfully synthesized to ...cdk.out` y salida con el stack `s3-cloudfront-site`.

- [ ] **Step 3: Inspeccionar el template generado**

Run: `ls cdk.out/*.template.json`
Expected: existe `cdk.out/s3-cloudfront-site.template.json`. Verificar con `grep -c` que no contenga credenciales ni account IDs hardcodeados:
Run: `grep -E "AKIA|secret|AccessKey|123456789012" cdk.out/s3-cloudfront-site.template.json`
Expected: sin coincidencias (o solo `Ref`/pseudo-parámetros).

- [ ] **Step 4: Commit**

No hay cambios de código. Solo confirmar que el árbol está limpio:
Run: `git status`
Expected: `nothing to commit, working tree clean` (excepto `cdk.out/` que está en `.gitignore`).

---

### Task 7: `README.md`

**Files:**
- Create: `README.md`

- [ ] **Step 1: Escribir `README.md`**

```markdown
# Sitio estático en AWS S3 + CloudFront (CDK)

Plantilla AWS CDK para crear y desplegar un sitio web estático en S3 + CloudFront a partir de un dominio, con DNS automático en Route 53.

## Requisitos

- Node.js 18+
- Cuenta AWS con credenciales configuradas (cadena estándar del SDK: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` o `AWS_PROFILE`)
- Una Hosted Zone pública existente en Route 53 (misma cuenta) para el dominio
- El certificado ACM se crea y valida automáticamente; todo el stack corre en `us-east-1`

## Configuración

Copia `.env.example` a `.env` (o exporta las variables) y completa:

| Variable | Requerida | Default | Descripción |
|---|---|---|---|
| `DOMAIN_NAME` | sí | — | Dominio del sitio (apex) |
| `HOSTED_ZONE_ID` | sí | — | ID de la Hosted Zone pública |
| `SITE_DIR` | no | `www` | Carpeta con el contenido estático |
| `STACK_NAME` | no | `s3-cloudfront-site` | Nombre del stack |
| `REGION` | no | `us-east-1` | Región del stack |

Carga opcional del `.env`: `set -a; source .env; set +a`

## Uso

```bash
npm install
cdk bootstrap aws://<ACCOUNT>/<REGION>   # una sola vez por cuenta/región
npm run synth                            # genera el template sin tocar AWS
npm run deploy                           # crea/actualiza el stack y publica el sitio
npm run diff                             # previsualiza cambios
npm run destroy                          # elimina el stack (el bucket se conserva)
```

## Troubleshooting

- **`Variables de entorno requeridas`**: exporta `DOMAIN_NAME` y `HOSTED_ZONE_ID`.
- **Stack en `CREATE_IN_PROGRESS` varios minutos**: es la validación del certificado ACM; el deploy espera.
- **Hosted Zone inexistente**: el lookup falla en `cdk synth` con error explícito; verifica el ID.
- **Invalidar caché sin re-deploy**: `aws cloudfront create-invalidation --distribution-id <DistributionId> --paths "/*"`.
- **Verificación post-deploy**: `curl -I https://${DOMAIN_NAME}` debe responder con `Server: CloudFront`.

## Seguridad

- Credenciales y account IDs nunca se hardcodean; se resuelven por la cadena del SDK y pseudo-parámetros en el deploy.
- El bucket es privado; el único acceso es vía CloudFront con Origin Access Control.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup and deploy instructions"
```

---

### Task 8: Actualizar `AGENTS.md` y limpiar archivo basura

**Files:**
- Modify: `AGENTS.md`
- Delete: `plan_implementacion_aws.md:Zone.Identifier`

- [ ] **Step 1: Reemplazar `AGENTS.md`**

```markdown
# AGENTS.md

## Repo state
- AWS CDK (TypeScript) project: a single stack that provisions a private S3 bucket, CloudFront distribution with OAC, ACM certificate (DNS validation), Route 53 records, and deploys static content.
- Everything is configured via environment variables (see `.env.example`); never hardcode AWS credentials or account IDs.
- The stack runs in `us-east-1` (required by ACM for CloudFront).

## Toolchain and commands
- Node.js 18+ and npm. Install once: `npm install`.
- Local verification (no AWS access required):
  - `npm run typecheck` — TypeScript type check
  - `npm run synth` — generates the CloudFormation template into `cdk.out/` (requires `DOMAIN_NAME` and `HOSTED_ZONE_ID` env vars, e.g. `DOMAIN_NAME=example.com HOSTED_ZONE_ID=Z00000000000000000000 npm run synth`)
- Deploy (requires AWS credentials and an existing public Route 53 hosted zone):
  - `cdk bootstrap aws://<ACCOUNT>/<REGION>` — once per account/region
  - `npm run deploy` — create/update the stack and publish `SITE_DIR`
  - `npm run diff` — preview changes
  - `npm run destroy` — teardown (bucket content is retained, `RETAIN`)
- Key files: `bin/site-stack.ts` (entrypoint), `lib/site-stack.ts` (resources), `lib/config.ts` (env config), `www/` (static content).
- Source of truth for design decisions: `docs/superpowers/specs/2026-09-16-s3-cloudfront-cdk-static-site-design.md`.
```

- [ ] **Step 2: Eliminar el archivo basura de Windows ADS**

Run: `rm "plan_implementacion_aws.md:Zone.Identifier"`
Expected: el archivo deja de existir (`ls plan_implementacion_aws.md*` solo muestra `plan_implementacion_aws.md`).

- [ ] **Step 3: Verificación final**

Run: `npm run typecheck` → PASS
Run: `DOMAIN_NAME=example.com HOSTED_ZONE_ID=Z000000000000000000000000000 npm run synth` → `Successfully synthesized`

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs: update AGENTS.md with CDK toolchain commands"
```

---

## Post-plan: despliegue real (manual, requiere AWS)

Verificación opcional con credenciales reales y dominio propio:

```bash
cdk bootstrap aws://<ACCOUNT>/<REGION>
DOMAIN_NAME=midominio.com HOSTED_ZONE_ID=ZXXXXXXXXXXXX npm run deploy
curl -I https://midominio.com
```

No forma parte de los commits; queda documentado en `README.md`.