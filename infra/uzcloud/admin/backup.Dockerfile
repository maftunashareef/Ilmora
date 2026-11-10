# pg_dump + openssl + rclone in one small image for the backup service (machine ilmora-admin).
# rclone, not aws-cli: Alpine's aws-cli fails on its Python ("argument of type 'NoneType' is not a container or iterable").
FROM postgres:16-alpine
RUN apk add --no-cache rclone openssl
# The script is part of the image, not a file mount: every release rebuilds the image (`up -d --build`), a changed
# script gives a new image, and compose recreates the service with it. A file mount kept the running scheduler on the
# old script after a release (security review 10.11, №24).
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod 755 /usr/local/bin/backup.sh
