--
-- PostgreSQL database dump
--

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
-- Data for Name: configuracion_global; Type: TABLE DATA; Schema: public; Owner: loga
--

COPY public.configuracion_global (id, porcentaje_alerta, plantilla_email, email_remitente, smtp_host, smtp_port, smtp_user, smtp_pass_enc, empresa_nombre, empresa_cif, empresa_direccion, empresa_telefono, empresa_web) FROM stdin;
1	20.00	Hola,\n\nNecesitamos realizar una reposición de stock para nuestro centro de producción:\n\nReferencia: {{producto}}\nCantidad solicitada: {{cantidad}} {{unidad}}\n\nPor favor, confírmame disponibilidad y envíame la proforma o cotización para autorizar el pedido a la mayor brevedad posible.\n\nGracias de antemano.\n\nColas Loga	flyer.dry@gmail.com	smtp.gmail.com	587			Colas Loga				
\.


--
-- Data for Name: usuarios; Type: TABLE DATA; Schema: public; Owner: loga
--

-- Passwords (bcryptjs $2b$10):
--   admin@loga.es     -> Loga#Admin2026!
--   operario@loga.es  -> Loga#Admin2026!  (mismo, cambiar tras primer login)
COPY public.usuarios (id, nombre, email, password_hash, rol, activo, created_at) FROM stdin;
459ccd75-dfb4-4a9d-9bfd-39f0c5e20a0f	Administrador	admin@loga.es	$2b$10$YzYh9yKOZwMKLj8Ba7RI7OQjM9JuRd3LV1Mfc0kiK5QvmTFffVvyS	admin	t	2026-04-20 09:19:26.928596+02
e5f9286a-5367-468a-9c4d-8321a02b90c7	Operario	operario@loga.es	$2b$10$YzYh9yKOZwMKLj8Ba7RI7OQjM9JuRd3LV1Mfc0kiK5QvmTFffVvyS	trabajador	t	2026-04-20 09:26:52.158412+02
\.


--
-- PostgreSQL database dump complete
--

