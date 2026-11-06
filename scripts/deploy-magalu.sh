#!/usr/bin/env bash
# Deploy do SkyRescue (goa.mnrs.com.br) no servidor magalu, sem SSH e sem
# runner no Mac. Quem chama é o auto-promote do servidor
# (`labctl promote skyrescue <sha>`) quando a branch `live` anda — e o GitHub
# só move a `live` depois dos testes verdes (.github/workflows/deploy.yml).
#
# Faz, no próprio servidor, o que o job de deploy do GitHub fazia por SSH:
#   1. build do front num checkout limpo à parte (/home/ubuntu/deploy-src/skyrescue)
#      + o mesmo smoke do CI. Até aqui nada da produção foi tocado;
#   2. backend: rsync de server/ para /home/ubuntu/skyrescue/server (mesmos
#      excludes: .env, node_modules, sessão do WhatsApp), npm ci (só se o
#      lockfile mudou), migrate (idempotente), restart da skyrescue-api, health;
#   3. front: backup e instalação de index.html e sw.js em /var/www/goa,
#      confere 200 + o arquivo servido igual ao buildado;
#   4. alinha o git de /home/ubuntu/skyrescue com o SHA publicado e grava
#      /var/www/goa/versao.txt (o job "aguardar" do GitHub espera por ele).
# Falha do passo 2 em diante: backend, front e git voltam para o que estava no ar.
#
# Uso: bash deploy-magalu.sh <sha>
# Rollback manual: labctl rollback skyrescue (roda este script com o SHA anterior).
set -euo pipefail

ALVO="${1:?uso: deploy-magalu.sh <sha>}"
LIVE=/home/ubuntu/skyrescue           # checkout de onde a API roda (server/); LIVE_DIR do labctl
SRC=/home/ubuntu/deploy-src/skyrescue # checkout só de build
WEBROOT=/var/www/goa
HOST=goa.mnrs.com.br

# O LIVE só é alinhado depois do sucesso: o HEAD dele é o que está no ar.
PREV=$(git -C "$LIVE" rev-parse HEAD)

# npm ci só quando o lockfile muda (o carimbo mora dentro do node_modules).
deps() {
  local dir="$1" lock
  shift
  lock=$(sha256sum "$dir/package-lock.json" | cut -d' ' -f1)
  if [ "$(cat "$dir/node_modules/.deploy-lock" 2>/dev/null)" = "$lock" ]; then
    echo "deps de $dir: lockfile inalterado, npm ci pulado"
  else
    (cd "$dir" && npm ci --no-audit --no-fund "$@")
    echo "$lock" > "$dir/node_modules/.deploy-lock"
  fi
}

api_ok() {
  local i code
  for i in $(seq 1 10); do
    code=$(curl -sk -o /dev/null -w '%{http_code}' --resolve "$HOST:443:127.0.0.1" "https://$HOST/api/health" || true)
    [ "$code" = 200 ] && { echo "API OK (200)"; return 0; }
    echo "tentativa $i: http=$code — aguardando"; sleep 2
  done
  echo "ERRO: API não respondeu 200 em /api/health" >&2
  return 1
}

# front_ok [arquivo esperado]: 200 + "SkyRescue" (+ servido == esperado)
front_ok() {
  local tmp code ok=0
  tmp=$(mktemp)
  code=$(curl -sk -o "$tmp" -w '%{http_code}' --resolve "$HOST:443:127.0.0.1" "https://$HOST/" || true)
  if [ "$code" = 200 ] && grep -q SkyRescue "$tmp" && { [ -z "${1:-}" ] || cmp -s "$tmp" "$1"; }; then ok=1; fi
  rm -f "$tmp"
  echo "front: http=$code ok=$ok perms=$(stat -c '%a %U:%G' "$WEBROOT/index.html")"
  [ "$ok" = 1 ]
}

MIGRAR=1
backend() {
  # .env, node_modules e a sessão do WhatsApp (.wa-auth/, as chaves do chip
  # pareado) ficam só no servidor — mesmos excludes do rsync do deploy antigo.
  rsync -a --delete \
    --exclude 'node_modules/' --exclude '.env' --exclude '.env.production' --exclude '*.log' \
    --exclude '.wa-auth/' \
    "$SRC/server/" "$LIVE/server/"
  deps "$LIVE/server" --omit=dev
  if [ "$MIGRAR" = 1 ]; then
    (cd "$LIVE/server" && set -a && . ./.env && set +a && node scripts/migrate.js)   # idempotente
  fi
  sudo -n systemctl restart skyrescue-api
  api_ok
}

