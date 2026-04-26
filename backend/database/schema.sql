--
-- PostgreSQL database dump
--

\restrict fF2PMVVhIH3NRhy2BfeNRf9bhg74EJxOB7v8jiEEi9iNJY3k6m93suiO0d5qBsi

-- Dumped from database version 16.13 (Homebrew)
-- Dumped by pg_dump version 16.13 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: estado_compra; Type: TYPE; Schema: public; Owner: adrianmartinlopez
--

CREATE TYPE public.estado_compra AS ENUM (
    'borrador',
    'enviada',
    'recibida',
    'cancelada'
);


ALTER TYPE public.estado_compra OWNER TO adrianmartinlopez;

--
-- Name: estado_lote; Type: TYPE; Schema: public; Owner: loga
--

CREATE TYPE public.estado_lote AS ENUM (
    'cuarentena',
    'aprobado',
    'rechazado'
);


ALTER TYPE public.estado_lote OWNER TO loga;

--
-- Name: estado_orden; Type: TYPE; Schema: public; Owner: loga
--

CREATE TYPE public.estado_orden AS ENUM (
    'borrador',
    'confirmada',
    'en_proceso',
    'completada',
    'cancelada'
);


ALTER TYPE public.estado_orden OWNER TO loga;

--
-- Name: estado_pedido; Type: TYPE; Schema: public; Owner: adrianmartinlopez
--

CREATE TYPE public.estado_pedido AS ENUM (
    'nuevo',
    'confirmado',
    'en_produccion',
    'completado',
    'cancelado'
);


ALTER TYPE public.estado_pedido OWNER TO adrianmartinlopez;

--
-- Name: tipo_movimiento; Type: TYPE; Schema: public; Owner: loga
--

CREATE TYPE public.tipo_movimiento AS ENUM (
    'entrada',
    'salida',
    'ajuste',
    'produccion_consumo',
    'produccion_salida',
    'merma'
);


ALTER TYPE public.tipo_movimiento OWNER TO loga;

--
-- Name: tipo_producto; Type: TYPE; Schema: public; Owner: loga
--

CREATE TYPE public.tipo_producto AS ENUM (
    'materia_prima',
    'producto_terminado',
    'material_embalaje'
);


ALTER TYPE public.tipo_producto OWNER TO loga;

--
-- Name: fn_check_alerta_stock(); Type: FUNCTION; Schema: public; Owner: loga
--

CREATE FUNCTION public.fn_check_alerta_stock() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_producto RECORD;
  v_umbral NUMERIC;
  v_porcentaje NUMERIC;
BEGIN
  SELECT p.*, cg.porcentaje_alerta
  INTO v_producto
  FROM productos p, configuracion_global cg
  WHERE p.id = NEW.producto_id AND cg.id = 1;

  IF v_producto IS NULL THEN RETURN NEW; END IF;

  v_porcentaje := COALESCE(v_producto.porcentaje_alerta, 20);
  v_umbral := v_producto.stock_minimo * (1 + v_porcentaje / 100.0);

  IF v_producto.stock_actual <= v_umbral AND v_producto.stock_minimo > 0 THEN
    INSERT INTO notificaciones (tipo, titulo, mensaje, producto_id)
    VALUES (
      'alerta_stock',
      'Stock bajo: ' || v_producto.nombre,
      v_producto.nombre || ' tiene ' || ROUND(v_producto.stock_actual::NUMERIC, 2) || ' ' || v_producto.unidad_medida ||
      ' (minimo: ' || ROUND(v_producto.stock_minimo::NUMERIC, 2) || ')',
      v_producto.id
    )
    ON CONFLICT (producto_id, tipo) WHERE leida = FALSE DO UPDATE SET
      created_at = NOW(),
      mensaje = EXCLUDED.mensaje;
  ELSE
    -- Limpiar notificacion si stock vuelve a niveles normales
    UPDATE notificaciones SET leida = TRUE
    WHERE producto_id = NEW.producto_id AND tipo = 'alerta_stock' AND leida = FALSE;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_check_alerta_stock() OWNER TO loga;

--
-- Name: fn_numero_oc(); Type: FUNCTION; Schema: public; Owner: adrianmartinlopez
--

