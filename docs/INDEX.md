# 📚 Documentación - Índice Central

Bienvenido. Esta carpeta contiene toda la documentación del proyecto. Usa este índice para encontrar lo que buscas rápidamente.

---

## 🎯 ¿Qué Necesitas?

### 👤 Para Portafolio / Visión General
→ Lee el [README.md](../README.md) principal (5 min)

### 👨‍💻 Para Entender la Arquitectura
→ Lee [ARCHITECTURE.md](ARCHITECTURE.md) (15 min)

### ⚙️ Para Operar el Sistema
→ Lee [QUICK_START.md](QUICK_START.md) (10 min)

### 🤖 Para trabajar con una IA en el código
→ Lee [ai-context/COMPLETE_GUIDE.md](ai-context/COMPLETE_GUIDE.md) (30 min)
→ Lee [ai-context/API_REFERENCE.md](ai-context/API_REFERENCE.md) (referencia)

### 🐛 Para Solucionar Problemas
→ Lee [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

### 📋 Para Mantenimiento / Cambios Recientes
→ Lee [MAINTENANCE.md](operations/MAINTENANCE.md)

---

## 📖 Documentación Disponible

### 📌 Core (Empezar aquí)

| Archivo | Descripción | Audiencia | Duración |
|---------|-------------|-----------|----------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Explicación de diseño y decisiones técnicas | Devs, Leads | 15 min |
| [QUICK_START.md](QUICK_START.md) | Setup local, operación diaria, troubleshooting rápido | Devs, Ops | 10 min |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Solución de problemas comunes | Ops, Devs | variable |

### 🤖 Contexto para IA (Leer si usas Claude/GPT/etc)

| Archivo | Descripción | Casos de Uso |
|---------|-------------|------------|
| [ai-context/COMPLETE_GUIDE.md](ai-context/COMPLETE_GUIDE.md) | **TODO** sobre flujos, servicios, funciones | Implementar features, debuggear |
| [ai-context/API_REFERENCE.md](ai-context/API_REFERENCE.md) | Referencia de funciones y módulos expuestos | Codegen, buscar funcionalidad |

### 🔧 Operación

| Archivo | Descripción |
|---------|-------------|
| [operations/MAINTENANCE.md](operations/MAINTENANCE.md) | Cambios recientes, tareas de mantenimiento |

---

## 🗂️ Estructura de la Carpeta

```
docs/
├─ INDEX.md (este archivo)
├─ ARCHITECTURE.md           → Explicación técnica
├─ QUICK_START.md            → Guía práctica
├─ TROUBLESHOOTING.md        → Solución de problemas
├─ ai-context/
│  ├─ COMPLETE_GUIDE.md      → TODO para una IA
│  └─ API_REFERENCE.md       → Referencia de funciones
└─ operations/
   └─ MAINTENANCE.md         → Cambios y tareas
```

---

## 🚀 Flujos Típicos

### "Quiero entender cómo funciona"
1. Lee [ARCHITECTURE.md](ARCHITECTURE.md) - Visión general
2. Lee [QUICK_START.md](QUICK_START.md#-flujo-de-ejecución) - Flujo de ejecución
3. Ejecuta: `npm run smoke:producer` - Ver en acción

### "Quiero agregar una feature"
1. Lee [ai-context/COMPLETE_GUIDE.md](ai-context/COMPLETE_GUIDE.md)
2. Abre ejemplo similar en `services/` o `netlify/functions/`
3. Sigue patrón: inputs → validación → logic → output
4. Agrega tests en `test/`

### "Algo está roto"
1. Revisa [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
2. Ejecuta: `npm run blobs:show` - Ver estado
3. Revisa logs en Netlify Dashboard
4. Si necesitas debuggear: `npm test -- --testNamePattern="..."`

### "Necesito un prompt para IA"
1. Copia contenido de [ai-context/COMPLETE_GUIDE.md](ai-context/COMPLETE_GUIDE.md)
2. Agrega el contexto específico de tu tarea
3. Pasa la IA con `@workspace` en VS Code

---

## 💡 Consejos de Lectura

- **Comienza simple**: README → ARCHITECTURE → QUICK_START
- **Sé específico**: Si tienes pregunta, busca en el índice de arriba
- **Prueba mientras lees**: Cada sección de QUICK_START tiene comandos
- **Para IA**: Proporciona el COMPLETE_GUIDE.md + contexto específico

---

## 📞 ¿No encuentras algo?

Archivos eliminados o consolidados en esta reorganización:
- `ANALISIS_FLUJO_ANDROID.md` → [ai-context/COMPLETE_GUIDE.md](ai-context/COMPLETE_GUIDE.md)
- `DIAGRAMA_FLUJO_Y_RECOMENDACIONES.md` → [ARCHITECTURE.md](ARCHITECTURE.md)
- `CAMBIOS_REALIZADOS.md` → [operations/MAINTENANCE.md](operations/MAINTENANCE.md)
- `REPORTE_EJECUTIVO.md` → [ARCHITECTURE.md](ARCHITECTURE.md)
- Otros archivos de análisis → consolidados en docs oficiales

---

**Última actualización**: Apr 6, 2026
