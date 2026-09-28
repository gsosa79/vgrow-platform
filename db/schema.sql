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
