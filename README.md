# SkyRescue β — Apoio à Decisão Aeromédica

MVP para a regulação do SAMU 192 Salvador avaliar acionamento do helicóptero do GOA/CBMBA (base em Simões Filho): score de elegibilidade, tempos aéreo × terrestre, meteorologia, áreas de pouso e acompanhamento da missão. Interface dark "mission control" em React, otimizada para decisão rápida: a faixa superior mostra o score, a recomendação e os gates o tempo todo.

## Acesso

A versão em produção (**https://goa.mnrs.com.br**) exige **login** e registra os casos no servidor (Postgres) com autoria e trilha de auditoria — ver [`server/`](server/README.md). Acesso restrito à equipe autorizada; os usuários são criados pelo administrador.

> A partir da introdução do backend, o app **não** funciona mais aberto direto do disco (`file://`): login e registro de casos dependem da API. O restante (mapa, score, tempos, meteorologia) continua no navegador.

## Rodar em desenvolvimento

Requisitos: [Node.js](https://nodejs.org) 18+ e PostgreSQL.

```bash
# 1) backend (API + banco)
cd server && npm install
createdb skyrescue_dev
DATABASE_URL=postgres://localhost/skyrescue_dev npm run migrate   # cria schema + admin goa.samu
DATABASE_URL=postgres://localhost/skyrescue_dev npm start          # porta 3012

# 2) frontend (noutro terminal, na raiz) — o Vite faz proxy de /api → 3012
npm install
npm run dev      # http://localhost:5173
npm run build    # gera dist/index.html (arquivo único, servido pelo nginx)
```

## Deploy (produção)

`git push` na `main` dispara o GitHub Actions ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)): publica no servidor **magalu** o backend (`skyrescue-api` via systemd, porta 3012, código em `/home/ubuntu/skyrescue/server`) e o frontend estático em `/var/www/goa`, com healthcheck e auto-rollback. Detalhes de infra e criação de usuários em [`server/README.md`](server/README.md).

## Modelo de helipontos (Salvador/RMS)

- **Heliponto no próprio hospital**: Hospital do Subúrbio, Hospital Metropolitano (Lauro de Freitas) e Hospital Municipal de Salvador — desembarque direto.
- **HGE (centro de trauma)**: sem heliponto próprio. O app calcula o desembarque no **heliponto do IML Nina Rodrigues** (padrão) ou do **Hospital Mater Dei**, com transbordo curto de ambulância até o HGE.
- **Rede privada que empresta heliponto** (mediante coordenação prévia): Hospital Aliança e Hospital Cardio Pulmonar — disponíveis no seletor "Heliponto de desembarque".
- Hospitais sem heliponto e sem apoio associado: pouso em LZ próxima + transbordo (tempo configurável).

## Modo navegação (piloto)

O botão **Navegar** no mapa abre uma tela cheia estilo "Waze aéreo" para uso no tablet a bordo: posição GPS ao vivo (seta apontando o rumo, rastro do voo e círculo de precisão), HUD com **GS** (km/h e kt), **rumo verdadeiro**, **distância** (km e NM), **ETE/ETA** até o alvo, e linha-guia direta ao ponto selecionado (**CENA/LZ → DESTINO → BASE**, trocável em voo). A orientação do mapa alterna entre **N ↑** (norte verdadeiro em cima) e **RUMO ↑** (a direção do voo fica para cima e o mapa gira — leaflet-rotate). A tela fica sempre acesa (Wake Lock) e o mapa segue a aeronave (arrastar pausa; "Seguir" retoma). Requer HTTPS + permissão de localização no dispositivo; rumo e distâncias são verdadeiros (GPS), sem correção magnética. Em dev, o botão **SIM** simula um voo da base ao alvo na velocidade de cruzeiro. Apoio à consciência situacional — não substitui instrumentos nem cartas aeronáuticas.

**Rastreamento ao vivo pela regulação**: enquanto o modo navegação está aberto, o tablet reporta a posição ao servidor (~5 s, rota `/api/aircraft/position`, upsert de uma linha por aeronave). O mapa da regulação consulta a cada 10 s e mostra o GOA como uma seta ciano apontando o rumo, com rastro do trajeto e tooltip (velocidade, horário, quem reporta). Se o dado parar de chegar (pouso, tablet fechado, sem sinal de celular), o marcador some sozinho após 90 s.

