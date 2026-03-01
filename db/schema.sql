-- schema.sql

CREATE TABLE IF NOT EXISTS patents (
    patent_id       VARCHAR(50) PRIMARY KEY,
    abstract        TEXT,
    claims          TEXT,
    description     TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patents_abstract ON patents USING GIN (to_tsvector('russian', abstract));
CREATE INDEX IF NOT EXISTS idx_patents_claims   ON patents USING GIN (to_tsvector('russian', claims));