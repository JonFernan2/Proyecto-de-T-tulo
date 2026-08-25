# Documentos de referencia técnica

Todo archivo `.md` o `.txt` que dejes en esta carpeta se incorpora a la revisión.
Los archivos que empiezan con `_` (como este) se ignoran.

## Cómo agregar uno nuevo

1. Deja el archivo aquí, en formato `.md` o `.txt`.
2. Reinicia el servidor (`Ctrl+C` y `npm run dev`).
3. Al arrancar verás en el CMD qué documentos se cargaron y cuánto pesan:

```
[referencias] 1 documento(s) · ~6.800 tokens (cacheados):
  · NCh353-reglas-de-medicion.md (~6.800 tokens)
```

## Qué conviene poner aquí

Reglas y criterios que el corrector deba aplicar de forma constante:
normas de medición, criterios propios de la escuela, listas de errores
recurrentes, tablas de referencia.

El nombre del archivo se usa como título de la referencia, así que conviene
que sea descriptivo: `Manual-MOP-cubicaciones.md` es mejor que `doc2.md`.

## Sobre el tamaño

Estos documentos viajan dentro del prefijo cacheado de cada tanda, así que se
cobran una sola vez por revisión y las tandas siguientes los leen del caché a
una décima parte del costo. Aun así conviene que sean reglas operativas y no
el texto completo de un manual: sobre unos 30.000 tokens el servidor avisa que
el documento conviene resumirlo, porque encarece la escritura de caché y diluye
la atención sobre lo que importa.

Un PDF no sirve directamente — hay que convertirlo a texto antes de dejarlo acá.

## Lo que ya está cargado

- **NCh353-reglas-de-medicion.md** — reglas operativas de la norma chilena de
  cubicación de obras de edificación: descuento de vanos por material,
  esponjamiento y compactación, precedencia en intersecciones, porcentajes de
  enfierradura, y qué se mide por superficie, longitud, volumen o unidad.
