# Guía de pruebas de la implementación

Guía paso a paso para probar el template CDK de sitio estático en S3 + CloudFront, desde la autenticación en AWS hasta el teardown.

## 1. Requisitos previos

| Requisito | Detalle | Verificar con |
|---|---|---|
| Node.js 18+ | Runtime del proyecto | `node -v` |
| npm | Gestor de paquetes | `npm -v` |
| Cuenta AWS | Con permisos suficientes (ver §2.3) | `aws sts get-caller-identity` |
| Dominio propio | P. ej. `misitio.com`, con acceso al DNS | — |
| Hosted Zone pública en Route 53 | Para el dominio, en la **misma cuenta** de AWS | Consola Route 53 |
| AWS CLI (opcional pero recomendado) | Para verificar autenticación y outputs | `aws --version` |

> El stack completo corre en `us-east-1` (lo exige ACM para CloudFront). La Hosted Zone puede vivir en cualquier región (Route 53 es global).

## 2. Autenticación en AWS

El proyecto **no contiene ni lee credenciales propias**: usa la cadena estándar del SDK. Configura la autenticación con **una sola** de las siguientes opciones.

### 2.1 Opción A — AWS CLI con Access Keys (rápido)

```bash
aws configure
```

Te pedirá:
- `AWS Access Key ID` y `AWS Secret Access Key`: créalas en IAM → *Users* → tu usuario → *Security credentials* → *Create access key*. Guárdalas en `~/.aws/credentials` (fuera del repo, nunca en el proyecto).
- `Default region name`: `us-east-1`
- `Default output format`: `json`

Quedan escritas en `~/.aws/credentials` y `~/.aws/config`. No tocan el repositorio.

### 2.2 Opción B — Variables de entorno

```bash
export AWS_ACCESS_KEY_ID=AKIA...
export AWS_SECRET_ACCESS_KEY=...
export AWS_SESSION_TOKEN=...      # solo si usas credenciales temporales
export AWS_DEFAULT_REGION=us-east-1
```

> Nunca pongas estos valores en `.env`, `.env.example` ni ningún archivo del repo. Si usas un `.env`, úsalo solo para `DOMAIN_NAME`, `HOSTED_ZONE_ID`, etc.

### 2.3 Opción C — AWS SSO

```bash
aws configure sso
aws sso login --profile <perfil>
```

### 2.4 Verificar la autenticación

```bash
aws sts get-caller-identity
```

Debe responder algo como:

```json
{
  "UserId": "AIDA...",
  "Account": "123456789012",
  "Arn": "arn:aws:iam::123456789012:user/mi-usuario"
}
```

Anota el **Account**; lo necesitas para el bootstrap. Si falla, revisa las credenciales antes de continuar.

### 2.5 Permisos IAM necesarios

El usuario/rol debe poder: `CloudFormation`, `S3`, `CloudFront`, `Route53` (leer zona y `ChangeResourceRecordSets`), `ACM`, `IAM` (para que `cdk bootstrap` cree roles), y `Lambda`/`EC2`-related solo si el `BucketDeployment` requiere (el bootstrap lo gestiona). Para pruebas, un `AdministratorAccess` temporal simplifica; en producción restringe por política.

## 3. Preparar el proyecto

```bash
cd s3-cloudfront-site-cloudformation-template
npm install
```

Configura las variables de entorno. El proyecto **carga automáticamente** el archivo `.env` en cada ejecución (dotenv con `override`), así que los valores del `.env` siempre tienen prioridad — no necesitas exportar variables ni des-exportar nada:

```bash
cp .env.example .env
# edita .env y completa DOMAIN_NAME y HOSTED_ZONE_ID
npm run synth   # lee .env automáticamente
```

| Variable | Requerida | Default | Descripción |
|---|---|---|---|
| `DOMAIN_NAME` | full | — | Dominio del sitio (apex) |
| `HOSTED_ZONE_ID` | full | — | ID de la Hosted Zone pública de Route 53 |
| `CLOUDFRONT_DISTRIBUTION_ID` | content | — | ID de una distribución existente (modo content) |
| `S3_BUCKET_NAME` | content | — | Bucket S3 existente al que subir (modo content) |
| `S3_BUCKET_REGION` | content | `REGION` | Región del bucket existente |
| `SITE_DIR` | no | `www` | Carpeta con el contenido estático |
| `STACK_NAME` | no | `s3-cloudfront-site` | Nombre del stack |
| `REGION` | no | `us-east-1` | Región del stack (debe ser `us-east-1` en modo full) |

Cómo obtener el `HOSTED_ZONE_ID`: Consola Route 53 → *Hosted zones* → tu dominio → copia el ID (columna "Hosted zone ID", empieza por `Z`). Alternativa: `aws route53 list-hosted-zones`.

## 4. Verificación local (sin tocar AWS)

```bash
npm run typecheck
```

Esperado: termina sin errores.

```bash
npm run synth
```

Esperado: genera `cdk.out/<STACK_NAME>.template.json` (p. ej. `s3-cloudfront-site.template.json` con el `STACK_NAME` por defecto) sin llamar a AWS. Es una **prueba de validación de configuración** según el modo:

