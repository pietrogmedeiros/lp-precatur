#!/bin/sh
set -e
# Volumes montados pelo painel (Easypanel etc.) costumam vir com dono root.
# Ajusta a pasta de dados e depois roda o app como usuário sem privilégios.
DATA_DIR="${DATA_DIR:-/app/data}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  exec su-exec node "$@"
fi
exec "$@"
