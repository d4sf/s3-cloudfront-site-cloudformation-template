# Spec: Template CloudFormation/CDK para sitio estático en S3 + CloudFront

- **Fecha:** 2026-09-16
- **Estado:** Aprobado para implementación
- **Fuente:** `plan_implementacion_aws.md`

## 1. Contexto y objetivo

El repositorio actual es un scaffold sin código (`opencode.json`, `AGENTS.md`, `plan_implementacion_aws.md`). El objetivo es entregar un proyecto que permita **crear y desplegar un sitio web estático en S3 + CloudFront** a partir de un nombre de dominio, con el DNS resuelto automáticamente y sin exponer credenciales ni identificadores sensibles en el repositorio.

El `plan_implementacion_aws.md` plantea un template CloudFormation crudo + orquestador TypeScript. Tras el análisis (ver §3), se decide implementar con **AWS CDK (TypeScript)**, que corrige los problemas del plan: re-deploy idempotente, validación ACM automática vía Route 53, cache policy moderno, sync de contenido con invalidación, y configuración por variables de entorno.

### Criterios de éxito

1. `cdk deploy` (con las variables de entorno cargadas) crea toda la infraestructura: bucket S3 privado, OAC, certificado ACM validado, distribución CloudFront, registros A/AAAA en Route 53, y publica el contenido de `SITE_DIR`.
2. El sitio responde en `https://<DOMAIN_NAME>` con redirección a HTTPS y contenido desde el bucket privado vía CloudFront.
3. Ninguna credencial, access key, secret o account ID está hardcodeado en el repositorio ni aparece en los artefactos.
4. El dominio es el único input de negocio: cambiar `DOMAIN_NAME` (y `HOSTED_ZONE_ID`) crea el conjunto completo de recursos.

## 2. Decisiones de diseño

- **Enfoque:** AWS CDK v2 (TypeScript). Se descarta el template CFN crudo + script Node del plan por las razones de §3.
- **Región única:** `us-east-1` (default). Requerida por ACM para CloudFront; evita stacks cross-región.
- **DNS automático:** Route 53 gestiona la validación ACM (CNAME) y el apuntado del dominio (alias A/AAAA a CloudFront), usando una **Hosted Zone pública existente** en la misma cuenta (se pasa su ID por entorno).
- **Dominio:** solo el apex (`DOMAIN_NAME`). Sin `www.` ni aliases adicionales (YAGNI; el plan no lo requiere).
- **Contenido:** carpeta local `SITE_DIR` sincronizada con invalidación automática de caché.
- **Secrets:** variables de entorno + cadena de credenciales estándar del SDK. Sin `dotenv`.

## 3. Correcciones al plan original

| Problema en `plan_implementacion_aws.md` | Corrección |
|---|---|
| `DOMAIN_NAME` y `REGION` hardcodeados en `deploy.ts` | Config por variables de entorno leídas y validadas en `lib/config.ts` |
| Credenciales/secrets no documentados | Cadena estándar del SDK; `.env.example`; `.env` y `cdk.out` en `.gitignore` |
| Solo `CreateStackCommand`; falla en re-deploy | `cdk deploy` idempotente (create/update gestionado) |
| Validación ACM manual (CNAME "Pending Validation") | `CertificateValidation.fromDns(hostedZone)` crea los CNAME automáticamente |
| Sin registros DNS hacia CloudFront | `ARecord` + `AAAARecord` alias a la distribución |
| `ForwardedValues` deprecated | `CachePolicy.CACHING_OPTIMIZED` |
| Subida de contenido manual (nota post-deploy) | `s3_deployment.BucketDeployment` (sync + invalidación) |
| `CAPABILITY_IAM` innecesario | No aplica (CDK gestiona capabilities) |
| TypeScript + `ts-node` como toolchain | CDK requiere TypeScript de todos modos; scripts npm documentados |

## 4. Arquitectura

```
https://<DOMAIN_NAME>
        │  (Route 53: A/AAAA alias)
        ▼
   CloudFront Distribution ──OAC──► S3 Bucket (privado, BLOCK_ALL)
        │
        └── ACM Certificate (DNS validation via Route 53)
```

Flujo de datos: el bucket es privado; CloudFront accede mediante Origin Access Control con firma sigv4. La política de bucket (generada por `S3Origin`) restringe `s3:GetObject` exclusivamente a la distribución.

## 5. Estructura del proyecto

```
s3-cloudfront-site-cloudformation-template/
├── cdk.json                  # entrypoint de la app
├── package.json              # deps: aws-cdk-lib, constructs | dev: aws-cdk, typescript, @types/node
├── tsconfig.json
├── .gitignore                # node_modules/, cdk.out/, .env, *.tsbuildinfo
├── .env.example              # documenta DOMAIN_NAME, HOSTED_ZONE_ID, SITE_DIR, STACK_NAME, REGION
├── bin/
│   └── site-stack.ts         # App + instancia el Stack
└── lib/
    ├── config.ts             # lee y valida variables de entorno
    └── site-stack.ts         # define todos los recursos
```

### Scripts npm

