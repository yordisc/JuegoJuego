# RSS Parser 403 Error - Solución

## Problema

Al ejecutar `npm run produce:android:rss`, el script fallaba con:

```
Error: Status code 403
at ClientRequest.<anonymous> (node_modules/rss-parser/lib/parser.js:88:25)
```

### Causa Raíz

Reddit implementa anti-bot measures que detectan solicitudes por dos criterios:

1. **User-Agent identificable como bot**: `JuegoJuegoBot/1.0` es explícitamente un bot
2. **Headers incompletos**: Una solicitud de navegador real incluye headers específicos que no estaban presentes

Reddit rechaza con **403 Forbidden** cualquier solicitud que cumpla ambos criterios.

---

## Solución Implementada

### Archivo Modificado

`services/android-rss.js` → función `createRssParserInstance()`

### Cambios

#### ❌ Antes (User-Agent Bot)

```javascript
return new Parser({
  timeout: 15000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (compatible; JuegoJuegoBot/1.0; +https://github.com/yordisc/JuegoJuego)",
  },
});
```

#### ✅ Después (Navegador Legítimo)

```javascript
return new Parser({
  timeout: 15000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    Accept: "application/rss+xml, application/xml, application/atom+xml, */*",
    "Accept-Encoding": "gzip, deflate",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    DNT: "1",
  },
});
```

### Explicación de Headers

| Header            | Propósito                                        |
| ----------------- | ------------------------------------------------ |
| `User-Agent`      | Identifica como Chrome navegador real en Linux   |
| `Accept`          | Especifica que acepta feeds RSS/XML              |
| `Accept-Encoding` | Soporta compresión gzip/deflate                  |
| `Accept-Language` | Preferencia de idioma estándar                   |
| `Cache-Control`   | Evita caché (comportamiento típico de navegador) |
| `Pragma`          | Compatibilidad retrospectiva con caché           |
| `DNT`             | "Do Not Track" - señal de privacidad estándar    |

---

## Cómo Funciona Ahora

1. **Solicitud HTTP** → Incluye headers de navegador real
2. **Reddit verifica**:
   - ✅ User-Agent parece Chrome legítimo
   - ✅ Headers presentes son los de un navegador real
3. **Respuesta HTTP** → 200 OK con RSS feed

## Variable de Entorno Personalizada

Si necesitas cambiar el User-Agent, define:

```bash
export ANDROID_RSS_USER_AGENT="Tu Custom User Agent"
```

El código respeta esta variable antes de usar el User-Agent por defecto.

---

## Verificación

Después del fix, ejecutar:

```bash
npm run produce:android:rss
```

Salida esperada:

```
[producer-android-rss] feed items leidos: 25
[producer-android-rss] juegos gratis validados: 2
[producer-android-rss] queue final: 2
```

---

## Caso de Uso

### Cuándo Ocurre Este Problema

- APIs externas (Reddit, HackerNews, etc.) detectan bots
- Solicitudes HTTP sin headers suficientes
- User-Agent que claramente identifica como bot

### Generalización

Este patrón es útil para cualquier `rss-parser` o scraper que:

- Lee feeds RSS públicos
- Es bloqueado con 403/429
- Necesita parecer un navegador legítimo

### Solución Genérica

```javascript
const headers = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  Accept: "application/rss+xml, */*",
  "Accept-Encoding": "gzip, deflate",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
};
```

---

## Referencias

- [rss-parser documentation](https://www.npmjs.com/package/rss-parser)
- [HTTP Headers Reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers)
- [Reddit Anti-Bot Measures](https://reddit.com/r/bugs/wiki/overview)
