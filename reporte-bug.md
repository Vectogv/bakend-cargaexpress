# Reporte de Bug: Error 500 "Cannot read properties of undefined (reading 'nombre')" en POST /api/trips/:id/offers

## Síntoma Original

`POST /api/trips/:id/offers` retornaba:

```json
{"message":"Cannot read properties of undefined (reading 'nombre')"}
```

Stack trace:
```
TypeError: Cannot read properties of undefined (reading 'nombre')
    at OfferController.store (file:///app/build/controllers/offer_controller.js:50:46)
```

## Investigación

### Lo que NO era

- **No era un bug de código**: se redujo `OfferController.store` al mínimo absoluto (solo auth + monto + return 200) y el error persistía
- **No era caché de Nixpacks**: el snapshot hash era el mismo, pero el build SÍ compilaba el código nuevo
- **No era un problema de "GitHub Repo not found"**: aunque la conexión con GitHub estaba rota, se podía deployar via `railway up`

### Causa Raíz (3 problemas encadenados)

1. **`start.sh` con saltos de línea Windows (`\r\n` en vez de `\n`)**
   - El archivo `start.sh` fue creado/editado en Windows y git con `core.autocrlf` lo convertía a `\r\n`
   - Cuando Railway ejecutaba `bash start.sh`, el shell de Linux (Ubuntu) no podía interpretar los `\r`
   - Error en los logs: `cd: $'/app\r': No such file or directory`
   - Esto causaba que el contenedor NUEVO crasheara inmediatamente al iniciar

2. **Railway mantenía el contenedor VIEJO**
   - Railway usa blue-green deployment: el contenedor nuevo debe pasar healthcheck para recibir tráfico
   - Como `start.sh` fallaba, el contenedor nuevo nunca arrancaba el servidor
   - Railway automáticamente mantenía el contenedor VIEJO activo, respondiendo con código anterior
   - Esto explicaba por qué cambiábamos el código y Railway seguía respondiendo igual

3. **"Root Directory" mal configurado**
   - En Railway Settings → Source, el campo "Root Directory" tenía `https://github.com/Vectogv/bakend-cargaexpress.git` (una URL de GitHub)
   - Debería estar VACÍO (o `/`)
   - Esto causaba que los deploys via `railway up` fallaran porque Railway intentaba buscar los archivos en esa URL inexistente como directorio raíz

### Por qué tantos intentos fallaron

| Intento | Resultado |
|---------|-----------|
| 15 commits modificando `offer_controller.ts` | Sin efecto (el contenedor nuevo nunca arrancaba) |
| `railway up` sin `--detach` | FAILED (root directory mal configurado) |
| Railway API para limpiar root directory | ✅ Funcionó |
| `railway up` después de limpiar root dir | FAILED (`start.sh` con `\r\n`) |
| `sed -i 's/\r$//' start.sh` + `railway up` | ✅ SUCCESS |

## Solución

### 1. Limpiar Root Directory vía Railway API

```bash
curl -s "https://api.railway.app/graphql/v2" \
  -H "Authorization: Bearer [TOKEN]" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mutation($input: ServiceInstanceUpdateInput!) {
      serviceInstanceUpdate(
        input: $input,
        serviceId: "4897abd3-c594-479b-b290-11af9128311c",
        environmentId: "f84fa16b-2f53-4809-a957-ff0749da56e6"
      )
    }",
    "variables": {
      "input": { "rootDirectory": "" }
    }
  }'
```

### 2. Convertir start.sh a Unix line endings

```bash
sed -i 's/\r$//' start.sh
```

### 3. Deployar con railway up

```bash
railway up -s zippy-trust -e production
```

## Estado Actual

- `POST /api/trips/:id/offers` funciona correctamente (201 con datos de la oferta)
- Las validaciones (duplicados, estado del viaje, montos) funcionan
- Socket emit y push notifications funcionales
- Los endpoints `index` y `accept` en `OfferController` también funcionan (tienen optional chaining en `.nombre`)

## Railway: Cómo conectarse para futuras sesiones

### Tokens de API