etapa=0   # 0 build | 1 backend | 2 front e depois
ok=0
voltar() {
  set +e
  echo "=== ROLLBACK: produção volta para ${PREV:0:7} ===" >&2
  if [ "$etapa" -ge 2 ]; then
    sudo -n cp -f "$WEBROOT/index.html.prev" "$WEBROOT/index.html"
    sudo -n cp -f "$WEBROOT/sw.js.prev" "$WEBROOT/sw.js"
  fi
  git -C "$SRC" checkout -qf --detach "$PREV"
  # Sem migrate: o schema só cresce (IF NOT EXISTS) e o código anterior roda nele.
  MIGRAR=0
  backend
  git -C "$LIVE" reset -q --hard "$PREV"
  if api_ok && front_ok; then
    echo "rollback OK: no ar ${PREV:0:7}" >&2
  else
    echo "ERRO: rollback não ficou saudável — intervenção manual necessária" >&2
  fi
}
no_fim() {
  local rc=$?
  [ "$ok" = 1 ] && exit 0
  if [ "$etapa" -eq 0 ]; then
    echo "ERRO no build (rc=$rc): nada foi trocado — a produção segue em ${PREV:0:7}." >&2
  else
    voltar
  fi
  exit 1
}
trap no_fim EXIT

echo "=== git: ${PREV:0:7} -> ${ALVO:0:7} ==="
if [ ! -d "$SRC/.git" ]; then
  mkdir -p "$(dirname "$SRC")"
  git clone -q "$(git -C "$LIVE" remote get-url origin)" "$SRC"
fi
git -C "$SRC" fetch -q origin
ALVO=$(git -C "$SRC" rev-parse --verify "$ALVO^{commit}")
git -C "$SRC" checkout -qf --detach "$ALVO"
git -C "$SRC" clean -qfdx -e node_modules

echo "=== build do front (produção segue no ar) ==="
deps "$SRC"
(
  cd "$SRC"
  # Chave do Google Maps embutida no bundle: no CI vem do secret
  # VITE_GMAPS_KEY; aqui, do .env.production do servidor (fora do git).
  set -a
  if [ -f "$LIVE/.env.production" ]; then . "$LIVE/.env.production"; fi
  set +a
  nice -n 10 npm run build
  # mesmo smoke do CI
  test -f dist/index.html
  test -f dist/sw.js                          # service worker (app abre sem rede)
  grep -q "SkyRescue" dist/index.html
  grep -q "Hospital do Sub" dist/index.html   # dados de hospitais embutidos
  size=$(wc -c < dist/index.html)
  if [ "$size" -lt 100000 ]; then
    echo "ERRO: bundle suspeito de estar incompleto ($size bytes)" >&2
    exit 1
  fi
  if [ -n "${VITE_GMAPS_KEY:-}" ] && ! grep -qF "$VITE_GMAPS_KEY" dist/index.html; then
    echo "ERRO: a chave do Google Maps não foi embutida no bundle" >&2
    exit 1
  fi
  echo "bundle OK ($size bytes)"
)

# ---- backend primeiro: garante a API pronta antes do novo frontend ----
echo "=== backend (skyrescue-api) ==="
etapa=1
backend

echo "=== front (/var/www/goa) ==="
etapa=2
sudo -n cp -f "$WEBROOT/index.html" "$WEBROOT/index.html.prev"
sudo -n cp -f "$WEBROOT/sw.js" "$WEBROOT/sw.js.prev"
# install -m 644: o www-data do nginx precisa ler o arquivo
sudo -n install -m 644 -o root -g root "$SRC/dist/sw.js" "$WEBROOT/sw.js"
sudo -n install -m 644 -o root -g root "$SRC/dist/index.html" "$WEBROOT/index.html"
front_ok "$SRC/dist/index.html"

# O git de /home/ubuntu/skyrescue diz a verdade sobre o que está no ar
# (`git log`, `labctl status`, e o auto-promote compara a `live` com ele).
# reset --hard e não checkout: o rsync do backend deixou o working tree
# modificado. .env, node_modules e .wa-auth são ignorados pelo git e ficam.
echo "=== alinhando o git do servidor ==="
git -C "$LIVE" checkout -q -B main
git -C "$LIVE" reset -q --hard "$ALVO"
v=$(mktemp)
echo "$ALVO" > "$v"
sudo -n install -m 644 -o root -g root "$v" "$WEBROOT/versao.txt"
rm -f "$v"

ok=1
echo "=== OK: skyrescue ${ALVO:0:7} no ar ==="
