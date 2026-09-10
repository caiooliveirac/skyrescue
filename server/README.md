# skyrescue-api

API de **autenticação** e **registro de casos** do SkyRescue. Node + Express + PostgreSQL, sem framework pesado. Roda no servidor **magalu** dos apps irmãos, como serviço systemd (`skyrescue-api.service`, código em `/home/ubuntu/skyrescue/server`, env em `server/.env`), atrás do nginx (`goa.mnrs.com.br` faz proxy de `/api` → `127.0.0.1:3012`).

## Arquitetura

- **Auth:** senha com `crypto.scrypt` (nativo, sem dependência C), sessão em cookie httpOnly (`sky_sess`) com token cujo hash SHA-256 fica na tabela `sessions`. TTL padrão 12h.
- **Casos:** registro compartilhado — todo usuário autenticado vê todos os casos, cada um com autoria (`created_by`) e trilha em `case_audit`. O snapshot completo do app vai em `cases.snapshot` (jsonb); colunas promovidas (score, local, tempos…) servem à listagem/relatório.
- **Perfis:** `admin` (gerencia usuários e o WhatsApp), `gestor` (conta interna de configuração: valida pontos de pouso e mantém os contatos das centrais SAMU — sem usuários nem WhatsApp), `regulador`, `operador`.

## Variáveis de ambiente (`server/.env`, só no servidor)

```
DATABASE_URL=postgres://skyrescue:SENHA@127.0.0.1:5432/skyrescue
SESSION_TTL_HOURS=12
SEED_ADMIN_USER=goa.samu     # usado só na 1ª migration (quando não há usuários)
SEED_ADMIN_PASS=samu@192
TELEGRAM_BOT_TOKEN=...       # bot da missão (sem ele: dry-run)
BOT_LINK_CODE=...            # código do /vincular — Telegram E WhatsApp
# bot do WhatsApp (chip da regulação, pareado em Config → WhatsApp):
# WA_AUTH_DIR=/home/ubuntu/skyrescue/server/.wa-auth   # sessão (padrão); fora do rsync do deploy
# WHATSAPP_DISABLED=1                                   # desliga o bot (dev)
# WA_LOG_LEVEL=error                                    # log interno do Baileys
```

A sessão do WhatsApp (`.wa-auth/`) são as chaves do chip: trate como segredo, não versione, e apague-a ao desativar o servidor (ou toque em **desconectar** no painel, que também remove o dispositivo no celular).

## Banco (criado uma vez no servidor)

```sql
CREATE ROLE skyrescue LOGIN PASSWORD '...';
CREATE DATABASE skyrescue OWNER skyrescue;
```

`npm run migrate` aplica `db/schema.sql` (idempotente) e cria o admin inicial se a tabela `users` estiver vazia.

## Criar / gerenciar usuários

Pelo CLI no servidor (`cd /home/ubuntu/skyrescue/server`):

```bash
set -a; . ./.env; set +a
node scripts/create-user.js joao.silva 'senhaForte' regulador "Dr. João Silva"
```

Ou pela API (autenticado como `admin`): `POST /api/users`, `GET /api/users`, `PATCH /api/users/:id`.

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/login` | login → seta cookie de sessão |
| POST | `/api/auth/logout` | encerra a sessão |
| GET | `/api/auth/me` | usuário atual (401 se não logado) |
| POST | `/api/auth/password` | troca a própria senha |
| GET | `/api/cases` | lista casos (todos, com autoria) |
| GET | `/api/cases/:id` | caso completo (snapshot) |
| POST | `/api/cases` | registra caso |
| PUT | `/api/cases/:id` | atualiza caso |
| DELETE | `/api/cases/:id` | exclui caso (auditado) |
| GET/POST/PATCH | `/api/users…` | admin de usuários (perfil admin) |
| POST | `/api/acionamentos` | **público** (tela Acionar GOA): grava o pedido e o bot do WhatsApp avisa; limite por IP/global |
| GET | `/api/acionamentos` | histórico dos pedidos do site (autenticado) |
| GET | `/api/whatsapp/status` | admin: estado do bot, código/QR de pareamento, grupo, plantonistas |
| POST | `/api/whatsapp/pair` | admin: gera código de pareamento (`{phone}`) ou QR (sem phone) |
| POST | `/api/whatsapp/logout` | admin: desconecta o chip e apaga a sessão |
| POST | `/api/whatsapp/test` | admin: mensagem de teste ao grupo e aos plantonistas |
| POST/PATCH/DELETE | `/api/whatsapp/recipients…` | admin: plantonistas que recebem no privado |
| DELETE | `/api/whatsapp/group` | admin: desvincula o grupo |
| GET | `/api/health` | status + conexão ao banco |

## Operação (systemd)

```bash
sudo systemctl status skyrescue-api
sudo journalctl -u skyrescue-api -f
sudo systemctl restart skyrescue-api
```

O deploy é automático via GitHub Actions (`.github/workflows/deploy.yml`): rsync do `server/`, `npm ci`, `migrate`, `systemctl restart` e healthcheck de `/api/health`. O `server/.env` e o `node_modules/` ficam apenas no servidor (não são versionados nem sobrescritos).