- **Railway API token**: `G8r7qt7CGQKac3Vlr573NgcENSTIt-_TKvGRR4yD614`
- **Refresh token**: `rtbVdIXipJyH9kp0JUX4XNeqUjBj7_SXjWUTLX4lydd`
- **Project ID**: `a4f8d90f-3622-4147-8b42-474e8cfc1983` (shimmering-creativity)
- **Service ID**: `4897abd3-c594-479b-b290-11af9128311c` (zippy-trust)
- **Environment ID**: `f84fa16b-2f53-4809-a957-ff0749da56e6` (production)
- **Usuario Railway**: alberto gvvv (albertogvvv75@gmail.com)
- **API GraphQL endpoint**: `https://api.railway.app/graphql/v2`
- **Dominio público**: `https://zippy-trust-production.up.railway.app`

### Railway CLI

```bash
# Instalar
npm install -g @railway/cli

# Login (abre browser para autorizar)
railway login

# Enlazar proyecto (si no está enlazado)
railway link -p shimmering-creativity -s zippy-trust -e production

# Deployar código local
railway up -s zippy-trust -e production -m "mensaje del deploy"

# Ver estado de deploys
railway deployment list --json -s zippy-trust -e production

# Ver logs del build más reciente
railway logs --build -s zippy-trust -e production

# Ver logs de un deploy específico
railway logs --deployment <ID> -s zippy-trust -e production
```

### Railway API GraphQL (alternativa sin CLI)

```bash
# Query proyecto
curl -s "https://api.railway.app/graphql/v2" \
  -H "Authorization: Bearer G8r7qt7CGQKac3Vlr573NgcENSTIt-_TKvGRR4yD614" \
  -d '{"query":"{ project(id: \"a4f8d90f-3622-4147-8b42-474e8cfc1983\") { id name } }"}'

# Update service instance (limpiar root directory)
curl -s "https://api.railway.app/graphql/v2" \
  -H "Authorization: Bearer G8r7qt7CGQKac3Vlr573NgcENSTIt-_TKvGRR4yD614" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mutation($input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(input: $input, serviceId: \"4897abd3-c594-479b-b290-11af9128311c\", environmentId: \"f84fa16b-2f53-4809-a957-ff0749da56e6\") }",
    "variables": { "input": { "rootDirectory": "" } }
  }'
```

### Configuración Railway

- **Builder**: NIXPACKS (config en `railway.json` y `nixpacks.toml`)
- **Build command**: `rm -rf build && npx tsx bin/console.ts build --ignore-ts-errors`
- **Start command**: `bash start.sh`
- **Healthcheck path**: `/health`
- **Healthcheck timeout**: 30s
- **Restart policy**: on_failure, max 5 retries
- **Región**: US West (California)
- **Replicas**: 1 (Plan Free: 1 replica, 2 vCPU, 1 GB RAM)

### Notas importantes para Railway

1. **No usar Git Bash en Windows** para editar `start.sh` — siempre verificar line endings con `cat -A start.sh` (no debe mostrar `^M`)
2. El GitHub auto-deploy está desconectado. Para deployar: `railway up -s zippy-trust -e production`
3. Si un deploy nuevo no se refleja: revisar **Deploy Logs** (no Build Logs) — probablemente `start.sh` falló por line endings
4. Railway no es Serverless en este plan — el contenedor siempre está activo

## Recomendaciones (lecciones aprendidas)

1. **Agregar `.gitattributes`** al repo para forzar LF en archivos shell y config:
   ```
   * text=auto
   *.sh text eol=lf
   *.toml text eol=lf
   *.json text eol=lf
   ```

2. **Verificar `start.sh` después de editar en Windows**: siempre revisar con `cat -A start.sh` que no aparezcan `^M`

3. **Para Railway**: si el deploy nuevo no se refleja, revisar los **Deploy Logs** (no solo Build Logs) para ver si `start.sh` falló

4. **Para futuros deploys**: el GitHub auto-deploy está desconectado. Usar `railway up` desde la terminal del proyecto, o reconectar el repo en Railway Settings → Source → Connect Repo
