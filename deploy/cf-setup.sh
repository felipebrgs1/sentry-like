#!/usr/bin/env bash
# Deploy completo do sentrylike na Cloudflare, do zero, sem Docker/VPS.
#
# Para quem usa SÓ Cloudflare: esse script cria os recursos (D1, R2, KV),
# preenche os placeholders do wrangler.toml, builda o front e faz o deploy.
#
# Pré-requisitos: git, bun (curl -fsSL https://bun.sh/install | bash),
# wrangler (npm i -g wrangler) e `wrangler login` já feito.
#
# Uso:
#   git clone <repo> && cd sentry-like
#   bash deploy/cf-setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

CONFIG="wrangler.toml"
D1_NAME="${CF_D1_NAME:-sentrylike}"
R2_NAME="${CF_R2_NAME:-sentrylike-blobs}"
KV_NAME="${CF_KV_NAME:-RATE_LIMIT_KV}"

echo "== 0. pré-requisitos =="
command -v wrangler >/dev/null 2>&1 || { echo "✗ wrangler não encontrado — instale: npm i -g wrangler"; exit 1; }
command -v bun >/dev/null 2>&1 || { echo "✗ bun não encontrado — instale: curl -fsSL https://bun.sh/install | bash"; exit 1; }
if ! wrangler whoami >/dev/null 2>&1; then
  echo "✗ não autenticado — rode: wrangler login"; exit 1
fi
echo "✓ ok"

# wrangler.toml é gitignored (IDs da sua conta) — num clone fresco, cria a partir do exemplo
if [ ! -f "$CONFIG" ]; then
  if [ ! -f "wrangler.toml.example" ]; then
    echo "✗ nem wrangler.toml nem wrangler.toml.example existem — clone incompleto"; exit 1
  fi
  cp wrangler.toml.example "$CONFIG"
  echo "✓ wrangler.toml criado a partir do exemplo"
fi

echo "== 1. banco D1 =="
if grep -q 'database_id = "SUBSTITUA' "$CONFIG"; then
  OUT=$(wrangler d1 create "$D1_NAME")
  D1_ID=$(echo "$OUT" | grep -oE 'database_id = "[0-9a-f-]+"' | head -1 | cut -d'"' -f2)
  if [ -z "$D1_ID" ]; then
    echo "✗ não consegui extrair o database_id:"; echo "$OUT"; exit 1
  fi
  perl -pi -e "s/database_id = \"SUBSTITUA_PELO_DATABASE_ID\"/database_id = \"$D1_ID\"/" "$CONFIG"
  echo "✓ D1 criado: $D1_ID"
else
  echo "✓ D1 já configurado (pulando)"
fi

echo "== 2. bucket R2 (blobs: attachments/replays) =="
if wrangler r2 bucket create "$R2_NAME" >/dev/null 2>&1; then
  echo "✓ R2 criado: $R2_NAME"
else
  echo "✓ R2 já existe"
fi

echo "== 3. KV (rate limit compartilhado) =="
if grep -q 'id = "SUBSTITUA' "$CONFIG"; then
  OUT=$(wrangler kv namespace create "$KV_NAME")
  KV_ID=$(echo "$OUT" | grep -oE 'id = "[0-9a-f-]+"' | head -1 | cut -d'"' -f2)
  if [ -z "$KV_ID" ]; then
    echo "✗ não consegui extrair o id do KV:"; echo "$OUT"; exit 1
  fi
  perl -pi -e "s/id = \"SUBSTITUA_PELO_KV_NAMESPACE_ID\"/id = \"$KV_ID\"/" "$CONFIG"
  echo "✓ KV criado: $KV_ID"
else
  echo "✓ KV já configurado (pulando)"
fi

echo "== 4. build do front (Static Assets) =="
bun install
bun run build
echo "✓ build ok"

echo "== 5. senha do dashboard =="
echo "  (nenhuma senha é configurada aqui — o primeiro acesso ao dashboard mostra"
echo "   o onboarding: crie o usuário owner direto no navegador.)"

echo "== 6. deploy =="
wrangler deploy

echo
echo "=============================================================="
echo " Pronto!"
echo " - Dashboard: https://sentrylike.<seu-subdominio>.workers.dev"
echo " - PRIMEIRO ACESSO: abra o dashboard e crie o usuário owner (onboarding)"
echo " - A chave do projeto demo aparece em /v1/projects (ou nos logs)"
echo " - DSN do demo: http://<public_key>@sentrylike.<subdominio>.workers.dev/1"
echo "=============================================================="
