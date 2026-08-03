# Deploy na Cloudflare (opcional — a VPS continua o caminho padrão)

O sentrylike roda nos dois: **VPS** (`bun run start` / docker) ou **Cloudflare Workers**
(D1 + R2 + KV + Static Assets). Este guia é para quem vai usar **apenas a Cloudflare**.

## O que você precisa

Sim, é preciso **clonar o repositório** — não existe deploy sem o código. Mas são só 3 ferramentas:

| Ferramenta | Por quê | Como instalar |
|---|---|---|
| **git** | clonar o repo | `sudo apt install git` / Xcode CLT |
| **bun** | instalar deps + buildar o front | `curl -fsSL https://bun.sh/install \| bash` |
| **wrangler** | deploy na Cloudflare | `npm i -g wrangler` |

Mais uma conta na Cloudflare com `wrangler login` (abre o browser uma vez).

## Caminho A — local (recomendado, 5 comandos)

```bash
git clone <url-do-repo> && cd sentry-like
wrangler login                 # só na primeira vez
bash deploy/cf-setup.sh        # cria D1+R2+KV, builda o front e faz deploy
```

O script:
1. verifica git/bun/wrangler/auth
2. cria o banco **D1**, o bucket **R2** e o **KV** e **preenche os placeholders** do
   `wrangler.toml` automaticamente (nada de editar ID à mão)
3. roda `bun install && bun run build`
4. pergunta a senha do dashboard (ou use `CF_ADMIN_PASSWORD=... bash deploy/cf-setup.sh`)
5. `wrangler deploy`

No final ele imprime a URL do dashboard e como pegar o DSN do projeto demo.

## Caminho B — integração Git da Cloudflare (sem build local)

Se não quiser rodar nada local além do clone inicial:

1. Suba o repo no GitHub e conecte em **Workers → Create → Connect to Git**.
2. Aponte `main = "apps/api/src/worker.ts"` (o `wrangler.toml` já tem).
3. Configure o **build command**: `bun install && bun run build` (o `apps/web/dist`
   vira Static Assets no deploy).
4. Crie os recursos uma vez (pela CLI ou dashboard) e **commite os IDs reais** no
   `wrangler.toml`:
   ```bash
   wrangler d1 create sentrylike
   wrangler r2 bucket create sentrylike-blobs
   wrangler kv namespace create RATE_LIMIT_KV
   # cole os IDs no wrangler.toml (ou rode o cf-setup.sh uma vez num terminal)
   ```
5. Defina o secret: `echo 'sua-senha' | wrangler secret put ADMIN_PASSWORD`

Depois disso, cada push na branch default faz deploy automático.

## Depois do deploy

- **Dashboard**: `https://sentrylike.<seu-subdominio>.workers.dev`
- **Login**: user `admin` + a senha definida (secret `ADMIN_PASSWORD`)
- **DSN do projeto demo**: pegue a `publicKey` em `/v1/projects` no dashboard →
  `http://<public_key>@sentrylike.<subdominio>.workers.dev/1`
- **SDK do Sentry**: qualquer SDK oficial aponta esse DSN — erros e transações vão
  para o D1; attachments/replays para o R2.

## Variáveis de ambiente úteis

| Var | Onde | Default | Efeito |
|---|---|---|---|
| `ADMIN_PASSWORD` | secret | aleatória | senha do dashboard |
| `ADMIN_USER` | `[vars]` | `admin` | usuário do dashboard |
| `RATE_LIMIT_PER_MIN` | `[vars]` | `600` | limite de eventos/min/projeto |
| `RETENTION_DAYS` | `[vars]` | `30` | dias de retenção (cron roda 3h da manhã) |

## Limitações conscientes na Cloudflare

- **D1 tem latência de rede** por query (na VPS é arquivo local) — ok para uso micro.
- **Rate limit em KV é eventual** (isolates efêmeros) — suficiente para uso pessoal.
- **Blobs** (attachments/replays) vão para R2; a pasta local `DATA_DIR` não existe no Worker.
