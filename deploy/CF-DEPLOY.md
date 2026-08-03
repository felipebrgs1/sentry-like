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
4. `wrangler deploy`
5. **Abra o dashboard e crie o primeiro usuário (onboarding)** — o script não configura senha

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
Depois disso, cada push na branch default faz deploy automático.

> **Primeiro acesso**: sem usuários, o dashboard mostra o onboarding — crie o owner
> (nome/email/senha) direto no navegador. Depois disso, só login normal.
> ⚠️ Em URL pública, abra o onboarding você mesmo logo após o deploy (o primeiro
> visitante que completar o setup vira o owner).

## Depois do deploy

- **Dashboard**: `https://sentrylike.<seu-subdominio>.workers.dev`
- **Login**: o usuário criado no onboarding (ou via `ADMIN_USER`/`ADMIN_PASSWORD` no env, para deploy automatizado)
- **DSN do projeto demo**: pegue a `publicKey` em `/v1/projects` no dashboard →
  `http://<public_key>@sentrylike.<subdominio>.workers.dev/1`
- **SDK do Sentry**: qualquer SDK oficial aponta esse DSN — erros e transações vão
  para o D1; attachments/replays para o R2.

## Variáveis de ambiente úteis

| Var | Onde | Default | Efeito |
|---|---|---|---|
| `ADMIN_USER` / `ADMIN_PASSWORD` | env (opcional) | — | cria o owner automaticamente no 1º boot (docker/CI); sem isso, onboarding no front |
| `ADMIN_USER` | `[vars]` | `admin` | usuário do dashboard |
| `RATE_LIMIT_PER_MIN` | `[vars]` | `600` | limite de eventos/min/projeto |
| `RETENTION_DAYS` | `[vars]` | `30` | dias de retenção (cron roda 3h da manhã) |

## Upgrade / nova versão

O bootstrap do banco é idempotente (`CREATE TABLE IF NOT EXISTS` + `ALTER ADD COLUMN` em try/catch),
então **nova versão = novo deploy**, sem passo manual de migração.

**Caminho A (local):**

```bash
git pull
bash deploy/cf-setup.sh
```

O script detecta que D1/R2/KV já existem (IDs reais no `wrangler.toml`) — ele só roda
`bun install && bun run build && wrangler deploy`.

**Caminho B (integração Git):** cada push na branch default já faz deploy automático —
upgrade é só `git push`.

### Privacidade: `wrangler.toml` está no .gitignore

O `wrangler.toml` contém os IDs da sua conta (D1 database_id, KV namespace id). São
**identificadores**, não credenciais (o acesso real é o token do `wrangler login` na sua
máquina) — mas para não expor os IDs no repo, ele é gitignorado:

- `wrangler.toml` → não é commitado; guarde uma cópia dele fora do repo (backup)
- `wrangler.toml.example` → commitado; num clone novo o `cf-setup.sh` copia o exemplo,
  cria os recursos e preenche os IDs automaticamente
- `git pull` nunca conflita com o seu arquivo local (git ignora)
- `.dev.vars` (segredos locais do `wrangler dev`) também é gitignorado

Se já tinha commitado o `wrangler.toml` antes: `git rm --cached wrangler.toml` para
parar de trackear (o arquivo local continua).

### Como a migração de schema acontece

1. O deploy sobe a nova versão do Worker (atômico, sem downtime).
2. No primeiro request, `initD1Db()` roda `CREATE TABLE IF NOT EXISTS` + `ALTER ADD COLUMN`
   — colunas/tabelas novas são criadas no D1 na hora. Tudo aditivo.
3. A latência desse primeiro request é um pouco maior (várias statements de DDL), o resto igual.

> Se uma futura versão precisar de **transformação de dados** (ex.: backfill de uma coluna nova),
> o padrão é adicionar a query no `initD1Db` (ou num script `bun run scripts/migrate.ts` para VPS).

### Rollback e downgrade

- **Rollback de código**: `wrangler rollback` (ou `wrangler versions list` + `wrangler versions deploy <id>`).
  A Cloudflare guarda as versões anteriores.
- **Schema não reverte**: se a nova versão rodou ALTERs no D1, voltar o código para a versão
  antiga **funciona** (código antigo ignora colunas extras) — desde que a migração seja aditiva,
  que é a regra do projeto. Nunca remova colunas sem um plano de migração.
- **Env vars** (ex.: `ADMIN_USER`/`ADMIN_PASSWORD` para bootstrap automático) sobrevivem ao deploy/rollback — não precisa refazer.

## Limitações conscientes na Cloudflare

- **D1 tem latência de rede** por query (na VPS é arquivo local) — ok para uso micro.
- **Rate limit em KV é eventual** (isolates efêmeros) — suficiente para uso pessoal.
- **Blobs** (attachments/replays) vão para R2; a pasta local `DATA_DIR` não existe no Worker.
