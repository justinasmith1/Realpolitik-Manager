# Contexto de negocio

Este documento resume, de forma pública y general, el problema que busca resolver Realpolitik Manager. No contiene datos de clientes ni de personas, y no reemplaza al backlog (que vive en Trello).

## El problema

Realpolitik gestiona rendiciones de pauta publicitaria para sus clientes. Hoy una parte importante de ese proceso es manual: se apoya en planillas y en documentación dispersa en distintos lugares.

Esto genera:

- riesgo de errores humanos al preparar y enviar cada rendición;
- poca trazabilidad sobre qué se envió, a quién y cuándo;
- dependencia de personas concretas para conocer el estado de cada cuenta;
- demoras en el cierre del ciclo de rendición y cobro.

Además, cada cliente puede requerir documentación distinta y canales de entrega diferentes (por ejemplo, correo u otros medios), lo que aumenta la complejidad operativa.

## Objetivo del producto

Centralizar la gestión del ciclo de rendición en una plataforma web para:

- mejorar la trazabilidad y conservar un historial auditable;
- reducir errores y retrabajo;
- disminuir la dependencia de procesos manuales;
- controlar la documentación requerida y sus vencimientos;
- ordenar el despacho de la información a cada cliente según sus requisitos.

## Módulos conceptuales

Áreas que el sistema podría abarcar a medida que avance el desarrollo. No constituyen un compromiso de alcance ni un orden de entrega:

- clientes;
- requisitos por cliente;
- documentación;
- rendiciones;
- vencimientos;
- despacho.

El alcance concreto y su priorización se gestionan en Trello.

## Decisiones de negocio pendientes

- **Retención documental:** el período y la política de conservación del historial **no están definidos** y deben validarse con el cliente antes de implementarse. No debe asumirse un valor en el código ni en otros documentos hasta que se confirme.