CREATE FUNCTION public.fn_numero_oc() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
BEGIN
  NEW.numero_oc := 'OC-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
    LPAD((SELECT COALESCE(MAX(CAST(SUBSTRING(numero_oc FROM '[0-9]+$') AS INT)), 0) + 1 FROM ordenes_compra)::TEXT, 5, '0');
  RETURN NEW;
END;
$_$;


ALTER FUNCTION public.fn_numero_oc() OWNER TO adrianmartinlopez;

--
-- Name: fn_numero_orden(); Type: FUNCTION; Schema: public; Owner: loga
--

CREATE FUNCTION public.fn_numero_orden() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.numero_orden IS NULL OR NEW.numero_orden = '' THEN
        NEW.numero_orden := 'OP-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
                            LPAD(nextval('seq_numero_orden')::TEXT, 5, '0');
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_numero_orden() OWNER TO loga;

--
-- Name: fn_numero_pedido(); Type: FUNCTION; Schema: public; Owner: adrianmartinlopez
--

CREATE FUNCTION public.fn_numero_pedido() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
BEGIN
  NEW.numero_pedido := 'PED-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
    LPAD((SELECT COALESCE(MAX(CAST(SUBSTRING(numero_pedido FROM '[0-9]+$') AS INT)), 0) + 1 FROM pedidos)::TEXT, 5, '0');
  RETURN NEW;
END;
$_$;


ALTER FUNCTION public.fn_numero_pedido() OWNER TO adrianmartinlopez;

--
-- Name: fn_set_updated_at(); Type: FUNCTION; Schema: public; Owner: loga
--

CREATE FUNCTION public.fn_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_set_updated_at() OWNER TO loga;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: auditoria; Type: TABLE; Schema: public; Owner: loga
--

CREATE TABLE public.auditoria (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    usuario_id uuid,
    fecha timestamp with time zone DEFAULT now() NOT NULL,
    accion character varying(50) NOT NULL,
    tabla_afectada character varying(100) NOT NULL,
    registro_id uuid,
    datos_antes jsonb,
    datos_despues jsonb,
    motivo text DEFAULT ''::text NOT NULL,
    ip_origen inet
);


ALTER TABLE public.auditoria OWNER TO loga;

--
-- Name: clientes; Type: TABLE; Schema: public; Owner: loga
--

CREATE TABLE public.clientes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre character varying(255) NOT NULL,
    email character varying(255),
    telefono character varying(50),
    direccion text,
    nif character varying(20),
    notas text,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.clientes OWNER TO loga;

--
-- Name: configuracion_global; Type: TABLE; Schema: public; Owner: loga
--

CREATE TABLE public.configuracion_global (
    id smallint DEFAULT 1 NOT NULL,
    porcentaje_alerta numeric(5,2) DEFAULT 20.00 NOT NULL,
    plantilla_email text DEFAULT 'Estimado proveedor,\n\nNecesitamos reponer el producto: {{producto}}\nCantidad sugerida: {{cantidad}} {{unidad}}\n\nPor favor confirme disponibilidad y plazo de entrega.\n\nSaludos,\nFábrica Loga'::text NOT NULL,
    email_remitente character varying(255) DEFAULT 'erp@loga.es'::character varying NOT NULL,
    smtp_host character varying(255) DEFAULT 'smtp.gmail.com'::character varying NOT NULL,
    smtp_port smallint DEFAULT 587 NOT NULL,
    smtp_user character varying(255) DEFAULT ''::character varying NOT NULL,
    smtp_pass_enc text DEFAULT ''::text NOT NULL,
    empresa_nombre character varying(255) DEFAULT 'Colas Loga S.L.'::character varying,
    empresa_cif character varying(20) DEFAULT ''::character varying,
    empresa_direccion text DEFAULT ''::text,
    empresa_telefono character varying(50) DEFAULT ''::character varying,
    empresa_web character varying(255) DEFAULT ''::character varying,
    CONSTRAINT configuracion_global_porcentaje_alerta_check CHECK (((porcentaje_alerta >= (0)::numeric) AND (porcentaje_alerta <= (100)::numeric))),
    CONSTRAINT solo_una_fila CHECK ((id = 1))
);


ALTER TABLE public.configuracion_global OWNER TO loga;

--
-- Name: historial_precios; Type: TABLE; Schema: public; Owner: loga
--

