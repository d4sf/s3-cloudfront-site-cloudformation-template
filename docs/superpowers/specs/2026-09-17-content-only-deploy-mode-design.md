# Spec: Modo "solo-contenido" — deploy flexible con distribución CloudFront existente

- **Fecha:** 2026-09-17
- **Estado:** Aprobado para implementación
- **Base:** `docs/superpowers/specs/2026-09-16-s3-cloudfront-cdk-static-site-design.md`

## 1. Contexto y objetivo

El stack actual crea siempre infraestructura completa (bucket S3 + OAC + ACM + distribución CloudFront + registros A/AAAA + deploy de contenido). En cuentas donde **ya existe** una distribución CloudFront para el dominio, ese comportamiento choca: la nueva distribución no puede usar el mismo alias (`CNAMEAlreadyExists`) y el registro A duplicado bloquea a `AWS::Route53::RecordSet`.

Objetivo: hacer el deploy **flexible** para que, si ya existe la distribución, el stack **solo suba los archivos a S3 y ejecute la invalidación en CloudFront**, sin crear ningún recurso nuevo.

### Criterios de éxito

1. Con `CLOUDFRONT_DISTRIBUTION_ID` y `S3_BUCKET_NAME` en el entorno, `npm run deploy` sube `SITE_DIR` al bucket indicado y crea la invalidación `/*` en la distribución indicada.
2. En ese modo, el template sintetizado **no contiene** `AWS::S3::Bucket`, `AWS::CloudFront::Distribution`, `AWS::CertificateManager::Certificate` ni `AWS::Route53::RecordSet` (solo el custom resource de `BucketDeployment` y sus dependencias).
3. Sin esas variables, el comportamiento actual (stack completo) no cambia.
4. Configuración inválida (una sola de las dos variables) falla rápido con mensaje claro.

## 2. Decisiones de diseño

- **Enfoque:** modo "content" dentro del mismo stack, seleccionado por env vars explícitas (`CLOUDFRONT_DISTRIBUTION_ID` + `S3_BUCKET_NAME`). Se descarta auto-detección por lookup (evita credenciales en synth y casos borde).
- **Bucket de subida:** el bucket origen existente de la distribución (pasado por `S3_BUCKET_NAME`). No se crea ni modifica su política.
- **Distribución:** se importa por ID. `BucketDeployment` solo consume `distributionId` para la invalidación (verificado en el código de `aws-cdk-lib`), por lo que no se necesita el domainName real.
- **Región del bucket:** `S3_BUCKET_REGION` opcional (default `REGION`), porque el bucket existente puede vivir fuera de `us-east-1`.
- **Un solo comando:** `npm run deploy` unificado; el modo se deriva del entorno en synth.

## 3. Cambios en `lib/config.ts`

### Nuevas variables de entorno (opcionales)

| Variable | Modo full | Modo content | Default |
|---|---|---|---|
| `DOMAIN_NAME` | requerida | no requerida | — |
| `HOSTED_ZONE_ID` | requerida | no requerida | — |
| `CLOUDFRONT_DISTRIBUTION_ID` | ausente | requerida | — |
| `S3_BUCKET_NAME` | ausente | requerida | — |
| `S3_BUCKET_REGION` | — | opcional | `REGION` |
| `SITE_DIR` / `STACK_NAME` / `REGION` | igual que hoy | igual | — |

### `SiteConfig` y validación

- `SiteConfig` gana: `mode: "full" | "content"`, `cloudFrontDistributionId?: string`, `s3BucketName?: string`, `s3BucketRegion: string`.
- `mode = "content"` si ambas vars están presentes; `mode = "full"` si ninguna; **error** si solo una (`CLOUDFRONT_DISTRIBUTION_ID y S3_BUCKET_NAME deben definirse juntas`).
- En modo content no se exigen `DOMAIN_NAME`/`HOSTED_ZONE_ID`.
- La guardia `REGION === "us-east-1"` aplica **solo en modo full** (en content la región la define `S3_BUCKET_REGION`).

## 4. Cambios en `lib/site-stack.ts`

Constructor con rama `if (config.mode === "content")`:

**Modo content:**
1. Bucket importado: `s3.Bucket.fromBucketAttributes(this, "SiteBucket", { bucketName: config.s3BucketName, region: config.s3BucketRegion })` (la cuenta se resuelve a la del stack; `account` no se pasa explícitamente).
2. Distribución importada: `cloudfront.Distribution.fromDistributionAttributes(this, "SiteDistribution", { distributionId: config.cloudFrontDistributionId, domainName: "placeholder.example.com" })`. El `domainName` es un placeholder: `BucketDeployment` solo consume `distributionId` (verificado en el código de `aws-cdk-lib`). Se descarta una mini-clase que implemente `IDistribution`, porque exigiría implementar también `IConstruct`/`IEnvironmentAware` (más código y fricción que un placeholder).
3. `BucketDeployment`: `sources: [s3deploy.Source.asset(config.siteDir)]`, `destinationBucket: <bucket importado>`, `distribution: <distribución importada>`, `distributionPaths: ["/*"]`, `prune: false`. El `prune: false` evita que el deploy **borre objetos del bucket existente que no estén en `SITE_DIR`** (el bucket no pertenece al stack; en modo full el bucket es del stack y `prune` queda en su default `true`).
4. Outputs: `BucketName` y `DistributionId` (valores de las env vars).

**Modo full:** comportamiento actual sin cambios (bucket + OAC + ACM + distribución + A/AAAA + BucketDeployment).

### Notas

- El rol del custom resource obtiene `s3:PutObject`/`s3:DeleteObject` sobre el bucket importado vía `grantReadWrite`, y `cloudfront:CreateInvalidation`/`GetInvalidation` (lo agrega `BucketDeployment`).
- No se toca la bucket policy existente ni el origen de la distribución.

## 5. Flujo de deploy y verificación

```bash
npm run typecheck
# modo content:
CLOUDFRONT_DISTRIBUTION_ID=EN9ZLJHO8WF4X S3_BUCKET_NAME=mi-bucket npm run synth
# modo full (sin cambios):
npm run synth
```

Esperado en modo content: template con solo `Custom::CDKBucketDeployment` + Lambda + layer (`AWS::S3::Bucket` = 0, `AWS::CloudFront::Distribution` = 0, sin ACM ni Route53).

**Pruebas de validación de config:**
- Solo `CLOUDFRONT_DISTRIBUTION_ID` → error de mezcla.
- Modo content sin `DOMAIN_NAME`/`HOSTED_ZONE_ID` → OK.
- `REGION` no bloquea en modo content.

**Edge cases:**
- Bucket o distribución inexistentes → el custom resource falla en deploy con error de AWS (sin validación previa; aceptable).
- El bucket debe estar en la cuenta que despliega (o acceso cross-account al rol).

## 6. Documentación a actualizar

- `.env.example`: nuevas variables comentadas.
- `README.md`: tabla de Configuración + sección del modo content.
- `TESTING.md`: caso de prueba del modo content.
- `AGENTS.md`: mención del modo content en la sección de comandos.

## 7. Fuera de alcance (YAGNI)

- Auto-detección de la distribución por alias (lookup).
- Actualizar el origen de la distribución existente hacia un bucket nuevo.
- Soporte `www.` / aliases múltiples en el modo content.
- Múltiples caminos de invalidación configurables (siempre `/*`).