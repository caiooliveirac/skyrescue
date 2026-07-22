-- ============================================================
-- SkyRescue — schema de auth + registro de casos (PostgreSQL 16)
-- Idempotente: pode rodar várias vezes (migrate.js aplica no boot).
-- ============================================================

-- ---------- usuários ----------
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,            -- formato scrypt: N:r:p:salt:hash (hex)
  full_name     TEXT,
  role          TEXT        NOT NULL DEFAULT 'regulador'
                            CHECK (role IN ('admin', 'regulador', 'operador')),
  active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

-- ---------- sessões ----------
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT        PRIMARY KEY,           -- sha256(token) — o token cru só existe no cookie
  user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  user_agent  TEXT,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user_idx    ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

-- ---------- casos (registro de acionamento) ----------
CREATE TABLE IF NOT EXISTS cases (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_ref         TEXT,                         -- identificador informado (NÃO-PII)
  created_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- campos promovidos p/ listagem e relatório
  scene_label      TEXT,
  scene_lat        DOUBLE PRECISION,
  scene_lon        DOUBLE PRECISION,
  score_total      INTEGER,
  score_band       TEXT,
  recommendation   TEXT,
  hospital_name    TEXT,
  air_total_min    NUMERIC,
  ground_total_min NUMERIC,
  delta_min        NUMERIC,
  gates_ok         BOOLEAN,
  notes            TEXT,
  -- snapshot completo do app (fonte da verdade p/ reabrir o caso)
  snapshot         JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS cases_created_by_idx ON cases (created_by);
CREATE INDEX IF NOT EXISTS cases_created_at_idx ON cases (created_at DESC);
CREATE INDEX IF NOT EXISTS cases_ref_idx        ON cases (case_ref);

-- ---------- pontos de pouso sugeridos pela comunidade ----------
-- Usuário logado sugere um local onde a equipe já pousou (campo de futebol,
-- frente de prefeitura…). Nasce 'pendente' (marcador âmbar no mapa) e só
-- entra na base com a cor padrão quando um admin valida ('aprovado').
CREATE TABLE IF NOT EXISTS community_lz (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,                        -- observação operacional (acesso, obstáculos, histórico de pousos)
  municipio   TEXT,
  lat         DOUBLE PRECISION NOT NULL,
  lon         DOUBLE PRECISION NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pendente'
              CHECK (status IN ('pendente', 'aprovado', 'rejeitado')),
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT
);
CREATE INDEX IF NOT EXISTS community_lz_status_idx ON community_lz (status);

-- ---------- fotos dos pontos de pouso ----------
-- "como o local é": quem já pousou fotografa e anexa ao ponto. A imagem chega
-- já reduzida pelo navegador (JPEG ~1280 px, <500 kB — abaixo do limite padrão
-- de corpo do nginx) e fica no próprio banco: entra no backup junto com o
-- resto e sobrevive ao deploy, que faz rsync --delete em server/.
CREATE TABLE IF NOT EXISTS lz_photo (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lz_id      BIGINT NOT NULL REFERENCES community_lz(id) ON DELETE CASCADE,
  mime       TEXT   NOT NULL,               -- image/jpeg | image/webp | image/png
  bytes      BYTEA  NOT NULL,
  size_bytes INTEGER NOT NULL,
  width      INTEGER,
  height     INTEGER,
  caption    TEXT,                          -- ex.: "aproximação pelo norte, fios na cerca"
  taken_at   TIMESTAMPTZ,                   -- quando a foto foi tirada (informado pelo cliente)
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lz_photo_lz_idx ON lz_photo (lz_id, created_at);

-- ---------- posição da aeronave (rastreamento ao vivo) ----------
-- O modo navegação do piloto reporta a posição a cada ~5 s; a regulação
-- consulta e mostra o helicóptero no mapa. Uma linha por aeronave (upsert).
CREATE TABLE IF NOT EXISTS aircraft_position (
  aircraft_id TEXT PRIMARY KEY DEFAULT 'goa',
  lat         DOUBLE PRECISION NOT NULL,
  lon         DOUBLE PRECISION NOT NULL,
  gs_kmh      REAL,                       -- groundspeed
  track       REAL,                       -- rumo verdadeiro (graus)
  acc_m       REAL,                       -- precisão do fix
  reported_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- bot despachante da missão (Telegram) ----------
-- Um grupo vinculado por instalação (linha única); uma missão ativa por
-- caso acionado no grupo, com controle das confirmações e da cadência
-- dos avisos de posição.
CREATE TABLE IF NOT EXISTS bot_chat (
  id        SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  chat_id   BIGINT NOT NULL,
  title     TEXT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mission_chat (
  case_id          BIGINT PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
  chat_id          BIGINT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'encerrada')),
  created_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  handover_at      TIMESTAMPTZ,  -- passagem do caso confirmada no grupo
  handover_by      TEXT,
  lz_ready_at      TIMESTAMPTZ,  -- "LZ segura" confirmada no grupo
  lz_ready_by      TEXT,
  last_pos_post_at TIMESTAMPTZ,  -- cadência dos avisos de deslocamento
  near_alerted     BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------- trilha de auditoria dos casos ----------
CREATE TABLE IF NOT EXISTS case_audit (
  id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id  BIGINT,                               -- sem FK: preserva histórico após DELETE
  user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action   TEXT NOT NULL,                        -- 'create' | 'update' | 'delete'
  at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  case_ref TEXT
);
CREATE INDEX IF NOT EXISTS case_audit_case_idx ON case_audit (case_id);