CREATE TABLE public.historial_precios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    producto_id uuid NOT NULL,
    tipo character varying(20) NOT NULL,
    precio_anterior numeric(20,6),
    precio_nuevo numeric(20,6) NOT NULL,
    motivo text,
    usuario_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT historial_precios_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['compra'::character varying, 'venta'::character varying])::text[])))
);


ALTER TABLE public.historial_precios OWNER TO loga;

--
-- Name: ingredientes_receta; Type: TABLE; Schema: public; Owner: loga
--

CREATE TABLE public.ingredientes_receta (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    receta_id uuid NOT NULL,
    materia_prima_id uuid NOT NULL,
    cantidad numeric(20,6) NOT NULL,
    porcentaje_merma numeric(5,2) DEFAULT 0 NOT NULL,
    unidad_medida character varying(20) DEFAULT 'kg'::character varying NOT NULL,
    CONSTRAINT ingredientes_receta_cantidad_check CHECK ((cantidad > (0)::numeric)),
    CONSTRAINT ingredientes_receta_porcentaje_merma_check CHECK (((porcentaje_merma >= (0)::numeric) AND (porcentaje_merma < (100)::numeric)))
);


ALTER TABLE public.ingredientes_receta OWNER TO loga;

--
-- Name: lineas_pedido; Type: TABLE; Schema: public; Owner: loga
--

CREATE TABLE public.lineas_pedido (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pedido_id uuid NOT NULL,
    producto_id uuid,
    producto_nombre character varying(255),
    cantidad numeric(20,6),
    unidad_medida character varying(20) DEFAULT 'kg'::character varying,
    notas text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    precio_unitario numeric(20,6),
    subtotal numeric(20,6)
);


ALTER TABLE public.lineas_pedido OWNER TO loga;

--
-- Name: lotes; Type: TABLE; Schema: public; Owner: loga
--

CREATE TABLE public.lotes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    producto_id uuid NOT NULL,
    lote_interno character varying(100) NOT NULL,
    lote_proveedor character varying(100),
    cantidad_inicial numeric(20,6) NOT NULL,
    cantidad_actual numeric(20,6) NOT NULL,
    fecha_fabricacion date,
    fecha_caducidad date,
    fecha_entrada date DEFAULT CURRENT_DATE NOT NULL,
    estado public.estado_lote DEFAULT 'cuarentena'::public.estado_lote NOT NULL,
    ubicacion character varying(100),
    observaciones text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    precio_compra numeric(20,6),
    CONSTRAINT caducidad_posterior CHECK (((fecha_caducidad IS NULL) OR (fecha_fabricacion IS NULL) OR (fecha_caducidad > fecha_fabricacion))),
    CONSTRAINT lotes_cantidad_actual_check CHECK ((cantidad_actual >= (0)::numeric)),
    CONSTRAINT lotes_cantidad_inicial_check CHECK ((cantidad_inicial > (0)::numeric))
);


ALTER TABLE public.lotes OWNER TO loga;

--
-- Name: notificaciones; Type: TABLE; Schema: public; Owner: loga
--

CREATE TABLE public.notificaciones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tipo character varying(50) DEFAULT 'alerta_stock'::character varying NOT NULL,
    titulo character varying(255) NOT NULL,
    mensaje text NOT NULL,
    producto_id uuid,
    leida boolean DEFAULT false NOT NULL,
    email_enviado boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.notificaciones OWNER TO loga;

--
-- Name: ordenes_compra; Type: TABLE; Schema: public; Owner: adrianmartinlopez
--

