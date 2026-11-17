-- Pisi senkron sunucusu, şema sürümü 1 (docs/sync-protocol.md §12).
-- Göçler yalnız `php app/bin/migrate.php` ile çalışır. Her ifade `;` ile biter.
-- Sunucu dosya yolu, ad ya da düz token saklamaz: *_enc sütunları istemcinin
-- şifreli zarflarıdır, token'lar SHA-256 özetidir.

CREATE TABLE spaces (
    space_id VARCHAR(25) NOT NULL,
    name_enc VARBINARY(4096) NULL,
    key_epoch INT NOT NULL DEFAULT 1,
    head BIGINT NOT NULL DEFAULT 0,
    pruned_through BIGINT NOT NULL DEFAULT 0,
    usage_bytes BIGINT NOT NULL DEFAULT 0,
    quota_bytes BIGINT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (space_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE devices (
    device_id VARCHAR(25) NOT NULL,
    space_id VARCHAR(25) NOT NULL,
    role ENUM('admin', 'member') NOT NULL,
    token_hash CHAR(64) NULL,
    label_enc VARBINARY(4096) NULL,
    created_at DATETIME(3) NOT NULL,
    last_seen_at DATETIME(3) NULL,
    last_protocol INT NULL,
    revoked_at DATETIME(3) NULL,
    PRIMARY KEY (device_id),
    UNIQUE KEY devices_token (token_hash),
    KEY devices_space (space_id),
    CONSTRAINT devices_space_fk FOREIGN KEY (space_id) REFERENCES spaces (space_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE pairings (
    pairing_id VARCHAR(25) NOT NULL,
    space_id VARCHAR(25) NOT NULL,
    device_id VARCHAR(25) NOT NULL,
    created_by VARCHAR(25) NOT NULL,
    desktop_key VARCHAR(100) NOT NULL,
    code_hash CHAR(64) NULL,
    state ENUM('open', 'claimed', 'granted', 'collected', 'rejected', 'cancelled', 'expired') NOT NULL,
    method ENUM('qr', 'code') NULL,
    device_key VARCHAR(100) NULL,
    proof VARCHAR(64) NULL,
    label_enc VARBINARY(4096) NULL,
    token_hash CHAR(64) NULL,
    wrapped_key VARBINARY(4096) NULL,
    role ENUM('admin', 'member') NULL,
    failed_attempts INT NOT NULL DEFAULT 0,
    expires_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (pairing_id),
    UNIQUE KEY pairings_code (code_hash),
    UNIQUE KEY pairings_device (device_id),
    KEY pairings_space (space_id, state),
    CONSTRAINT pairings_space_fk FOREIGN KEY (space_id) REFERENCES spaces (space_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE heads (
    space_id VARCHAR(25) NOT NULL,
    fid CHAR(45) NOT NULL,
    seq BIGINT NOT NULL,
    op ENUM('put', 'delete') NOT NULL,
    blob_id CHAR(45) NULL,
    size BIGINT NOT NULL DEFAULT 0,
    device_id VARCHAR(25) NOT NULL,
    at DATETIME(3) NOT NULL,
    meta_enc VARBINARY(16384) NOT NULL,
    PRIMARY KEY (space_id, fid),
    UNIQUE KEY heads_seq (space_id, seq),
    KEY heads_blob (space_id, blob_id),
    CONSTRAINT heads_space_fk FOREIGN KEY (space_id) REFERENCES spaces (space_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE changes (
    space_id VARCHAR(25) NOT NULL,
    seq BIGINT NOT NULL,
    fid CHAR(45) NOT NULL,
    op ENUM('put', 'delete') NOT NULL,
    blob_id CHAR(45) NULL,
    size BIGINT NOT NULL DEFAULT 0,
    device_id VARCHAR(25) NOT NULL,
    commit_id VARCHAR(25) NOT NULL,
    at DATETIME(3) NOT NULL,
    meta_enc VARBINARY(16384) NOT NULL,
    PRIMARY KEY (space_id, seq),
    KEY changes_fid (space_id, fid),
    KEY changes_blob (space_id, blob_id),
    KEY changes_at (space_id, at),
    CONSTRAINT changes_space_fk FOREIGN KEY (space_id) REFERENCES spaces (space_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE blobs (
    space_id VARCHAR(25) NOT NULL,
    blob_id CHAR(45) NOT NULL,
    size BIGINT NOT NULL,
    sha256 CHAR(64) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    last_ref_at DATETIME(3) NOT NULL,
    PRIMARY KEY (space_id, blob_id),
    KEY blobs_ref (space_id, last_ref_at),
    CONSTRAINT blobs_space_fk FOREIGN KEY (space_id) REFERENCES spaces (space_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE uploads (
    upload_id VARCHAR(25) NOT NULL,
    space_id VARCHAR(25) NOT NULL,
    blob_id CHAR(45) NOT NULL,
    size BIGINT NOT NULL,
    sha256 CHAR(64) NOT NULL,
    part_bytes BIGINT NOT NULL,
    parts_received LONGTEXT NOT NULL CHECK (JSON_VALID(parts_received)),
    created_at DATETIME(3) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    PRIMARY KEY (upload_id),
    KEY uploads_space (space_id),
    KEY uploads_expiry (expires_at),
    CONSTRAINT uploads_space_fk FOREIGN KEY (space_id) REFERENCES spaces (space_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE commits (
    space_id VARCHAR(25) NOT NULL,
    commit_id VARCHAR(25) NOT NULL,
    body_sha256 CHAR(64) NOT NULL,
    seqs LONGTEXT NOT NULL CHECK (JSON_VALID(seqs)),
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (space_id, commit_id),
    KEY commits_created (created_at),
    CONSTRAINT commits_space_fk FOREIGN KEY (space_id) REFERENCES spaces (space_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE rate_limits (
    bucket VARCHAR(100) NOT NULL,
    window_start BIGINT NOT NULL,
    count INT NOT NULL DEFAULT 0,
    expires_at BIGINT NOT NULL,
    PRIMARY KEY (bucket, window_start),
    KEY rate_limits_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
