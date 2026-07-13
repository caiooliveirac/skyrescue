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

`git push` na `main` dispara o GitHub Actions ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)): publica o backend (`skyrescue-api` no PM2, porta 3012) e o frontend estático em `/var/www/skyrescue`, com healthcheck e auto-rollback. Detalhes de infra e criação de usuários em [`server/README.md`](server/README.md).

## Modelo de helipontos (Salvador/RMS)

- **Heliponto no próprio hospital**: Hospital do Subúrbio, Hospital Metropolitano (Lauro de Freitas) e Hospital Municipal de Salvador — desembarque direto.
- **HGE (centro de trauma)**: sem heliponto próprio. O app calcula o desembarque no **heliponto do IML Nina Rodrigues** (padrão) ou do **Hospital Mater Dei**, com transbordo curto de ambulância até o HGE.
- **Rede privada que empresta heliponto** (mediante coordenação prévia): Hospital Aliança e Hospital Cardio Pulmonar — disponíveis no seletor "Heliponto de desembarque".
- Hospitais sem heliponto e sem apoio associado: pouso em LZ próxima + transbordo (tempo configurável).

## Modo navegação (piloto)

O botão **Navegar** no mapa abre uma tela cheia estilo "Waze aéreo" para uso no tablet a bordo: posição GPS ao vivo (seta apontando o rumo, rastro do voo e círculo de precisão), HUD com **GS** (km/h e kt), **rumo verdadeiro**, **distância** (km e NM), **ETE/ETA** até o alvo, e linha-guia direta ao ponto selecionado (**CENA/LZ → DESTINO → BASE**, trocável em voo). A orientação do mapa alterna entre **N ↑** (norte verdadeiro em cima) e **RUMO ↑** (a direção do voo fica para cima e o mapa gira — leaflet-rotate). A tela fica sempre acesa (Wake Lock) e o mapa segue a aeronave (arrastar pausa; "Seguir" retoma). Requer HTTPS + permissão de localização no dispositivo; rumo e distâncias são verdadeiros (GPS), sem correção magnética. Em dev, o botão **SIM** simula um voo da base ao alvo na velocidade de cruzeiro. Apoio à consciência situacional — não substitui instrumentos nem cartas aeronáuticas.

## Pontos de pouso da comunidade

Usuários logados podem sugerir locais onde a equipe já pousou (campo de futebol, praça, pátio de prefeitura…) pelo botão **Comunidade** no mapa: clica-se no local (coordenadas ajustáveis à mão no formulário) e a sugestão aparece para todos como um **H âmbar tracejado** — deixando claro que foi adicionada por usuário e ainda não validada. Quando um **admin valida**, o ponto assume a cor padrão da base, passa a integrar o ranking de **áreas de pouso** perto da ocorrência (badge "Validada — pouso de rotina") e leva junto a observação operacional de quem sugeriu. Pontos rejeitados saem do mapa (o autor e o admin ainda os veem na lista). Não são helipontos homologados: reconhecimento visual pelo piloto continua obrigatório.

## Primeiro uso — calibrar (5 min)

1. Arraste o marcador do helicóptero no mapa até a posição exata da base do GOA.
2. Ative **Ajustar posições** no mapa e arraste hospitais e helipontos para o lugar certo (ou edite lat/lon em **Config** — botão "buscar" geocodifica pelo endereço).
3. Em **Config**, confira quais hospitais têm heliponto próprio (Heli) e o heliponto de apoio de cada um.
4. Ajuste velocidade de cruzeiro, tempos fixos e fator de trânsito conforme a experiência real da equipe.
5. (Opcional) Cadastre bases SAMU para sugestão automática do ETA da ambulância.

A calibração (base, hospitais, tempos) fica no navegador do computador (localStorage). Já os **casos** são registrados no servidor, com o usuário que os criou.

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
- Não insira dados pessoais de pacientes (LGPD). Use identificadores de caso.
- Servidores públicos (OSRM demo, Overpass) têm limites de uso — adequados para piloto/validação; para produção, ver `ESPECIFICACAO.md` (roadmap).

Especificação completa do sistema (para evoluir com desenvolvedor ou IA): **`ESPECIFICACAO.md`**.