CREATE TABLE public.ordenes_compra (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    numero_oc character varying(50) NOT NULL,
    proveedor_id uuid,
    producto_id uuid NOT NULL,
    cantidad numeric(20,6) NOT NULL,
    precio_unitario numeric(20,6) DEFAULT 0,
    estado public.estado_compra DEFAULT 'borrador'::public.estado_compra NOT NULL,
    fecha_pedido date DEFAULT CURRENT_DATE,
    fecha_entrega_estimada date,
    fecha_recepcion date,
    notas text,
    lote_creado_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.ordenes_compra OWNER TO adrianmartinlopez;

--
-- Name: ordenes_produccion; Type: TABLE; Schema: public; Owner: loga
--

CREATE TABLE public.ordenes_produccion (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    numero_orden character varying(50) NOT NULL,
    receta_id uuid NOT NULL,
    cantidad_planificada numeric(20,6) NOT NULL,
    cantidad_producida numeric(20,6) DEFAULT 0 NOT NULL,
    estado public.estado_orden DEFAULT 'borrador'::public.estado_orden NOT NULL,
    lote_producido_id uuid,
    fecha_planificada date,
    fecha_inicio timestamp with time zone,
    fecha_fin timestamp with time zone,
    operario_id uuid,
    notas text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    cliente character varying(255),
    ph numeric(5,2),
    foto_url text,
    solidos numeric(5,2),
    viscosidad numeric(10,2),
    fecha_fabricacion timestamp with time zone,
    foto_urls jsonb DEFAULT '[]'::jsonb,
    cliente_id uuid,
    archivos jsonb DEFAULT '[]'::jsonb,
    CONSTRAINT ordenes_produccion_cantidad_planificada_check CHECK ((cantidad_planificada > (0)::numeric)),
    CONSTRAINT ordenes_produccion_cantidad_producida_check CHECK ((cantidad_producida >= (0)::numeric))
);


ALTER TABLE public.ordenes_produccion OWNER TO loga;

--
-- Name: pedidos; Type: TABLE; Schema: public; Owner: loga
--

CREATE TABLE public.pedidos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    numero_pedido character varying(50) NOT NULL,
    cliente_id uuid,
    cliente_nombre character varying(255),
    cliente_email character varying(255),
    producto_id uuid,
    producto_nombre character varying(255),
    cantidad numeric(20,6),
    unidad_medida character varying(20) DEFAULT 'kg'::character varying,
    fecha_entrega date,
    estado public.estado_pedido DEFAULT 'nuevo'::public.estado_pedido NOT NULL,
    origen character varying(50) DEFAULT 'manual'::character varying,
    email_asunto text,
    email_cuerpo text,
    notas text,
    orden_produccion_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    subtotal numeric(20,6) DEFAULT 0,
    portes numeric(20,6) DEFAULT 0,
    iva_porcentaje numeric(5,2) DEFAULT 21,
    total numeric(20,6) DEFAULT 0
);


ALTER TABLE public.pedidos OWNER TO loga;

--
-- Name: productos; Type: TABLE; Schema: public; Owner: loga
--

CREATE TABLE public.productos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    codigo character varying(50) NOT NULL,
    nombre character varying(255) NOT NULL,
    descripcion text,
    tipo public.tipo_producto DEFAULT 'materia_prima'::public.tipo_producto NOT NULL,
    unidad_medida character varying(20) DEFAULT 'kg'::character varying NOT NULL,
    stock_actual numeric(20,6) DEFAULT 0 NOT NULL,
    stock_minimo numeric(20,6) DEFAULT 0 NOT NULL,
    stock_maximo numeric(20,6) DEFAULT 0 NOT NULL,
    precio_unitario numeric(20,6) DEFAULT 0 NOT NULL,
    proveedor_id uuid,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    precio_venta numeric(20,6) DEFAULT 0,
    CONSTRAINT productos_precio_unitario_check CHECK ((precio_unitario >= (0)::numeric)),
    CONSTRAINT productos_stock_actual_check CHECK ((stock_actual >= (0)::numeric)),
    CONSTRAINT productos_stock_maximo_check CHECK ((stock_maximo >= (0)::numeric)),
    CONSTRAINT productos_stock_minimo_check CHECK ((stock_minimo >= (0)::numeric))
);


ALTER TABLE public.productos OWNER TO loga;

--
-- Name: proveedores; Type: TABLE; Schema: public; Owner: loga
--

CREATE TABLE public.proveedores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    telefono character varying(50),
    direccion text,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.proveedores OWNER TO loga;

--
-- Name: recetas; Type: TABLE; Schema: public; Owner: loga
--

CREATE TABLE public.recetas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    producto_id uuid NOT NULL,
    nombre character varying(255) NOT NULL,
    version smallint DEFAULT 1 NOT NULL,
    rendimiento numeric(20,6) DEFAULT 1 NOT NULL,
    activa boolean DEFAULT true NOT NULL,
    notas text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ph_min numeric(5,2),
    ph_max numeric(5,2),
    solidos_min numeric(5,2),
    solidos_max numeric(5,2),
    viscosidad_min numeric(10,2),
    viscosidad_max numeric(10,2),
    CONSTRAINT recetas_rendimiento_check CHECK ((rendimiento > (0)::numeric))
);