- **Modo full**: si falta `DOMAIN_NAME` o `HOSTED_ZONE_ID` en `.env`, falla con:

```
Variables de entorno requeridas: DOMAIN_NAME, HOSTED_ZONE_ID. Revisa .env.example.
```

- **Modo content**: si solo una de `CLOUDFRONT_DISTRIBUTION_ID`/`S3_BUCKET_NAME` está definida, falla con `CLOUDFRONT_DISTRIBUTION_ID y S3_BUCKET_NAME deben definirse juntas...`.

Prueba negativa (opcional, solo modo full) — guardia de región: como `.env` gana sobre variables exportadas (dotenv `override`), edita temporalmente `.env` con `REGION=eu-west-1` y ejecuta `npm run synth`; debe fallar con `REGION debe ser 'us-east-1' ...`. Vuelve a poner `REGION=us-east-1` después.

Inspecciona el template generado para confirmar lo esencial (`<STACK_NAME>` = tu `STACK_NAME` de `.env`). En modo full:

```bash
grep -c "OriginAccessControl" cdk.out/<STACK_NAME>.template.json          # ≥ 1 (OAC presente)
grep -c "CloudFrontOriginAccessIdentity" cdk.out/<STACK_NAME>.template.json  # 0 (sin OAI)
grep -c "AWS::Route53::RecordSet" cdk.out/<STACK_NAME>.template.json      # 2 (A + AAAA)
```

En modo content, la verificación del template está en §8.bis.

## 5. Bootstrap de CDK (una sola vez por cuenta/región)

```bash
cdk bootstrap aws://<ACCOUNT>/<REGION> --profile <perfil-si-usas>
```

Sustituye `<ACCOUNT>` por el número de §2.4 y `<REGION>` por `us-east-1`:

```bash
cdk bootstrap aws://123456789012/us-east-1
```

Esperado: crea el stack `CDKToolkit` (bucket S3 + roles IAM de despliegue) y termina sin errores. Se ejecuta una única vez por cuenta/región; los despliegues posteriores no lo requieren.

## 6. Desplegar

```bash
npm run deploy
```

Si usas un perfil de AWS CLI:

```bash
npx cdk deploy --all --profile <perfil>
```

Qué hace: crea/actualiza el stack (bucket S3 privado, OAC, certificado ACM con validación DNS en la Hosted Zone, distribución CloudFront, registros A/AAAA), sube `SITE_DIR` al bucket e invalida la caché `/*`.

En **modo content** (con `CLOUDFRONT_DISTRIBUTION_ID` y `S3_BUCKET_NAME`): no crea ningún recurso; solo sube `SITE_DIR` al bucket indicado e invalida la caché de la distribución existente. Además, en ese modo el deploy **no borra objetos** del bucket que no estén en `SITE_DIR` (`prune: false`).

Qué esperar:
- **Puede tardar 5–15 minutos.** La validación del certificado ACM mantiene el stack en `CREATE_IN_PROGRESS` mientras se propaga el DNS; es normal y no es un error.
- Al terminar muestra los outputs del stack.

## 7. Verificación post-deploy

### 7.1 Outputs del stack

`<STACK_NAME>` es el valor de `STACK_NAME` en `.env` (default `s3-cloudfront-site`):

```bash
aws cloudformation describe-stacks --stack-name <STACK_NAME> --query "Stacks[0].Outputs" --region us-east-1
```

Debe listar: `BucketName`, `DistributionDomain`, `DistributionId`, `CertificateArn`, `SiteUrl`.

### 7.2 Estado del certificado

```bash
aws acm describe-certificate --certificate-arn <CertificateArn> --region us-east-1 --query "Certificate.Status"
```

Esperado: `ISSUED`. Si está en `PENDING_VALIDATION`, espera unos minutos y repite (la validación DNS ya se creó automáticamente).

### 7.3 DNS resuelve hacia CloudFront

```bash
dig +short <DOMAIN_NAME>
```

Esperado: un nombre `dxxxxxxxxxxxx.cloudfront.net` (o su IP). El registro A/AAAA fue creado automáticamente.

### 7.4 HTTPS responde con el contenido

```bash
curl -I https://<DOMAIN_NAME>
```

Esperado: `HTTP/2 200` y cabecera `Server: CloudFront`.

```bash
curl https://<DOMAIN_NAME>
```

Esperado: el HTML de `www/index.html` (p. ej. "Hola desde S3 + CloudFront").

### 7.5 Redirección HTTP → HTTPS

```bash
curl -I http://<DOMAIN_NAME>
```

Esperado: `HTTP/1.1 301 Moved Permanently` con `Location: https://...`.

### 7.6 El bucket sigue privado

El bucket no tiene website hosting público. Verifícalo accediendo directamente (debe dar `403`):

```bash
curl -sI https://<BucketName>.s3.us-east-1.amazonaws.com/index.html | head -1
```

Esperado: `HTTP/1.1 403 Forbidden` (o 404 si existe otra política; nunca `200`).

