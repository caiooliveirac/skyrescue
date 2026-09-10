# wa-bridge — WhatsApp do bot da missão

Processo Go (whatsmeow) que liga um número de WhatsApp à API Node. Sem regra
de negócio: `POST /send` envia, mensagem recebida vira `POST /api/wa/inbound`.

Build (sem cgo, cross-compila do Mac):

    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o wa-bridge .

Env (no `.env` da API): `WA_SECRET` (obrigatório), `WA_HTTP_ADDR` (padrão
127.0.0.1:3812), `WA_WEBHOOK` (padrão http://127.0.0.1:3012/api/wa/inbound),
`WA_DB` (padrão wa-session.db), `WA_PAIR_PHONE` (opcional: 55DDDNÚMERO, pareia
por código em vez de QR).

Primeiro uso: subir o processo, olhar o log — QR (ou código, se WA_PAIR_PHONE)
— e ligar em WhatsApp > Aparelhos conectados. A sessão fica em `WA_DB`; se o
celular desconectar o aparelho, apagar o arquivo e parear de novo.

Vincular o grupo: no grupo (ou no privado do número), mandar `vincular <BOT_LINK_CODE>`.
Comandos: caso, tempos, goa, lz, passagem, ajuda; confirmações: `lz ok`, `passagem feita`.

LIVE: unit `skyrescue-wa.service` (arquivo aqui ao lado). LAB: pm2 `lab-skyrescue-wa`.