ALTER TABLE public.recetas OWNER TO loga;

--
-- Name: seq_numero_orden; Type: SEQUENCE; Schema: public; Owner: loga
--

CREATE SEQUENCE public.seq_numero_orden
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.seq_numero_orden OWNER TO loga;

--
-- Name: stock_moves; Type: TABLE; Schema: public; Owner: loga
--

CREATE TABLE public.stock_moves (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    producto_id uuid NOT NULL,
    lote_id uuid,
    tipo public.tipo_movimiento NOT NULL,
    cantidad numeric(20,6) NOT NULL,
    cantidad_antes numeric(20,6) NOT NULL,
    cantidad_despues numeric(20,6) NOT NULL,
    orden_id uuid,
    referencia_externa character varying(255),
    usuario_id uuid,
    motivo text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.stock_moves OWNER TO loga;

--
-- Name: usuarios; Type: TABLE; Schema: public; Owner: loga
--

CREATE TABLE public.usuarios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    password_hash text NOT NULL,
    rol character varying(20) DEFAULT 'trabajador'::character varying NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT usuarios_rol_check CHECK (((rol)::text = ANY ((ARRAY['admin'::character varying, 'trabajador'::character varying])::text[])))
);


ALTER TABLE public.usuarios OWNER TO loga;

--
-- Name: auditoria auditoria_pkey; Type: CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.auditoria
    ADD CONSTRAINT auditoria_pkey PRIMARY KEY (id);


--
-- Name: clientes clientes_pkey; Type: CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_pkey PRIMARY KEY (id);


--
-- Name: configuracion_global configuracion_global_pkey; Type: CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.configuracion_global
    ADD CONSTRAINT configuracion_global_pkey PRIMARY KEY (id);


--
-- Name: historial_precios historial_precios_pkey; Type: CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.historial_precios
    ADD CONSTRAINT historial_precios_pkey PRIMARY KEY (id);


--
-- Name: ingredientes_receta ingredientes_receta_pkey; Type: CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.ingredientes_receta
    ADD CONSTRAINT ingredientes_receta_pkey PRIMARY KEY (id);


--
-- Name: ingredientes_receta ingredientes_receta_receta_id_materia_prima_id_key; Type: CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.ingredientes_receta
    ADD CONSTRAINT ingredientes_receta_receta_id_materia_prima_id_key UNIQUE (receta_id, materia_prima_id);


--
-- Name: lineas_pedido lineas_pedido_pkey; Type: CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.lineas_pedido
    ADD CONSTRAINT lineas_pedido_pkey PRIMARY KEY (id);


--
-- Name: lotes lotes_lote_interno_key; Type: CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.lotes
    ADD CONSTRAINT lotes_lote_interno_key UNIQUE (lote_interno);


--
-- Name: lotes lotes_pkey; Type: CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.lotes
    ADD CONSTRAINT lotes_pkey PRIMARY KEY (id);


--
-- Name: notificaciones notificaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.notificaciones
    ADD CONSTRAINT notificaciones_pkey PRIMARY KEY (id);


--
-- Name: ordenes_compra ordenes_compra_numero_oc_key; Type: CONSTRAINT; Schema: public; Owner: adrianmartinlopez
--

ALTER TABLE ONLY public.ordenes_compra
    ADD CONSTRAINT ordenes_compra_numero_oc_key UNIQUE (numero_oc);


--
-- Name: ordenes_compra ordenes_compra_pkey; Type: CONSTRAINT; Schema: public; Owner: adrianmartinlopez
--

ALTER TABLE ONLY public.ordenes_compra
    ADD CONSTRAINT ordenes_compra_pkey PRIMARY KEY (id);


--
-- Name: ordenes_produccion ordenes_produccion_numero_orden_key; Type: CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.ordenes_produccion
    ADD CONSTRAINT ordenes_produccion_numero_orden_key UNIQUE (numero_orden);


--
-- Name: ordenes_produccion ordenes_produccion_pkey; Type: CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.ordenes_produccion
    ADD CONSTRAINT ordenes_produccion_pkey PRIMARY KEY (id);


