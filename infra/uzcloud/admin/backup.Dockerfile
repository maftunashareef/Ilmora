# pg_dump + openssl + aws-cli in one small image for the backup service (machine ilmora-admin).
FROM postgres:16-alpine
RUN apk add --no-cache aws-cli openssl