| Script | Comando | Propósito |
|---|---|---|
| `synth` | `cdk synth` | Genera el template en `cdk.out/` sin tocar AWS |
| `deploy` | `cdk deploy --all` | Despliega/actualiza el stack |
| `diff` | `cdk diff` | Previsualiza cambios frente al stack desplegado |
| `destroy` | `cdk destroy --all` | Elimina el stack (el bucket se conserva) |
| `typecheck` | `tsc --noEmit` | Validación de tipos |

## 6. Configuración y secrets

`lib/config.ts` lee y valida las variables. Fallo rápido con mensaje claro si una requerida falta.

| Variable | Requerida | Default | Uso |
|---|---|---|---|
| `DOMAIN_NAME` | sí | — | Dominio del sitio (apex, p. ej. `misitio.com`) |
| `HOSTED_ZONE_ID` | sí | — | ID de la Hosted Zone pública existente (misma cuenta) |
| `SITE_DIR` | no | `www` | Carpeta local con el contenido estático |
| `STACK_NAME` | no | `s3-cloudfront-site` | Nombre del stack CDK |
| `REGION` | no | `us-east-1` | Región del stack |

- **Credenciales:** cadena estándar del SDK (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_PROFILE`, roles IAM). Nunca en el repo.
- **Account ID:** resuelto por CDK/pseudo-parámetros en tiempo de deploy; no se referencia en ningún archivo.
- El entorno debe exportar las variables; `.env.example` documenta nombres sin valores. Cargado opcional con `set -a; source .env; set +a`.

## 7. Recursos de infraestructura (`lib/site-stack.ts`)

1. **S3 Bucket** — privado: `blockPublicAccess: BLOCK_ALL`, `enforceSSL: true`, `removalPolicy: RETAIN`. Nombre auto-generado por CDK (evita colisiones globales).
2. **Origin Access Control** — `cloudfront.S3Origin(bucket)` crea el OAC moderno y la bucket policy que solo permite `s3:GetObject` a CloudFront.
3. **Certificado ACM** — `acm.Certificate` con `domainName: DOMAIN_NAME` y `CertificateValidation.fromDns(hostedZone)`. CDK genera los CNAME de validación en la Hosted Zone.
4. **Distribución CloudFront** — `domainNames: [DOMAIN_NAME]`, certificado ACM con `SNI_ONLY`, `defaultRootObject: index.html`, `defaultBehavior` con origen S3 vía OAC, `redirect-to-https`, `CachePolicy.CACHING_OPTIMIZED`, métodos `GET/HEAD`.
5. **Registros Route 53** — `ARecord` + `AAAARecord` alias a la distribución, sobre `HostedZone.fromHostedZoneId`.
6. **BucketDeployment** — `Source.asset(SITE_DIR)`, `destinationBucket`, `distribution` y `distributionPaths: ['/*']`. Ejecuta solo cuando cambia el hash del contenido.

### Outputs del stack

- `BucketName`, `DistributionDomain`, `DistributionId`, `CertificateArn`, `SiteUrl` (`https://<DOMAIN_NAME>`).

## 8. Flujo de despliegue

```bash
npm install
cdk bootstrap aws://<ACCOUNT>/<REGION>   # una vez por cuenta/región
# exportar DOMAIN_NAME, HOSTED_ZONE_ID, SITE_DIR, (opcional STACK_NAME/REGION)
npm run deploy
```

El despliegue espera la validación ACM (varios minutos) antes de crear CloudFront; es normal que tarde.

## 9. Edge cases y errores

- **Config incompleta:** `config.ts` aborta con el listado de variables faltantes.
- **Hosted Zone inexistente u otra cuenta:** el lookup falla en `cdk synth` con error explícito. Asunción: zona pública en la misma cuenta.
- **Validación ACM lenta:** el deploy espera; no es un fallo.
- **Re-deploy:** idempotente; el contenido solo se re-sube si cambió.
- **Teardown:** `npm run destroy` elimina el stack; el bucket se conserva por `RETAIN` (seguridad del contenido).
- **Invalidación puntual sin re-deploy:** `aws cloudfront create-invalidation --distribution-id <id> --paths "/*"`.

## 10. Verificación y pruebas

1. `npm run typecheck` — valida tipos.
2. `npm run synth` — confirma que el stack compila (sin tocar AWS).
3. Post-deploy: `curl -I https://${DOMAIN_NAME}` debe responder `200`/`301` con contenido del bucket y `Server: CloudFront`.
4. Revisar outputs del stack.

No se contemplan pruebas unitarias de constructos; el alcance de este repositorio es un template reutilizable. Si en el futuro se agrega CI, la verificación mínima es `typecheck` + `synth`.

## 11. Fuera de alcance (YAGNI)

- Soporte `www.` o aliases múltiples.
- Múltiples regiones / replicación.
- WAF, CloudFront Functions, headers de seguridad.
- Múltiples sitios por stack (un stack = un dominio).
- Pipelines CI/CD (se documentan comandos; la integración queda a decisión futura).

## 12. Documentación

- `README.md`: setup, variables de entorno, comandos de deploy/teardown, troubleshooting (validación ACM, invalidación de caché).
- `AGENTS.md`: actualizar la sección "Conventions" con los comandos reales (`npm run typecheck|synth|deploy|diff|destroy`).