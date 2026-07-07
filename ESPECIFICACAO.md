# SkyRescue — Especificação do Sistema (prompt completo)

Este documento é o "prompt" do sistema: entregue-o a qualquer desenvolvedor ou IA para reconstruir, auditar ou evoluir o SkyRescue.

## 1. Contexto e problema

O SAMU 192 Salvador passou a contar com o Grupamento de Operações Aéreas do CBMBA (helicóptero AS350 B2 Esquilo, base no CIA, Simões Filho-BA, operação VFR diurna). Não existe protocolo definido de quando acionar o recurso aéreo: hoje o acionamento depende de o médico regulador (MR) lembrar que a aeronave existe. Não há acesso ao sistema proprietário do SAMU, então o SkyRescue funciona de forma independente: o MR alimenta poucos dados e recebe um score de elegibilidade, análise logística completa e acompanhamento da missão.

## 2. Usuários e princípios

- Usuário primário: médico regulador; secundários: rádio-operador/TARM, equipe do GOA.
- Apoio à decisão, nunca decisão automática. A palavra final é do MR (clínica) e do comandante da aeronave (operacional).
- Poucos cliques: caso típico preenchido em <60 s.
- LGPD: nenhum dado pessoal de paciente; identificadores de caso apenas; armazenamento local.

## 3. Entradas do MR

1. Local da ocorrência: endereço/rodovia+km (geocodificação Nominatim), coordenadas coladas, ou clique no mapa.
2. Checklist clínico-operacional (seção 5).
3. Hospital de destino (lista pré-configurada, com sugestão automática pelo perfil clínico).
4. ETA da ambulância mais próxima até a cena (manual; ou sugerido por rota a partir de bases SAMU cadastradas).
5. Gates manuais: aeronave disponível, equipe disponível, segurança preservada.

## 4. Cálculos

### 4.1 Tempos (minutos; parâmetros configuráveis)

- **Aéreo** = acionamento→decolagem (10) + [voo base→heliponto de pickup + embarque equipe SAMU (7), se habilitado] + voo base→cena + pouso/embarque paciente (10) + voo cena→hospital + desembarque em heliponto (5) OU pouso em LZ + transbordo (15).
- Voo = distância haversine × fator de rota (1,05) ÷ cruzeiro (200 km/h AS350) × 60.
- **Terrestre** = ETA ambulância→cena + atendimento na cena (15) + rota OSRM cena→hospital × fator de trânsito (1,25).
- Δ = terrestre − aéreo. Exibir barras comparativas por etapa.

### 4.2 Autonomia

Percurso total (base→[pickup]→cena→hospital→base) deve caber em 80% do alcance útil (550 km padrão).

### 4.3 Janela diurna (VFR)

Com pôr do sol (Open-Meteo daily): falha se (agora + tempo aéreo total + margem 20 min) > pôr do sol; alerta se folga < ~40 min. Configurável para operação noturna.

### 4.4 Meteorologia (indicativa — decisão final: piloto/REDEMET)

Open-Meteo na cena E na base; pior condição governa. METAR SBSV exibido quando disponível.
- **Desfavorável**: trovoada (WMO 95/96/99), visibilidade <3 km, rajadas >65 km/h (~35 kt), chuva >7 mm/h.
- **Marginal**: visibilidade 3–5 km, rajadas 46–65 km/h, chuva 2–7 mm/h, nevoeiro, nuvens ≥90%.
- **Favorável**: caso contrário.

### 4.5 Áreas de pouso (LZ)

Overpass/OSM no raio configurável (1,5 km): helipontos, estádios, campos/quadras, áreas esportivas, praias, parques/gramados, estacionamentos abertos. Para cada candidato: distância ao paciente, dimensões aproximadas (bounding box; referência AS350: mínimo ~28–30 m, ideal campo de futebol), obstáculos próximos (redes elétricas/torres/mastros OSM a <150 m ⇒ alerta). Ranking: tipo > obstáculo > distância. LZ manual por clique no mapa. Sempre exibir: "reconhecimento visual pelo piloto é obrigatório".

## 5. Pontuação SkyRescue