## Bot da missão (Telegram)

Botão **Grupo da missão** no card Registro: salva o caso e o bot posta no grupo do Telegram (solicitante + médico da ambulância + médico do heli + pilotos) — tudo **determinístico**, sem IA:

- **Briefing** enxuto: caso, score/recomendação, cena e **ponto de encontro com link do Maps + coordenadas DDM**, destino (com transbordo se houver) e tempos estimados;
- **Preparação do ponto de encontro** (4 itens) com botão "✅ LZ SEGURA";
- **Cobrança da passagem do caso** entre médicos (peso, IOT, acessos, medicações) com botão "✅ Passagem feita";
- **Eco de cada horário** marcado no acompanhamento da missão (com autor; correções saem como "(corrigido)");
- **Avisos de deslocamento** alimentados pelo rastreamento: a cada 5 min em voo ("X km do encontro, ETE ~Y min") e um único alerta de **~2 min** ("LZ pronta e isolada?");
- **Encerramento** com a cronologia completa quando o comandante marca "Aeronave liberada".

Setup: criar o bot no @BotFather, definir `TELEGRAM_BOT_TOKEN` e `BOT_LINK_CODE` no `.env.production` do servidor, adicionar o bot ao grupo e enviar `/vincular <código>`. Sem token, o servidor roda em **dry-run** (mensagens só no log). Comando `/caso` no grupo repete o briefing da missão ativa.

