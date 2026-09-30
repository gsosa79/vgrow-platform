-- Vgrow Platform · estructura de la base de datos (MySQL 8)
-- Se puede correr varias veces: no borra nada que ya exista.

CREATE TABLE IF NOT EXISTS empresas (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  nombre            VARCHAR(200) NOT NULL,
  email             VARCHAR(200) NOT NULL,
  email_corporativo TINYINT(1)   NOT NULL DEFAULT 0,
  sector            VARCHAR(100),
  pais              VARCHAR(60),
  tamano            VARCHAR(60),
  ultimo_score      DECIMAL(4,1),
  ultimo_semaforo   VARCHAR(20),
  origen            VARCHAR(40),
  creado            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_empresa_email (email, nombre),
  KEY ix_sector (sector, pais)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS diagnosticos (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id  INT NOT NULL,
  diag_ref    VARCHAR(40),
  score       DECIMAL(4,1),
  semaforo    VARCHAR(20),
  sector      VARCHAR(100),
  pais        VARCHAR(60),
  tamano      VARCHAR(60),
  datos       JSON,
  creado      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_diag (empresa_id, diag_ref),
  KEY ix_creado (creado),
  CONSTRAINT fk_diag_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Para el login que viene (plataforma.vgrowapp.com)
CREATE TABLE IF NOT EXISTS usuarios (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  email          VARCHAR(200) NOT NULL UNIQUE,
  nombre         VARCHAR(200),
  empresa_id     INT NULL,
  rol            VARCHAR(20) NOT NULL DEFAULT 'empresario',
  password_hash  VARCHAR(255) NULL,
  verificado     TINYINT(1) NOT NULL DEFAULT 0,
  creado         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultimo_acceso  DATETIME NULL,
  CONSTRAINT fk_usuario_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Registro crudo de todo lo que llega (auditoría)
CREATE TABLE IF NOT EXISTS eventos (
  id      BIGINT AUTO_INCREMENT PRIMARY KEY,
  tipo    VARCHAR(40) NOT NULL,
  email   VARCHAR(200),
  ip      VARCHAR(64),
  datos   JSON,
  creado  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_email (email),
  KEY ix_creado (creado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Dataset de referencia: empresas anónimas que alimentan benchmark, índices, leads y marketplace.
-- Se llena con deploy/cargar-datos.sh (desde db/datos/dataset.json).
CREATE TABLE IF NOT EXISTS dataset_empresas (
  ref            VARCHAR(10)  NOT NULL PRIMARY KEY,
  sector         VARCHAR(100) NOT NULL,
  pais           VARCHAR(60)  NOT NULL,
  tamano         VARCHAR(30)  NOT NULL,
  margen         DECIMAL(5,1) NOT NULL,
  crecimiento    DECIMAL(5,1) NOT NULL,
  score_eco      DECIMAL(3,1) NOT NULL,
  score_gestion  DECIMAL(3,1) NOT NULL,
  score_total    DECIMAL(3,1) NOT NULL,
  caja_meses     DECIMAL(4,1) NOT NULL,
  semaforo       VARCHAR(20)  NOT NULL,
  ventas         INT          NOT NULL,
  costos         INT          NOT NULL,
  etapa          VARCHAR(40),
  orden          SMALLINT     NOT NULL DEFAULT 0,
  activo         TINYINT(1)   NOT NULL DEFAULT 1,
  actualizado    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_dataset_sector (sector, pais, tamano)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Referencias por sector (Uruguay). Se llena desde db/datos/benchmarks.json.
CREATE TABLE IF NOT EXISTS benchmarks_sector (
  sector          VARCHAR(100) NOT NULL PRIMARY KEY,
  margen_min      DECIMAL(5,1) NOT NULL,
  margen_max      DECIMAL(5,1) NOT NULL,
  margen_prom     DECIMAL(5,1) NOT NULL,
  crec_prom       DECIMAL(5,1) NOT NULL,
  caja_prom       DECIMAL(4,1) NOT NULL,
  cobertura_prom  DECIMAL(4,2) NOT NULL,
  score_prom      DECIMAL(3,1) NOT NULL,
  een_vab         DECIMAL(5,1) NULL,
  een_vab_sector  VARCHAR(100) NULL,
  empleo_var      DECIMAL(5,1) NULL,
  empleo_sector   VARCHAR(100) NULL,
  fuente_margen   VARCHAR(200),
  orden           SMALLINT     NOT NULL DEFAULT 0,
  activo          TINYINT(1)   NOT NULL DEFAULT 1,
  actualizado     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
