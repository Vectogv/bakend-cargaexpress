# Imagen del backend en Railway.
# Se usa Dockerfile (y no Railpack) porque los respaldos necesitan pg_dump de la
# MISMA versión mayor que el servidor (Postgres 18) y Debian sólo trae el 17:
# se instala postgresql-client-18 desde el repositorio oficial PGDG.
FROM node:24-trixie-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl bash \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
       https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt trixie-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-18 \
  && apt-get purge -y curl && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

ENV NODE_ENV=production
CMD ["bash", "start.sh"]