**Menu de comandos.** Os comandos são registrados no Telegram (`setMyCommands`) quando o serviço sobe, então aparecem sozinhos no menu **/** do campo de digitação — com escopos separados: o grupo da operação vê só o que se usa em missão, e `/vincular` (instalação) fica na conversa privada, para ninguém rebobinar o vínculo do grupo no meio de um acionamento. O briefing e o `/ajuda` trazem um menu de botões com as mesmas ações.

| Comando | O que faz |
|---|---|
| `/caso` | briefing da missão ativa |
| `/tempos` | horários já marcados e qual é o próximo marco |
| `/goa` | onde a aeronave está agora, distância e ETE do ponto de encontro |
| `/lz` | checklist do ponto de encontro + coordenadas, com o botão "LZ SEGURA" |
| `/passagem` | cobra a passagem do caso, com o botão "Passagem feita" |
| `/ajuda` | menu do bot |

Sem missão ativa todos respondem que não há missão em vez de inventar dados — é o estado do grupo na maior parte do tempo. `/goa` distingue os três estados do rastreamento (nunca reportou · sinal velho · em voo). Coberto por `node server/scripts/test-menu.js`.

**Uma instância por token.** Dois servidores rodando a API com o mesmo `TELEGRAM_BOT_TOKEN` derrubam o long polling um do outro (`409 Conflict`) e o bot fica mudo. Ao migrar de servidor, desative o serviço antigo e remova o token do `.env` dele antes de subir o novo.

**Missão fantasma — o bot nunca fala de um caso velho.** A missão só sairia de "ativa" quando alguém marca *Aeronave liberada*, e no plantão isso falha (fim de turno, aba fechada, missão abortada): a missão ficava ativa para sempre e dias depois o bot voltava a falar dela. Três defesas independentes, em `server/src/telegram.js`:

1. **TTL na consulta** — fora da janela (`MISSION_TTL_HOURS`, padrão 12 h) o bot se cala, mesmo que nenhuma varredura tenha rodado;
2. **varredura** a cada 15 min (e no boot, e no `migrate.js`) encerra em silêncio as missões órfãs, para não persistirem;
3. **acionar uma missão nova encerra as anteriores** — o GOA é uma aeronave só.

Ainda há um teto de **250 km** entre a aeronave e o ponto de encontro: mais que isso não é esta missão e o ETE não sai. Regressão coberta por `node server/scripts/test-missao.js` (roda contra o banco de dev, em dry-run).

## Pontos de pouso da comunidade

Usuários logados podem sugerir locais onde a equipe já pousou (campo de futebol, praça, pátio de prefeitura…) pelo botão **Comunidade** no mapa: clica-se no local (coordenadas ajustáveis à mão no formulário) e a sugestão aparece para todos como um **H âmbar tracejado** — deixando claro que foi adicionada por usuário e ainda não validada. Quando um **admin valida**, o ponto assume a cor padrão da base, passa a integrar o ranking de **áreas de pouso** perto da ocorrência (badge "Validada — pouso de rotina") e leva junto a observação operacional de quem sugeriu. Pontos rejeitados saem do mapa (o autor e o admin ainda os veem na lista). Cada ponto aceita **fotos do local** (seção seguinte). Não são helipontos homologados: reconhecimento visual pelo piloto continua obrigatório.

## Fotos do ponto de pouso — "como o local é"

**Qualquer ponto de pouso do mapa aceita foto**: heliponto ANAC do catálogo, heliponto de hospital, heliponto de apoio, ponto da comunidade e as áreas candidatas a LZ da ocorrência. Quem já pousou fotografa; quem for pousar depois vê o terreno antes de chegar.

**Um toque no marcador** abre o local com as fotos e o botão de anexar — em qualquer modo do mapa, sem precisar sair do "Marcar LZ" ou do "Comunidade" (o clique no marcador nunca chegaria ao mapa mesmo). Marcadores que já têm foto ganham um **selo de câmera**, então dá para saber olhando o mapa onde existe registro visual. No celular o botão abre a câmera traseira direto (`capture="environment"`). Também dá para anexar pela lista em **Comunidade**, e logo após cadastrar um ponto novo o app já oferece a câmera — é o momento em que a equipe ainda está no local.

Qualquer usuário logado anexa (até **12 fotos por ponto**, com legenda opcional do tipo "aproximação pelo norte, fios na cerca"); excluir, só quem enviou ou o admin.

A imagem é **reduzida no próprio navegador** antes de subir (lado maior 1280 px, JPEG recomprimido até <500 kB — ver [`src/lib/photo.js`](src/lib/photo.js)): cabe no limite padrão de corpo do nginx sem mudar a configuração do servidor e economiza dado do 4G a bordo. Os bytes ficam no Postgres (`lz_photo`), então entram no backup do banco e sobrevivem ao deploy, que faz `rsync --delete` em `server/`.

Cada foto é presa ao ponto pelo mesmo identificador que o app já usa nos candidatos a LZ — `cat/SBSV` (ANAC), `hosp/hge`, `pad/iml`, `com/12` (comunidade), `way/123` (OSM) — o que permite fotografar pontos que não moram no banco, como os do catálogo ANAC. A API aceita só JPEG/WebP/PNG (SVG é recusado — vetor de XSS) e serve as imagens autenticadas em `/api/lz-photos/:id`. `GET /api/lz-photos/counts` traz a contagem de todos os pontos numa chamada só, que é o que alimenta os selos do mapa sem uma requisição por marcador.

> As fotos são referência da equipe e envelhecem (obra, cerca nova, mato alto) — reconhecimento visual pelo piloto continua obrigatório. Não fotografe pacientes nem nada que identifique a vítima (LGPD).

## Primeiro uso — calibrar (5 min)

1. Arraste o marcador do helicóptero no mapa até a posição exata da base do GOA.
2. Ative **Ajustar posições** no mapa e arraste hospitais e helipontos para o lugar certo (ou edite lat/lon em **Config** — botão "buscar" geocodifica pelo endereço).
3. Em **Config**, confira quais hospitais têm heliponto próprio (Heli) e o heliponto de apoio de cada um.
4. Ajuste velocidade de cruzeiro, tempos fixos e fator de trânsito conforme a experiência real da equipe.
5. (Opcional) Cadastre bases SAMU para sugestão automática do ETA da ambulância.

A calibração (base, hospitais, tempos) fica no navegador do computador (localStorage). Já os **casos** são registrados no servidor, com o usuário que os criou.

## Rascunho: fechou, reabriu, está tudo lá

No plantão ninguém clica em "Salvar" antes de sair — o tablet dorme, a bateria acaba, a aba é fechada com o caso pela metade. Todo o estado do caso em edição (local, pontuação, gates, destino, marcos, observações) é espelhado no navegador a cada mudança e regravado **na hora** em que a aba some (`visibilitychange`/`pagehide` — no iOS o `beforeunload` não dispara). Ao reabrir, o caso volta sozinho, com uma faixa dizendo de quando é o rascunho e um botão para descartá-lo.

Cobre recarregar a página, fechar a aba, fechar o navegador, crash/queda de energia e aba descartada pelo sistema em segundo plano. O rascunho é **por usuário** (o computador da regulação é compartilhado: o rascunho de um plantonista não aparece para o próximo que logar) e expira em 36 h, para trabalho antigo não ressuscitar. Ele não substitui a gravação no servidor — continua sendo o "Salvar/Atualizar caso" que registra o caso para a equipe e para o bot; é rede de segurança contra perder o que foi digitado. Implementação em `src/lib/draft.js`.

## Ficha do paciente (prontuário)

Preenchida durante a ocorrência e exportada como HTML → PDF, assinável no gov.br. É **do caso**, não do aparelho: fica no servidor (tabela `case_patient`) e sincroniza ao vivo, então o que o médico acrescenta no celular aparece para quem está na regulação, e reabrir o caso em qualquer aparelho traz a ficha de volta.

Contém dado identificável de paciente, e por isso é a única parte do sistema que contém:

- **Tabela própria**, fora de `cases.snapshot` — o snapshot alimenta o briefing do Telegram, a listagem e o relatório, onde PII vazaria por construção. No poll de 5 s viaja só o carimbo de tempo (`patientAt`); o conteúdo só sai para quem pede `/api/cases/:id/patient`.
- **Gravação por campo** (merge no servidor, com a linha travada): duas pessoas preenchendo partes diferentes da ficha não apagam o campo uma da outra. Uma alteração remota nunca sobrescreve edição local ainda não gravada.
- **Auditoria de leitura e escrita** em `case_audit` (`patient_read` / `patient_write`), coalescida por usuário a cada 5 min.
- **Retenção**: a ficha vive e morre com o caso (`ON DELETE CASCADE`).
- **Espelho offline** no navegador (`src/lib/patient.js`), por usuário e por caso: em voo com 4G ruim é ele que segura o que foi digitado até a rede voltar.

Como é guardada em texto no Postgres, **backups e dumps deste banco contêm dado de paciente identificado** — tratar as cópias com o mesmo cuidado do banco de produção.

## Fluxo de uso na regulação

1. **Local** — busque o endereço/rodovia ou clique no mapa.
2. **Pontuação** — marque os critérios; os itens AUTO (tempo) se calculam sozinhos. A faixa no topo mostra a recomendação em tempo real.
3. **Condições (gates)** — meteorologia, janela diurna, LZ e autonomia são avaliados automaticamente; aeronave/equipe/segurança são manuais. Qualquer impeditivo bloqueia a recomendação.
4. **Operação** — destino, heliponto de desembarque, áreas de pouso perto da cena (campos de futebol, estádios, gramados, praias — com dimensões e obstáculos do OSM), tempos comparados e acompanhamento por marcos.

## Fontes de dados (gratuitas, chamadas do navegador)

| Dado | Fonte |
|---|---|
| Geocodificação | Nominatim / OpenStreetMap |
| Meteorologia | Open-Meteo (+ METAR SBSV via aviationweather.gov, melhor esforço) |
| Rota terrestre | OSRM (servidor demo, sem trânsito em tempo real) |
| Áreas de pouso e obstáculos | Overpass / OpenStreetMap |
| Mapa | CARTO dark (tiles) © OpenStreetMap © CARTO |

## Avisos importantes

- Ferramenta de **apoio à decisão** — não substitui o julgamento do médico regulador nem a decisão final do comandante da aeronave.
- Meteorologia e áreas de pouso são **indicativas**; reconhecimento visual pelo piloto é obrigatório e a fonte meteorológica oficial é a REDEMET.
- Dados pessoais de paciente **só na Ficha do paciente** (prontuário), que tem tabela própria, acesso restrito à equipe autorizada e todo acesso registrado em auditoria. Fora dela — identificador do caso, observações da regulação, nome do ponto de pouso — use identificadores, nunca dado identificável (LGPD).
- Servidores públicos (OSRM demo, Overpass) têm limites de uso — adequados para piloto/validação; para produção, ver `ESPECIFICACAO.md` (roadmap).

Especificação completa do sistema (para evoluir com desenvolvedor ou IA): **`ESPECIFICACAO.md`**.
