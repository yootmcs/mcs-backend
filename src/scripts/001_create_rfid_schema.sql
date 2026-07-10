-- =====================================================================
-- 001_create_rfid_schema.sql
-- MCS CRM — RFID / Inventory schema
-- Target DB: mcs_backend  (PostgreSQL 13+)
-- =====================================================================

BEGIN;

-- gen_random_uuid() lives in pgcrypto on older servers; safe to ensure it.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- 1. products
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    product_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sku             varchar(50) UNIQUE NOT NULL,
    name            varchar(200) NOT NULL,
    product_type    varchar(20) CHECK (product_type IN ('consumable', 'serialized_equipment')),
    price           numeric(10, 2),
    packaging_type  varchar(50),
    is_active       boolean DEFAULT true,
    created_at      timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 2. rfid_tags
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rfid_tags (
    tag_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    epc_code    varchar(96) UNIQUE NOT NULL,
    tid_code    varchar(64),
    product_id  uuid REFERENCES products(product_id),
    tag_type    varchar(20) CHECK (tag_type IN ('label', 'hard_tag')),
    status      varchar(20) DEFAULT 'active' CHECK (status IN ('active', 'sold', 'returned', 'lost')),
    eas_active  boolean DEFAULT true,
    lot_number  varchar(50),
    mfd_date    date,
    exp_date    date,
    printed_at  timestamptz,
    created_at  timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 3. stock_levels
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_levels (
    product_id      uuid PRIMARY KEY REFERENCES products(product_id),
    qty_total       integer DEFAULT 0,
    qty_available   integer DEFAULT 0,
    qty_reserved    integer DEFAULT 0,
    qty_min_alert   integer DEFAULT 10,
    updated_at      timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 4. stock_transactions
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_transactions (
    txn_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id  uuid REFERENCES products(product_id),
    tag_id      uuid REFERENCES rfid_tags(tag_id),
    txn_type    varchar(20) CHECK (txn_type IN ('receive', 'pack', 'sell', 'return', 'adjust', 'count')),
    qty_change  integer NOT NULL,
    note        text,
    staff_id    varchar(100),
    created_at  timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 5. packing_sessions
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS packing_sessions (
    packing_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_ref   varchar(100),
    status      varchar(20) DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'packed', 'shipped')),
    is_verified boolean DEFAULT false,
    staff_id    varchar(100),
    packed_at   timestamptz,
    created_at  timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Trigger: keep stock_levels in sync with every stock_transactions row
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_stock_transaction()
RETURNS trigger AS $$
BEGIN
    -- Skip rows with no product reference (nothing to aggregate against).
    IF NEW.product_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Ensure a stock_levels row exists, then apply the delta.
    -- qty_change is signed: positive for receive/return, negative for sell/pack.
    INSERT INTO stock_levels (product_id, qty_total, qty_available, updated_at)
    VALUES (NEW.product_id, NEW.qty_change, NEW.qty_change, now())
    ON CONFLICT (product_id) DO UPDATE
        SET qty_total     = stock_levels.qty_total + NEW.qty_change,
            qty_available = stock_levels.qty_available + NEW.qty_change,
            updated_at    = now();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_apply_stock_transaction ON stock_transactions;

CREATE TRIGGER trg_apply_stock_transaction
    AFTER INSERT ON stock_transactions
    FOR EACH ROW
    EXECUTE FUNCTION apply_stock_transaction();

-- ---------------------------------------------------------------------
-- Helpful indexes for foreign-key lookups
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_rfid_tags_product_id          ON rfid_tags(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_transactions_product_id ON stock_transactions(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_transactions_tag_id     ON stock_transactions(tag_id);

COMMIT;
