# SkyRescue β — Apoio à Decisão Aeromédica

MVP para a regulação do SAMU 192 Salvador avaliar acionamento do helicóptero do GOA/CBMBA (base em Simões Filho): score de elegibilidade, tempos aéreo × terrestre, meteorologia, áreas de pouso e acompanhamento da missão. Interface dark "mission control" em React, otimizada para decisão rápida: a faixa superior mostra o score, a recomendação e os gates o tempo todo.

## Usar agora (sem instalar nada)

Abra o arquivo `dist/index.html` em qualquer navegador com internet. Todo o app está embutido nesse único arquivo — pode copiá-lo para um pendrive ou enviar para a central.

## Rodar em desenvolvimento

Requisitos: [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm run dev      # abre em http://localhost:5173
npm run build    # gera dist/index.html (arquivo único)
```

## Publicar na web (opcional)

O build é estático: hospede `dist/` no Netlify, Vercel ou GitHub Pages (arraste a pasta no Netlify Drop e pronto).

## Modelo de helipontos (Salvador/RMS)

- **Heliponto no próprio hospital**: Hospital do Subúrbio, Hospital Metropolitano (Lauro de Freitas) e Hospital Municipal de Salvador — desembarque direto.
- **HGE (centro de trauma)**: sem heliponto próprio. O app calcula o desembarque no **heliponto do IML Nina Rodrigues** (padrão) ou do **Hospital Mater Dei**, com transbordo curto de ambulância até o HGE.
- **Rede privada que empresta heliponto** (mediante coordenação prévia): Hospital Aliança e Hospital Cardio Pulmonar — disponíveis no seletor "Heliponto de desembarque".
- Hospitais sem heliponto e sem apoio associado: pouso em LZ próxima + transbordo (tempo configurável).

## Primeiro uso — calibrar (5 min)

1. Arraste o marcador do helicóptero no mapa até a posição exata da base do GOA.
2. Ative **Ajustar posições** no mapa e arraste hospitais e helipontos para o lugar certo (ou edite lat/lon em **Config** — botão "buscar" geocodifica pelo endereço).
3. Em **Config**, confira quais hospitais têm heliponto próprio (Heli) e o heliponto de apoio de cada um.
4. Ajuste velocidade de cruzeiro, tempos fixos e fator de trânsito conforme a experiência real da equipe.
5. (Opcional) Cadastre bases SAMU para sugestão automática do ETA da ambulância.

Tudo fica salvo no navegador do computador (localStorage) — nada vai para servidor.

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