--
-- Name: pedidos pedidos_numero_pedido_key; Type: CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.pedidos
    ADD CONSTRAINT pedidos_numero_pedido_key UNIQUE (numero_pedido);


--
-- Name: pedidos pedidos_pkey; Type: CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.pedidos
    ADD CONSTRAINT pedidos_pkey PRIMARY KEY (id);


--
-- Name: productos productos_codigo_key; Type: CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.productos
    ADD CONSTRAINT productos_codigo_key UNIQUE (codigo);


--
-- Name: productos productos_pkey; Type: CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.productos
    ADD CONSTRAINT productos_pkey PRIMARY KEY (id);


--
-- Name: proveedores proveedores_pkey; Type: CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.proveedores
    ADD CONSTRAINT proveedores_pkey PRIMARY KEY (id);


--
-- Name: recetas recetas_pkey; Type: CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.recetas
    ADD CONSTRAINT recetas_pkey PRIMARY KEY (id);


--
-- Name: recetas recetas_producto_id_version_key; Type: CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.recetas
    ADD CONSTRAINT recetas_producto_id_version_key UNIQUE (producto_id, version);


--
-- Name: stock_moves stock_moves_pkey; Type: CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.stock_moves
    ADD CONSTRAINT stock_moves_pkey PRIMARY KEY (id);


--
-- Name: usuarios usuarios_email_key; Type: CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_email_key UNIQUE (email);


--
-- Name: usuarios usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);


--
-- Name: idx_auditoria_fecha; Type: INDEX; Schema: public; Owner: loga
--

CREATE INDEX idx_auditoria_fecha ON public.auditoria USING btree (fecha DESC);


--
-- Name: idx_auditoria_tabla_registro; Type: INDEX; Schema: public; Owner: loga
--

CREATE INDEX idx_auditoria_tabla_registro ON public.auditoria USING btree (tabla_afectada, registro_id);


--
-- Name: idx_historial_precios_producto; Type: INDEX; Schema: public; Owner: loga
--

CREATE INDEX idx_historial_precios_producto ON public.historial_precios USING btree (producto_id, tipo, created_at DESC);


--
-- Name: idx_lineas_pedido_pedido; Type: INDEX; Schema: public; Owner: loga
--

CREATE INDEX idx_lineas_pedido_pedido ON public.lineas_pedido USING btree (pedido_id);


--
-- Name: idx_lotes_fifo; Type: INDEX; Schema: public; Owner: loga
--

CREATE INDEX idx_lotes_fifo ON public.lotes USING btree (producto_id, estado, fecha_caducidad, fecha_entrada) WHERE ((estado = 'aprobado'::public.estado_lote) AND (cantidad_actual > (0)::numeric));


--
-- Name: idx_notif_email_pending; Type: INDEX; Schema: public; Owner: loga
--

CREATE INDEX idx_notif_email_pending ON public.notificaciones USING btree (producto_id, email_enviado) WHERE (email_enviado = false);


--
-- Name: idx_notif_unique_unread; Type: INDEX; Schema: public; Owner: loga
--

CREATE UNIQUE INDEX idx_notif_unique_unread ON public.notificaciones USING btree (producto_id, tipo) WHERE (leida = false);


--
-- Name: idx_notificaciones_no_leidas; Type: INDEX; Schema: public; Owner: loga
--

CREATE INDEX idx_notificaciones_no_leidas ON public.notificaciones USING btree (leida, created_at DESC) WHERE (leida = false);


--
-- Name: idx_ordenes_estado_fecha; Type: INDEX; Schema: public; Owner: loga
--

CREATE INDEX idx_ordenes_estado_fecha ON public.ordenes_produccion USING btree (estado, fecha_planificada);


--
-- Name: idx_pedidos_cliente; Type: INDEX; Schema: public; Owner: loga
--

CREATE INDEX idx_pedidos_cliente ON public.pedidos USING btree (cliente_id);


--
-- Name: idx_pedidos_estado; Type: INDEX; Schema: public; Owner: loga
--

CREATE INDEX idx_pedidos_estado ON public.pedidos USING btree (estado);


--
-- Name: idx_productos_stock_alert; Type: INDEX; Schema: public; Owner: loga
--

