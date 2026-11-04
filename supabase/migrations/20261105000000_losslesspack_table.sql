-- Migration: 20261105000000_losslesspack_table.sql
-- Recommended production layout for losslesspack compressed storage

CREATE TABLE IF NOT EXISTS compressed_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Filterable columns for SQL queries and dashboard filters
    tenant_id VARCHAR(64) NOT NULL,
    entity_type VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Compressed data container (LLP1 binary bytea)
    payload BYTEA NOT NULL,

    -- Observability & audit metadata
    algorithm SMALLINT NOT NULL, -- 0=store, 1=gzip, 2=brotli, 3=zstd
    original_size BIGINT NOT NULL,
    compressed_size BIGINT NOT NULL,
    sha256 CHAR(64) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for dashboard filtering
CREATE INDEX IF NOT EXISTS idx_compressed_records_filter 
    ON compressed_records (tenant_id, entity_type, recorded_at DESC);

-- Index for keyset cursor pagination
CREATE INDEX IF NOT EXISTS idx_compressed_records_keyset 
    ON compressed_records (id ASC);