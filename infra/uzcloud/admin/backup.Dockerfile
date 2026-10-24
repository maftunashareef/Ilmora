# pg_dump + openssl + rclone in one small image for the backup service (machine ilmora-admin).
# rclone, not aws-cli: Alpine's aws-cli fails on its Python ("argument of type 'NoneType' is not a container or iterable").
FROM postgres:16-alpine
RUN apk add --no-cache rclone openssl
