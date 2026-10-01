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

-- ═══ Identidad y arquitectura ═══════════════════════════════════════════════
-- usuarios → organizaciones (con rol) → empresas → periodos → diagnosticos.
-- Las columnas nuevas de tablas que ya existían (empresas, diagnosticos) las agrega db/migrar.js.

CREATE TABLE IF NOT EXISTS organizaciones (
  id      INT AUTO_INCREMENT PRIMARY KEY,
  nombre  VARCHAR(200) NOT NULL,
  creado  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Rol del usuario en cada organización: dueño o contador
CREATE TABLE IF NOT EXISTS miembros (
  usuario_id       INT NOT NULL,
  organizacion_id  INT NOT NULL,
  rol              ENUM('dueno','contador') NOT NULL DEFAULT 'dueno',
  creado           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (usuario_id, organizacion_id),
  KEY ix_miembro_org (organizacion_id),
  CONSTRAINT fk_miembro_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  CONSTRAINT fk_miembro_org FOREIGN KEY (organizacion_id) REFERENCES organizaciones(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Un período por empresa y mes; cada diagnóstico cae en un período
CREATE TABLE IF NOT EXISTS periodos (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id  INT NOT NULL,
  anio        SMALLINT NOT NULL,
  mes         TINYINT NOT NULL,
  creado      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_periodo (empresa_id, anio, mes),
  CONSTRAINT fk_periodo_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Acciones con código fijo (armadas a partir de las recomendaciones de la plataforma)
CREATE TABLE IF NOT EXISTS acciones_catalogo (
  codigo       VARCHAR(40)  NOT NULL PRIMARY KEY,
  palanca      VARCHAR(20)  NOT NULL,
  titulo       VARCHAR(200) NOT NULL,
  descripcion  TEXT,
  activo       TINYINT(1)   NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO acciones_catalogo (codigo, palanca, titulo, descripcion) VALUES
  ('MARGEN_PRECIO_B2B', 'margen', 'Revisá si podés ajustar tu propuesta de valor para sostener un precio mayor', 'En B2B el precio se negocia cliente a cliente: identificar a quién se le puede subir sin riesgo de perderlo.'),
  ('MARGEN_MIX', 'margen', 'Revisá si hay productos o servicios con margen más alto que podrías priorizar', 'Calcular el margen real por producto o servicio y enfocar el esfuerzo en las líneas que más dejan.'),
  ('VENTAS_CLIENTES_ACTUALES', 'ventas', 'Desarrollá a tus clientes actuales antes de buscar nuevos', 'Contactar a los clientes actuales con una propuesta concreta de qué más se les puede ofrecer.'),
  ('VENTAS_MEJORES_CLIENTES', 'ventas', 'Identificá cuáles de tus clientes tienen más potencial de crecimiento', 'Analizar quiénes son los mejores clientes y qué tienen en común para saber a quién más contactar.'),
  ('ESTRUCTURA_REVISAR', 'estructura', 'Revisá qué costos fijos podés reducir o renegociar este mes', 'Listar los costos fijos y marcar los que no son imprescindibles: suscripciones, servicios, contratos viejos.'),
  ('CAJA_PLAN_12_SEMANAS', 'caja', 'Armá un plan de caja para las próximas 12 semanas', 'Anotar semana por semana lo que se espera cobrar y pagar, y actuar antes de una semana en rojo.'),
  ('GESTION_PRESUPUESTO', 'gestion', 'Armar un presupuesto anual', 'Sin presupuesto no hay referencia para medir.'),
  ('GESTION_REVISION_MENSUAL', 'gestion', 'Revisar tus números una vez por mes', 'Así se ven los cambios a tiempo.')
ON DUPLICATE KEY UPDATE palanca = VALUES(palanca), titulo = VALUES(titulo), descripcion = VALUES(descripcion);

-- Acción recomendada a una empresa en un período, su estado y el período siguiente
-- (para ligar la acción con lo que muestra el diagnóstico siguiente, sin afirmar causalidad)
CREATE TABLE IF NOT EXISTS acciones_empresa (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id            INT NOT NULL,
  accion_codigo         VARCHAR(40) NOT NULL,
  periodo_id            INT NOT NULL,
  diagnostico_id        INT NULL,
  estado                ENUM('recomendada','en_curso','hecha','descartada') NOT NULL DEFAULT 'recomendada',
  periodo_siguiente_id  INT NULL,
  creado                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_accion_periodo (empresa_id, periodo_id, accion_codigo),
  CONSTRAINT fk_acc_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  CONSTRAINT fk_acc_codigo FOREIGN KEY (accion_codigo) REFERENCES acciones_catalogo(codigo),
  CONSTRAINT fk_acc_periodo FOREIGN KEY (periodo_id) REFERENCES periodos(id),
  CONSTRAINT fk_acc_siguiente FOREIGN KEY (periodo_siguiente_id) REFERENCES periodos(id),
  CONSTRAINT fk_acc_diag FOREIGN KEY (diagnostico_id) REFERENCES diagnosticos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Plan de cada empresa. Todas arrancan en Freemium. proveedor_pago queda vacío hasta conectar Mercado Pago o Stripe.
CREATE TABLE IF NOT EXISTS suscripciones (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id      INT NOT NULL,
  plan            ENUM('freemium','basic','pro') NOT NULL DEFAULT 'freemium',
  estado          ENUM('activa','cancelada','vencida') NOT NULL DEFAULT 'activa',
  desde           DATE NOT NULL,
  hasta           DATE NULL,
  proveedor_pago  VARCHAR(40) NULL,
  creado          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_susc_empresa (empresa_id, estado),
  CONSTRAINT fk_susc_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Links mágicos de ingreso (se guarda solo el hash del token; vencen a los 15 minutos y se usan una vez)
CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash  CHAR(64) NOT NULL PRIMARY KEY,
  email       VARCHAR(200) NOT NULL,
  vence       DATETIME NOT NULL,
  usado       DATETIME NULL,
  ip          VARCHAR(64),
  creado      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_token_email (email, creado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Sesiones (cookie httpOnly de 30 días; se guarda solo el hash)
CREATE TABLE IF NOT EXISTS sesiones (
  token_hash  CHAR(64) NOT NULL PRIMARY KEY,
  usuario_id  INT NOT NULL,
  empresa_id  INT NULL,
  vence       DATETIME NOT NULL,
  creado      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultimo_uso  DATETIME NULL,
  KEY ix_sesion_usuario (usuario_id),
  CONSTRAINT fk_sesion_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Cada pedido a la IA: para la cuota por empresa y las métricas por día y por plan
CREATE TABLE IF NOT EXISTS ia_uso (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  empresa_id    INT NULL,
  usuario_id    INT NULL,
  tipo          VARCHAR(30) NOT NULL,
  plan          VARCHAR(20) NOT NULL,
  modelo        VARCHAR(60) NULL,
  mes           CHAR(7) NOT NULL,
  cuenta        TINYINT(1) NOT NULL DEFAULT 0,
  guardado      TINYINT(1) NOT NULL DEFAULT 0,
  alerta_usada  TINYINT(1) NOT NULL DEFAULT 0,
  creado        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_ia_empresa_mes (empresa_id, mes),
  KEY ix_ia_creado (creado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Respuestas guardadas: la explicación se regenera solo si cambian los números (huella)
CREATE TABLE IF NOT EXISTS ia_respuestas (
  empresa_id  INT NOT NULL,
  tipo        VARCHAR(30) NOT NULL,
  huella      CHAR(64) NOT NULL,
  texto       TEXT NOT NULL,
  modelo      VARCHAR(60),
  creado      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (empresa_id, tipo, huella)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Briefing del mercado: uno por día, igual para todos
CREATE TABLE IF NOT EXISTS ia_briefing (
  fecha   DATE NOT NULL PRIMARY KEY,
  texto   TEXT NOT NULL,
  modelo  VARCHAR(60),
  creado  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ═══ Email mensual de retorno ═══════════════════════════════════════════════
-- Un registro por email: nunca se manda dos veces el mismo (mismo diagnóstico, usuario y tipo).
-- El clic del botón se registra con un token propio de cada email (se guarda solo el hash).
CREATE TABLE IF NOT EXISTS emails_retorno (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id      INT NOT NULL,
  usuario_id      INT NOT NULL,
  diagnostico_id  INT NOT NULL,
  tipo            ENUM('mensual','recordatorio') NOT NULL,
  token_hash      CHAR(64) NOT NULL,
  enviado         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  clic            DATETIME NULL,
  UNIQUE KEY uq_email_retorno (diagnostico_id, usuario_id, tipo),
  UNIQUE KEY uq_email_token (token_hash),
  KEY ix_email_enviado (enviado),
  CONSTRAINT fk_ret_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  CONSTRAINT fk_ret_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  CONSTRAINT fk_ret_diag FOREIGN KEY (diagnostico_id) REFERENCES diagnosticos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Tareas que corren una vez por día (aunque la app se reinicie o haya más de una instancia)
CREATE TABLE IF NOT EXISTS tareas_diarias (
  nombre  VARCHAR(40) NOT NULL,
  fecha   DATE NOT NULL,
  creado  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (nombre, fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
