# Sitio estático en AWS S3 + CloudFront (CDK)

Plantilla AWS CDK para crear y desplegar un sitio web estático en S3 + CloudFront a partir de un dominio, con DNS automático en Route 53.

## Requisitos

- Node.js 18+
- Cuenta AWS con credenciales configuradas (cadena estándar del SDK: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` o `AWS_PROFILE`)
- Una Hosted Zone pública existente en Route 53 (misma cuenta) para el dominio
- El certificado ACM se crea y valida automáticamente; todo el stack corre en `us-east-1`

## Configuración

Copia `.env.example` a `.env` y completa los valores. El `.env` se **carga automáticamente** en cada ejecución (`cdk synth`/`deploy`/`diff`/`destroy`) vía `dotenv` con prioridad `override`: los valores del `.env` reemplazan a cualquier variable ya exportada en tu shell, así que no necesitas `source` ni des-exportar nada.

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
- **Hosted Zone inexistente**: el stack no valida la zona en `synth`; el deploy fallará si el ID no corresponde a una zona pública existente en tu cuenta.
- **Invalidar caché sin re-deploy**: `aws cloudfront create-invalidation --distribution-id <DistributionId> --paths "/*"`.
- **Verificación post-deploy**: `curl -I https://${DOMAIN_NAME}` debe responder con `Server: CloudFront`.

## Seguridad

- Credenciales y account IDs nunca se hardcodean; se resuelven por la cadena del SDK y pseudo-parámetros en el deploy.
- El bucket es privado; el único acceso es vía CloudFront con Origin Access Control.