CREATE INDEX idx_productos_stock_alert ON public.productos USING btree (stock_actual, stock_minimo) WHERE (activo = true);


--
-- Name: idx_stock_moves_lote; Type: INDEX; Schema: public; Owner: loga
--

CREATE INDEX idx_stock_moves_lote ON public.stock_moves USING btree (lote_id, created_at DESC);


--
-- Name: idx_stock_moves_orden; Type: INDEX; Schema: public; Owner: loga
--

CREATE INDEX idx_stock_moves_orden ON public.stock_moves USING btree (orden_id) WHERE (orden_id IS NOT NULL);


--
-- Name: idx_stock_moves_producto; Type: INDEX; Schema: public; Owner: loga
--

CREATE INDEX idx_stock_moves_producto ON public.stock_moves USING btree (producto_id, created_at DESC);


--
-- Name: idx_usuarios_email_lower; Type: INDEX; Schema: public; Owner: loga
--

CREATE INDEX idx_usuarios_email_lower ON public.usuarios USING btree (lower((email)::text));


--
-- Name: stock_moves no_delete_stock_moves; Type: RULE; Schema: public; Owner: loga
--

CREATE RULE no_delete_stock_moves AS
    ON DELETE TO public.stock_moves DO INSTEAD NOTHING;


--
-- Name: stock_moves no_update_stock_moves; Type: RULE; Schema: public; Owner: loga
--

CREATE RULE no_update_stock_moves AS
    ON UPDATE TO public.stock_moves DO INSTEAD NOTHING;


--
-- Name: stock_moves trg_alerta_stock; Type: TRIGGER; Schema: public; Owner: loga
--

CREATE TRIGGER trg_alerta_stock AFTER INSERT ON public.stock_moves FOR EACH ROW EXECUTE FUNCTION public.fn_check_alerta_stock();


--
-- Name: clientes trg_clientes_updated_at; Type: TRIGGER; Schema: public; Owner: loga
--

CREATE TRIGGER trg_clientes_updated_at BEFORE UPDATE ON public.clientes FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: lotes trg_lotes_updated_at; Type: TRIGGER; Schema: public; Owner: loga
--

CREATE TRIGGER trg_lotes_updated_at BEFORE UPDATE ON public.lotes FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: ordenes_compra trg_numero_oc; Type: TRIGGER; Schema: public; Owner: adrianmartinlopez
--

CREATE TRIGGER trg_numero_oc BEFORE INSERT ON public.ordenes_compra FOR EACH ROW EXECUTE FUNCTION public.fn_numero_oc();


--
-- Name: ordenes_produccion trg_numero_orden; Type: TRIGGER; Schema: public; Owner: loga
--

CREATE TRIGGER trg_numero_orden BEFORE INSERT ON public.ordenes_produccion FOR EACH ROW EXECUTE FUNCTION public.fn_numero_orden();


--
-- Name: pedidos trg_numero_pedido; Type: TRIGGER; Schema: public; Owner: loga
--

CREATE TRIGGER trg_numero_pedido BEFORE INSERT ON public.pedidos FOR EACH ROW EXECUTE FUNCTION public.fn_numero_pedido();


--
-- Name: ordenes_compra trg_oc_updated_at; Type: TRIGGER; Schema: public; Owner: adrianmartinlopez
--

CREATE TRIGGER trg_oc_updated_at BEFORE UPDATE ON public.ordenes_compra FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: ordenes_produccion trg_ordenes_updated_at; Type: TRIGGER; Schema: public; Owner: loga
--

CREATE TRIGGER trg_ordenes_updated_at BEFORE UPDATE ON public.ordenes_produccion FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: pedidos trg_pedidos_updated_at; Type: TRIGGER; Schema: public; Owner: loga
--

CREATE TRIGGER trg_pedidos_updated_at BEFORE UPDATE ON public.pedidos FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: productos trg_productos_updated_at; Type: TRIGGER; Schema: public; Owner: loga
--

CREATE TRIGGER trg_productos_updated_at BEFORE UPDATE ON public.productos FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: recetas trg_recetas_updated_at; Type: TRIGGER; Schema: public; Owner: loga
--

CREATE TRIGGER trg_recetas_updated_at BEFORE UPDATE ON public.recetas FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: historial_precios historial_precios_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.historial_precios
    ADD CONSTRAINT historial_precios_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id);


