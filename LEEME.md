# UVM Grader — Formulación de Proyecto de Título

Corrector IA para entregas de Ingeniería en Construcción, UVM.

## Configuración inicial (solo la primera vez)

1. **Copia el archivo de entorno:**
   ```
   cp .env.example .env
   ```

2. **Edita `.env` y pega tu clave de Anthropic:**
   ```
   ANTHROPIC_API_KEY=sk-ant-...tu_clave...
   ```

3. **Instala las dependencias:**
   ```
   npm install
   ```

## Uso diario

```
npm run dev
```

Abre el navegador en: **http://localhost:5173**

## Flujo de corrección

1. **Configuración** — Selecciona E1 o E2, escribe el nombre del estudiante
2. **Archivos** — Arrastra los archivos del estudiante (Word, Excel, PDFs, imágenes)
   - Asigna el rol correcto a cada Excel si la detección automática falla
3. **Admisibilidad** — La app verifica automáticamente los umbrales
4. **Evaluación** — Claude analiza los archivos con la rúbrica (20–60 segundos)
5. **Resultados** — Revisa la nota propuesta, ajusta con el slider y agrega observaciones
6. **PDF** — Exporta el informe de retroalimentación

## Rúbrica

| Entrega 1 | Peso | Entrega 2 | Peso |
|---|---|---|---|
| EETT | 25% | Métodos Constructivos | 30% |
| Listado de Actividades | 15% | APU — Mano de Obra | 25% |
| Cubicaciones | 35% | APU — Materiales + Fletes | 30% |
| Cotizaciones | 25% | APU — Equipos/Maquinarias | 15% |

## Admisibilidad

- **E1**: EETT presente (100%) + Cubicaciones ≥50% + Cotizaciones ≥80%
- **E2**: Todo lo de E1 + APU 100% completo