### 7.7 Prueba en navegador

Abre `https://<DOMAIN_NAME>`: debe cargar el sitio con candado HTTPS válido.

## 8. Prueba de actualización (redeploy)

1. Modifica `www/index.html` (p. ej. cambia el texto del `<h1>`).
2. Previsualiza el cambio de infraestructura:

```bash
npm run diff
```

3. Vuelve a desplegar:

```bash
npm run deploy
```

Esperado: el stack se actualiza sin recrearse desde cero; el contenido se re-sube y la caché se invalida.
4. Verifica que el navegador (o `curl`) muestra el nuevo texto. Si usas `curl`, recarga con cache-buster: `curl -s "https://<DOMAIN_NAME>/?t=$(date +%s)"`.

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

## 9. Teardown

```bash
npm run destroy
```

Esperado: elimina el stack (CloudFront, ACM, Route 53 records, OAC, bucket policy). **El bucket S3 se conserva** (política `RETAIN`): no se borra ni su contenido. Puedes eliminarlo manualmente después si ya no lo necesitas:

```bash
aws s3 rb s3://<BucketName> --force --region us-east-1
```

En **modo content** el stack solo contiene el custom resource de deploy: `destroy` lo elimina y **no toca** el bucket ni la distribución existentes.

## 10. Troubleshooting

| Síntoma | Causa probable | Solución |
|---|---|---|
| `Variables de entorno requeridas` | Falta config en `.env` (o no existe el archivo) en **modo full** | Completa `DOMAIN_NAME` y `HOSTED_ZONE_ID` en `.env` (§3) |
| `CLOUDFRONT_DISTRIBUTION_ID y S3_BUCKET_NAME deben definirse juntas` | Solo una de las dos variables definida | Define ambas (modo content) o ninguna (modo full) |
| `REGION debe ser 'us-east-1'` | `REGION` distinta (modo full) | Usa `us-east-1` o quita la variable |
| Deploy content falla al subir al bucket | `S3_BUCKET_NAME` no existe o `S3_BUCKET_REGION` es incorrecta | Verifica el bucket real: `aws s3api get-bucket-location --bucket <nombre>` y ajusta `S3_BUCKET_REGION` |
| Deploy content falla al invalidar | `CLOUDFRONT_DISTRIBUTION_ID` inexistente | Verifica el ID: `aws cloudfront list-distributions` |
| `AccessDenied` en `cdk bootstrap`/`deploy` | Credenciales sin permisos | Revisa §2.4 y los permisos IAM (§2.5) |
| Stack horas en `CREATE_IN_PROGRESS` | Validación ACM pendiente | Verifica §7.2; si `PENDING_VALIDATION` persiste, revisa que la zona/dominio sean correctos |
| Deploy falla en Route 53 | Hosted Zone inexistente o de otra cuenta | Confirma `HOSTED_ZONE_ID` y que la zona esté en tu cuenta (§3) |
| `CREATE_FAILED` en `AWS::CertificateManager::Certificate` con 403 de Route53 | `HOSTED_ZONE_ID` erróneo: la zona no existe en tu cuenta (o es de otra) | Lista tus zonas: `aws route53 list-hosted-zones --profile <perfil>`; usa el ID que aparece para tu dominio. El 403 aparece aunque el rol tenga `AdministratorAccess`, porque la zona del `.env` no es accesible en esa cuenta. Nota: con dotenv activo, `.env` reemplaza variables viejas del shell |
| `curl` da `403` en el dominio | Contenido aun no desplegado o caché vieja | Espera a que termine el `BucketDeployment`; repite `npm run deploy` |
| Cambios no visibles tras redeploy | Caché de CloudFront | La invalidación `/*` es automática; si persiste, fuerza: `aws cloudfront create-invalidation --distribution-id <DistributionId> --paths "/*"` |
| `Bucket already exists` al re-usar un nombre | CDK usa nombres autogenerados, no debería pasar | Si importaste un bucket manual, elimínalo o usa otro stack |
| `StackNameInvalidFormat` | `STACK_NAME` con caracteres inválidos (p. ej. puntos) | Usa solo letras, números y guiones; p. ej. `s3-ciabatta-ai-lp` en vez de `s3-ciabatta.ai-lp` |
| El template en `cdk.out/` tiene valores viejos | `cdk synth` no limpia artefactos anteriores | Re-ejecuta `npm run synth` (el `.env` se lee automáticamente); revisa que exista `cdk.out/<TU-STACK_NAME>.template.json` (el nombre de archivo cambia si cambias `STACK_NAME`) |

## 11. Notas de seguridad

- Las credenciales (`AKIA...`, secret keys) **solo** viven en `~/.aws/` o en variables de entorno del shell, nunca en el repo. `.gitignore` excluye `.env`.
- El account ID nunca se escribe en el código; el template lo resuelve con pseudo-parámetros (`AWS::AccountId`) en el deploy.
- El bucket es privado; el único acceso es CloudFront vía Origin Access Control.
- Rota las Access Keys periódicamente en IAM.