--
-- Name: historial_precios historial_precios_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.historial_precios
    ADD CONSTRAINT historial_precios_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- Name: ingredientes_receta ingredientes_receta_materia_prima_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.ingredientes_receta
    ADD CONSTRAINT ingredientes_receta_materia_prima_id_fkey FOREIGN KEY (materia_prima_id) REFERENCES public.productos(id) ON DELETE RESTRICT;


--
-- Name: ingredientes_receta ingredientes_receta_receta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.ingredientes_receta
    ADD CONSTRAINT ingredientes_receta_receta_id_fkey FOREIGN KEY (receta_id) REFERENCES public.recetas(id) ON DELETE CASCADE;


--
-- Name: lineas_pedido lineas_pedido_pedido_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.lineas_pedido
    ADD CONSTRAINT lineas_pedido_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.pedidos(id) ON DELETE CASCADE;


--
-- Name: lineas_pedido lineas_pedido_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.lineas_pedido
    ADD CONSTRAINT lineas_pedido_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id);


--
-- Name: lotes lotes_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.lotes
    ADD CONSTRAINT lotes_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE RESTRICT;


--
-- Name: notificaciones notificaciones_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.notificaciones
    ADD CONSTRAINT notificaciones_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE CASCADE;


--
-- Name: ordenes_compra ordenes_compra_lote_creado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: adrianmartinlopez
--

ALTER TABLE ONLY public.ordenes_compra
    ADD CONSTRAINT ordenes_compra_lote_creado_id_fkey FOREIGN KEY (lote_creado_id) REFERENCES public.lotes(id);


--
-- Name: ordenes_compra ordenes_compra_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: adrianmartinlopez
--

ALTER TABLE ONLY public.ordenes_compra
    ADD CONSTRAINT ordenes_compra_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id);


--
-- Name: ordenes_compra ordenes_compra_proveedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: adrianmartinlopez
--

ALTER TABLE ONLY public.ordenes_compra
    ADD CONSTRAINT ordenes_compra_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id);


--
-- Name: ordenes_produccion ordenes_produccion_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.ordenes_produccion
    ADD CONSTRAINT ordenes_produccion_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id);


--
-- Name: ordenes_produccion ordenes_produccion_lote_producido_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.ordenes_produccion
    ADD CONSTRAINT ordenes_produccion_lote_producido_id_fkey FOREIGN KEY (lote_producido_id) REFERENCES public.lotes(id);


--
-- Name: ordenes_produccion ordenes_produccion_receta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.ordenes_produccion
    ADD CONSTRAINT ordenes_produccion_receta_id_fkey FOREIGN KEY (receta_id) REFERENCES public.recetas(id) ON DELETE RESTRICT;


--
-- Name: pedidos pedidos_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.pedidos
    ADD CONSTRAINT pedidos_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id);


--
-- Name: pedidos pedidos_orden_produccion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.pedidos
    ADD CONSTRAINT pedidos_orden_produccion_id_fkey FOREIGN KEY (orden_produccion_id) REFERENCES public.ordenes_produccion(id);


--
-- Name: pedidos pedidos_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.pedidos
    ADD CONSTRAINT pedidos_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id);


--
-- Name: productos productos_proveedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.productos
    ADD CONSTRAINT productos_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id) ON DELETE SET NULL;


--
-- Name: recetas recetas_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.recetas
    ADD CONSTRAINT recetas_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE RESTRICT;


--
-- Name: stock_moves stock_moves_lote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.stock_moves
    ADD CONSTRAINT stock_moves_lote_id_fkey FOREIGN KEY (lote_id) REFERENCES public.lotes(id) ON DELETE RESTRICT;


--
-- Name: stock_moves stock_moves_orden_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.stock_moves
    ADD CONSTRAINT stock_moves_orden_id_fkey FOREIGN KEY (orden_id) REFERENCES public.ordenes_produccion(id);


--
-- Name: stock_moves stock_moves_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loga
--

ALTER TABLE ONLY public.stock_moves
    ADD CONSTRAINT stock_moves_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--

\unrestrict fF2PMVVhIH3NRhy2BfeNRf9bhg74EJxOB7v8jiEEi9iNJY3k6m93suiO0d5qBsi