Faixas (conforme concepção original): **0–4 🟢 terrestre preferencial · 5–8 🟡 avaliação do MR · ≥9 🔴 forte indicação**. Máximo teórico 18.

| Seção | Itens | Pontos | Teto |
|---|---|---|---|
| Localização | difícil acesso, congestionamento, rodovia distante, zona rural, ilha, serra/mata, sem acesso rápido | 1 cada | 3 |
| Tempo | terrestre >60 min (AUTO); aeronave reduz ≥20 min ou ≥30% (AUTO); condição tempo-dependente beneficia-se | 3 / 2 / 2 | 7 |
| Gravidade | trauma (alta energia, TCE GCS≤8, instab. hemodinâmica, amputação, torácico, abdominal, pélvico, politrauma, queimadura grave, transfusão maciça); clínico (IAMCSST, AVC em janela, choques, IRpA, mal epiléptico, PCR c/ RCE); pediatria; obstetrícia | 3 cada | 6 |
| Centro especializado | trauma, neurocirurgia, hemodinâmica, queimados, ECMO, UTI ped, terciário | 2 cada | 2 |

Itens AUTO são pré-marcados pelos cálculos e podem ser sobrescritos pelo MR (com opção "voltar ao automático").

### Gates (não pontuam — qualquer falha ⇒ "INVIÁVEL NO MOMENTO", independente do score)

Aeronave disponível · equipe disponível · meteorologia compatível (auto) · janela diurna (auto) · LZ viável (auto) · autonomia (auto) · segurança preservada. Gates automáticos têm override explícito (forçar OK / forçar NÃO) registrado.

## 6. Saídas

1. Banner de recomendação (verde/amarelo/vermelho/inviável) + barra de score.
2. Comparativo de tempos por etapa (aéreo × terrestre) + Δ.
3. Painel meteorológico (cena, base, METAR, pôr do sol).
4. Lista ranqueada de LZ com dimensões, distância e obstáculos + mapa (base, cena, hospitais, LZ, rotas aérea/terrestre, camada de obstáculos).
5. Alertas de segurança consolidados.
6. Acompanhamento: cronologia com timestamps (acionamento→decolagem→pouso cena→contato→decolagem→pouso destino→entrega→liberada), previsto × real.
7. Registro: salvar caso (local), copiar resumo para rádio/telefone, imprimir ficha assinável, exportar JSON.

## 7. Arquitetura do MVP

SPA React + Vite + Leaflet, sem backend; APIs públicas chamadas do navegador; configuração e casos em localStorage; build single-file (`dist/index.html`) para distribuição trivial. Estrutura: `src/lib` (geo, api, score, mission, lz — funções puras testáveis) e `src/components` (Map, Checklist, Results, Tracking, Config).

## 8. Roadmap (pós-MVP)

1. **Validação**: rodar em paralelo com a regulação real por 30–60 dias; comparar recomendações × decisões × desfechos; recalibrar pesos e tempos fixos com os timestamps coletados (previsto × real).
2. Backend leve (auth, casos compartilhados entre reguladores, auditoria) — ex.: Supabase/Postgres.
3. Banco de LZ **validadas pelo GOA** (sobrepondo as sugestões OSM), com fotos e notas do piloto.
4. Meteorologia oficial: REDEMET (API do DECEA) + minima operacional definida com o GOA.
5. Roteamento com trânsito real (Google/TomTom) e AVL das ambulâncias quando houver integração.
6. PWA mobile para a equipe da aeronave (acompanhamento em voo, offline-first).
7. Notificações (WhatsApp/Telegram) para acionar o GOA com o resumo padrão.
8. Painel de indicadores: tempo-resposta, taxa de acionamento por faixa de score, overtriage/undertriage.
9. Formalização: transformar o score calibrado em protocolo institucional SAMU/SESAB/CBMBA (nota técnica), citando referências (NAEMSP, ACS-COT, Portaria GM/MS 2048).

## 9. Limitações declaradas

Estimativas de voo em linha reta com fator fixo; OSRM sem trânsito; OSM pode omitir obstáculos (fios novos, árvores); Open-Meteo não substitui METAR/TAF; coordenadas padrão de base/hospitais exigem calibração inicial pela equipe.
