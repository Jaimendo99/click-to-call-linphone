# Plan de exploración: telefonía SIP en Windows conectada a AgenDial

## Propósito

Explorar y comparar las rutas que permitan iniciar y controlar llamadas desde AgenDial en Windows usando la cuenta de telefonía SIP de terceros que hoy está configurada en Linphone (servidor, usuario y contraseña). La interfaz de llamada debe estar en AgenDial o en una ventana propia de AgenDial; el flujo actual no debe cambiar hasta que una alternativa pase las pruebas y se elija explícitamente.

Este documento es un plan de investigación y prueba. No implica una decisión definitiva por Liblinphone ni propone implementar todas las opciones en producción. Cada ruta debe producir una prueba pequeña, resultados medibles y una decisión de continuar o descartarla.

## Resultado funcional buscado

- El asesor inicia y termina la llamada desde la UI de AgenDial.
- Se usa la cuenta SIP de terceros ya utilizada por el asesor: identidad/usuario, autenticación, contraseña, dominio/registrar, proxy y reglas de marcación.
- Se conserva la ruta de llamada a la PBX y a la red telefónica existente.
- El asesor habla con su micrófono y auriculares del PC Windows.
- AgenDial muestra el estado de llamada que necesita el flujo de trabajo.
- No se abre la ventana principal de Linphone al marcar.
- Las credenciales SIP no se envían al servidor web ni quedan expuestas en JavaScript, URLs, consola o logs.

## Incógnitas que bloquean una decisión de arquitectura

Antes de escoger una ruta hay que inventariar la cuenta SIP y las reglas del proveedor. En Linphone, recopilar, sin compartir contraseñas:

- dirección SIP y nombre de autenticación (pueden ser distintos);
- dominio, servidor/registrar y proxy saliente;
- transporte actual (UDP, TCP o TLS), puerto y cifrado requerido;
- codecs permitidos, DTMF, NAT/STUN/TURN/ICE si están configurados;
- regla para llamar a extensiones y números externos, prefijos y caller ID;
- si una cuenta puede registrar varios dispositivos a la vez y cómo se comporta la PBX cuando dos clientes usan la misma cuenta;
- soporte disponible en la PBX/proveedor: SIP sobre WebSocket seguro (WSS), WebRTC (ICE y DTLS-SRTP), API de click-to-call y gateway/SBC.

Un transporte TLS de Linphone no demuestra que el servidor tenga WSS/WebRTC. La viabilidad del navegador depende del servidor, y una prueba con cuenta de laboratorio debe preceder a cualquier uso de credenciales o números de producción.

## Rutas que se deben evaluar

| Ruta | Dónde corre el cliente SIP/audio | Qué instala el PC | Requisito principal | Qué demuestra |
|---|---|---|---|---|
| A. Mantener Linphone Desktop y mejorar el lanzamiento | Linphone Desktop | Linphone actual | Que la ventana pueda permanecer minimizada/oculta con configuración o comportamiento del SO | Si se puede resolver el problema con el menor cambio |
| B. Agente local sin ventana con Liblinphone | Proceso nativo .NET/C++ en la sesión del asesor | Agente + Liblinphone | SDK, acceso estable a audio e IPC local desde el navegador | Motor Linphone en segundo plano, sin abrir su UI |
| C. Servicio Windows real + agente de audio por sesión | Servicio en sesión 0; agente por usuario para audio | Servicio, agente y posiblemente instalador firmado | Diseño de IPC, ciclo de vida y prueba de audio entre sesiones | Si hay un requisito real de operar antes del login o sin sesión de usuario |
| D. Aplicación Windows propia con UI web | WPF/.NET + WebView2 (u otro contenedor) y Liblinphone | Aplicación AgenDial Windows | Empaquetar UI web y SDK; iniciar sesión en la app | Integra UI y telefonía en un producto, sin navegador externo ni puente localhost |
| E. SIP/WebRTC directamente desde el navegador | Biblioteca JavaScript SIP + WebRTC del navegador | Ninguno o una extensión opcional | PBX compatible con WSS/WebRTC y medios WebRTC | Si la central acepta un softphone web directo con la cuenta de terceros |
| F. Navegador WebRTC con gateway/SBC SIP | WebRTC en navegador; gateway traduce a la PBX SIP | Normalmente ninguno | Desplegar/configurar gateway y certificar audio, red y seguridad | Si la PBX no ofrece WSS/WebRTC pero se puede intermediar la señalización/medios |
| G. Click-to-call iniciado por el servidor/PBX | PBX origina la llamada hacia el asesor y el destino | Depende del endpoint de audio del asesor | API/servicio de originate de la PBX; endpoints alcanzables | Si basta iniciar la llamada desde la web aunque el audio no viaje por el navegador |
| H. Agente local con otro motor SIP | Proceso nativo por usuario con PJSIP u otro SDK | Agente + runtime/SDK | Compatibilidad SIP, audio y licencia | Si se necesita cliente nativo pero Liblinphone no encaja técnica o comercialmente |
| I. Versión web oficial de Linphone | Producto web de Linphone cuando esté disponible | Por confirmar | Que Linphone publique versión, capacidades e integración para cuentas de terceros | Si se puede consumir un producto oficial en vez de mantener uno propio |

### A. Linphone Desktop como referencia de bajo costo

Mantener la implementación existente `sip-linphone:` y probar ajustes de configuración, inicio minimizado, minimización posterior al inicio de llamada y comportamiento en cada versión de Windows/Linphone usada. El URI handler está documentado para Desktop y actualmente abre Linphone; cualquier modo oculto debe verificarse en la versión instalada, no suponerse por el nombre de un ajuste de ventana.

Esta opción sirve como línea base. Si el SO o Linphone siempre trae la app al frente y no hay una opción mantenida, se descarta como solución completa.

### B. Agente local con Liblinphone

Un ejecutable sin ventana, iniciado al iniciar sesión de Windows, usa Liblinphone para registrar la cuenta SIP, originar/terminar llamadas, gestionar estados y capturar/reproducir audio. El navegador intercambia órdenes y eventos con ese agente mediante IPC local.

Linphone publica paquete NuGet para aplicaciones Windows WPF/.NET y APIs de llamadas en C#/C++. El SDK no convierte por sí solo el navegador en cliente SIP: hace falta implementar el agente, su configuración, IPC, ciclo de vida e instalador.

Variantes de comunicación web-agente a comparar:

- WebSocket local sobre loopback con canal autenticado, validación de origen y política de red del navegador;
- extensión de Chrome/Edge más Native Messaging Host (instalación y políticas de extensión);
- WebView2 dentro de una app nativa con mensajería entre host y página;
- named pipes locales más extensión/host nativo, si se necesita evitar un puerto HTTP/WebSocket local.

No habilitar un endpoint genérico de llamadas accesible desde cualquier sitio. Verificar HTTPS/WSS, certificados, CORS, Private/Local Network Access de navegadores y despliegue corporativo en una prueba separada.

### C. Servicio Windows real y audio

Windows aísla los servicios de la sesión interactiva del asesor. Un servicio puede alojar tareas de red/gestión si son necesarias, pero no se debe presumir que puede usar de forma idéntica el micrófono, el auricular Bluetooth/USB ni el dispositivo de salida del usuario. Probar inicio antes del login, lock/unlock, cambio de usuario, fast-user switching y RDP.

Si el audio no está disponible o se dirige al dispositivo incorrecto, dividir responsabilidades: servicio para tareas que deban sobrevivir al cierre del agente y proceso por sesión para Liblinphone/media/estado de usuario. Comparar esta variante con B; no construirla primero sin evidencia de que B incumple un requisito.

### D. App Windows propia con UI web

Empaquetar una app para Windows cuya UI reuse HTML/CSS/JS de AgenDial (por ejemplo, WPF con WebView2) y que aloje Liblinphone en el mismo proceso o en un proceso local asociado. La llamada se solicita por una API interna del host, no por un enlace `sip-linphone:`. Esta vía evita la conexión desde una página remota a localhost, pero requiere distribuir una app Windows y resolver autenticación/sincronización con AgenDial.

Comparar inicio de sesión, actualizaciones, accesibilidad y soporte operativo frente a B. También decidir qué ocurre si el usuario abre AgenDial en un navegador que no sea la app instalada.

### E. Cliente SIP/WebRTC dentro del navegador

Probar JsSIP o SIP.js con una cuenta de terceros. El navegador pide permiso de micrófono y maneja el audio mediante WebRTC; la biblioteca maneja señalización SIP sobre WebSocket. Para usarlo directamente, la PBX debe proporcionar endpoint WSS y soportar la negociación de medios WebRTC, incluida ICE y DTLS-SRTP (más codecs compatibles). Si no tiene estas capacidades, E se descarta o se combina con F.

Investigar cómo proteger las credenciales si el navegador debe autenticarse. Una contraseña SIP permanente disponible en JavaScript puede extraerse del equipo del usuario; preferir credenciales separadas por agente, provisión temporal/revocación o un diseño mediado por servidor aprobado por el administrador.

### F. Gateway/SBC entre WebRTC y SIP

El navegador usa un endpoint WebRTC con WSS; un SBC/gateway convierte o relaya hacia la PBX existente. Esta ruta puede evitar modificar la PBX actual, pero añade infraestructura de señalización/media, certificados, NAT, ancho de banda, monitorización y operación. Validar codecs, DTMF, caller ID, transferencia, grabación, cifrado y si la PBX acepta la identidad de salida. No debe asumir que “SIP normal” se transforma en WebRTC solo cambiando la URL.

### G. Click-to-call originado en PBX

AgenDial envía una orden autenticada a un backend; el backend pide a la PBX llamar primero al endpoint del asesor y luego al cliente, o crear un puente entre ambos. El asesor puede hablar por un teléfono/extensión SIP existente. Esto evita que el softphone se abra por un clic en un URI, pero por sí solo no ofrece audio en el navegador. Si la PBX ofrece una API como ARI/AMI u otra API propietaria, evaluar autenticación, permisos, caller ID, auditoría y estados de llamada.

Separar este caso de uso: puede resolver “iniciar llamada desde la web” aunque no resuelva “usar headset y audio del navegador”.

### H. Otro motor SIP nativo

Comparar Liblinphone con PJSIP/PJSUA2 u otro SDK de softphone para Windows si Liblinphone presenta limitaciones de integración, licencia, tamaño de distribución o mantenimiento. Mantener la misma cuenta SIP de terceros solo si el proveedor permite el nuevo User-Agent, registro, codecs, transporte y reglas. Medir el esfuerzo de empaquetado, audio, API, soporte y licencia; no elegir solo por tener ejemplos de C#.

### I. Esperar la versión web oficial de Linphone

Linphone mantiene referencias a una versión web en desarrollo, pero al momento de redactar este plan no se encuentra una API/paquete oficial público para integrarla en AgenDial. Volver a revisar su estado, soporte para cuentas SIP de terceros, personalización, UI embebible, licencia y método de provisión antes de invertir en esta ruta.

## Plan por fases y experimentos

### Organización del repositorio y trabajo seguro

Mantener por ahora un monorepo sencillo: AgenDial seguirá en la raíz con su estructura actual; cada prototipo Windows vivirá bajo `windows-agent/` y tendrá su propio proyecto, dependencias, instrucciones y artefactos de compilación. No añadir npm workspaces ni una herramienta de monorepo: la app web y el agente usan toolchains y ciclos de entrega distintos, y no necesitan compilarse juntos en esta etapa.

Estructura propuesta cuando empiece la implementación:

```text
/
├── src/                    # AgenDial actual (Express/SQLite)
├── public/                 # UI web actual
├── views/
├── tests/
├── docs/
│   └── plan-liblinphone-windows.md
└── windows-agent/
    ├── README.md           # requisitos y pasos de compilación/ejecución en Windows
    ├── src/
    │   └── AgenDial.LinphoneProbe/
    └── experiments/        # solo si aparecen prototipos independientes
```

El prototipo inicial no debe modificar el flujo `sip-linphone:` ni las rutas, base de datos o configuración de producción de AgenDial. Los resultados y configuración de laboratorio se documentarán sin contraseñas, tokens ni datos personales. La separación de carpetas reduce el acoplamiento, pero sigue siendo un solo repositorio y una sola historia de cambios.

Usar una rama por unidad de trabajo revisable (prototipo, integración o corrección), no una rama permanente por cada ruta de investigación. La rama actual `feat/linphone-background` sirve para concretar la propuesta y el primer experimento; si una alternativa requiere cambios incompatibles o un spike desechable, abrir una rama desde el punto apropiado y conservar evidencia/documentación útil al cerrarla. No mezclar un experimento fallido con el flujo de llamadas existente.

### Primera prueba ejecutable propuesta (pendiente de aprobación del plan)

La primera entrega de código sería una sonda de Liblinphone para Windows x64, como aplicación de consola ejecutada en la sesión del usuario. Su alcance se limita a comprobar que el paquete restaura y carga en la PC objetivo, que el Core inicia y se detiene ordenadamente, y que se enumeran los dispositivos de audio disponibles. No registra una cuenta SIP, no origina llamadas, no expone IPC al navegador y no es todavía un servicio de Windows.

La secuencia propuesta es:

1. En la PC Windows 10/11 de pruebas, instalar el SDK de .NET y restaurar/compilar el proyecto aislado.
2. Ejecutar la sonda localmente, confirmar inicio/parada del Core y guardar el resultado técnico sin información sensible.
3. Resolver cualquier incompatibilidad de versión, arquitectura o runtime y fijar las versiones verificadas en el proyecto.
4. Solicitar al administrador/proveedor una cuenta SIP de laboratorio independiente de producción, junto con servidor/registrar, proxy, transporte, usuario de autenticación, extensiones permitidas, reglas de marcación y codecs requeridos. Entregar secretos solo por el canal seguro que indique el administrador; no pegarlos en el repositorio, navegador, tickets ni logs.
5. Solo tras validar la sonda y tener esos datos, proponer el siguiente spike: registro SIP de laboratorio y llamada entre extensiones de prueba. Ese spike debe documentar cómo se proveen y eliminan las credenciales y qué resultados se guardan.
6. Después de validar señalización y audio en proceso interactivo, decidir si merece la pena evaluar IPC web-agente y, con evidencia de un requisito que lo necesite, el servicio Windows o la app WebView2.

La disponibilidad de una PC Windows 10/11 y la posibilidad de solicitar una cuenta SIP de laboratorio están confirmadas por el usuario. Aún faltan el resultado de la solicitud, parámetros SIP, restricciones del administrador y aprobación para comenzar la implementación. La compilación real solo puede validarse en Windows; el entorno de trabajo actual no sustituye esa prueba.

### Fase 0: descubrimiento del entorno

1. Obtener configuración no secreta de la cuenta Linphone y documentar los campos listados arriba.
2. Identificar proveedor/PBX, versión, administrador responsable y rutas actuales de llamadas.
3. Confirmar si la cuenta permite registros simultáneos y solicitar credencial/cuenta de laboratorio independiente de producción. El usuario confirmó que puede pedirla; registrar los datos únicamente en el almacén seguro acordado y los parámetros no secretos en la documentación.
4. Confirmar políticas corporativas: permisos para instalar agente/extensión, firma, antivirus, proxy, RDP, múltiples asesores y actualizaciones.
5. Revisar licencia del SDK o bibliotecas candidatas antes de construir un prototipo distribuible.

### Fase 1: línea base con Linphone Desktop

- Registrar el comportamiento actual al marcar desde AgenDial en cada versión de Windows/browser objetivo.
- Probar opciones soportadas de minimización/ventana en Linphone y Windows.
- Registrar si la llamada, controles y audio funcionan al minimizar o cubrir la ventana.
- Decidir si esta ruta cumple el requisito o solo sirve de contingencia.

### Fase 2: pruebas técnicas de motores nativos

- Empezar por la sonda de Liblinphone en `windows-agent/`, en una rama de trabajo revisable. Mantener el código y dependencias fuera del ciclo de build de AgenDial.
- Crear ramas/experimentos desechables independientes para Liblinphone y, si hace falta, otro motor nativo.
- Registrar una cuenta SIP de laboratorio desde una app de consola/agente y completar llamada entre extensiones.
- Probar luego un destino externo autorizado y el formato local de número que requiere la PBX.
- Medir audio bidireccional, codecs, DTMF, estado de llamada, hangup local/remoto, recuperación de red y selección de dispositivos.
- Probar primero en proceso interactivo oculto y después como servicio Windows aislado; comparar resultados.

### Fase 3: pruebas del cliente web

- Consultar al proveedor si ofrece SIP WSS/WebRTC para cuentas de terceros.
- Si sí, construir una página de laboratorio mínima con JsSIP/SIP.js, micrófono, marcar/colgar, estados y logs saneados.
- Si no, revisar F (gateway) y G (click-to-call PBX) con el administrador y un estimado de operación.
- Comparar WebSocket loopback, Native Messaging y WebView2 para las rutas B/D.

### Fase 4: integración AgenDial en una prueba acotada

- Elegir la ruta que haya pasado las fases anteriores; dejar el click actual disponible como fallback durante la prueba.
- Implementar solo el contrato mínimo: salud/conexión, marcar, colgar, estado, errores y dispositivo de audio activo.
- Usar cuentas de prueba y un grupo pequeño de equipos Windows.
- Verificar permisos, logs sin secretos, actualización y desinstalación.

### Fase 5: decisión y preparación de producción

- Comparar evidencia, riesgos, coste de soporte, licencias, instalaciones y cambios de PBX.
- Seleccionar una arquitectura y registrar la decisión en un ADR separado.
- Definir migración de cuentas, estrategia de fallback, monitorización, distribución firmada y despliegue gradual.
- Solo después planificar el reemplazo del URI handler actual.

## Matriz común de pruebas

Cada prototipo debe registrar la misma información para comparar de manera justa:

| Área | Casos mínimos |
|---|---|
| SIP | REGISTER, autenticación, cuenta expirada, credenciales incorrectas, INVITE, CANCEL/BYE y respuesta de ocupado/sin respuesta |
| Marcación | Extensión interna, número local nacional, formato internacional, prefijo de salida, caller ID y destino inválido |
| Audio | Entrada/salida, mute, DTMF, USB, Bluetooth, cambio de dispositivo, llamadas largas y reconexión de red |
| UI | Inicio desde clic del asesor, feedback de estados, colgar desde UI y fin remoto |
| Sesión Windows | Inicio de sesión, bloqueo/desbloqueo, sleep/resume, cambio de usuario, cierre de sesión y RDP si se usa |
| Navegador/IPC | HTTPS, permisos, refresh, navegador cerrado, agente ausente, origen no autorizado, CORS/loopback y extensión administrada si aplica |
| PBX | Registro concurrente, NAT, codecs, TLS/WSS/WebRTC, DTMF, ruteo PSTN y reglas de seguridad |
| Operación | Instalación sin privilegios si procede, firma, actualización, logs, diagnóstico y desinstalación |
| Seguridad | Secretos en disco/memoria/logs, exposición del canal local, abuso desde otra pestaña y autorización de cada acción |

No usar credenciales personales o de producción en trazas, capturas, repositorio ni resultados compartidos.

## Criterios para comparar y descartar

Una opción debe probar una llamada completa por la PBX real de laboratorio. Debe puntuar al menos:

- compatibilidad de autenticación y señalización de la cuenta actual;
- audio bidireccional estable y selección de auriculares/micrófono;
- cumplimiento del requisito de no abrir Linphone Desktop;
- controles/estados disponibles para la UI web;
- seguridad de credenciales y de IPC;
- instalación y mantenimiento en todas las PCs;
- dependencias de cambios en PBX/proveedor;
- licencia, coste y capacidad de soporte.

Descartar una ruta con evidencia registrada cuando falle un requisito esencial o exija un cambio de PBX no disponible. Una prueba fallida de WSS, por ejemplo, descarta E directo pero no necesariamente F o un agente SIP nativo.

## Restricciones de seguridad y despliegue

- No almacenar credenciales SIP en el servidor AgenDial ni en el frontend web.
- Diseñar provisión y rotación por asesor; usar almacenamiento cifrado de Windows cuando el proceso local tenga que conservar secretos.
- Mantener cualquier IPC local ligado a loopback o con ACL y autenticación; validar origen, sesión, número y permiso del asesor.
- No abrir puertos en la red local ni en el servidor de producción para facilitar el prototipo.
- Firmar ejecutables/instalador y validar compatibilidad con antivirus y políticas de Windows corporativo.
- Mantener logs operativos con redacción de contraseñas, tokens, números completos si no son necesarios y datos personales.
- Revisar obligaciones de licencia de Liblinphone y de toda biblioteca o gateway antes de distribuir.

## Estado actual del proyecto

- La aplicación web usa el URI `sip-linphone:` para solicitar que Linphone Desktop marque.
- El backend no gestiona cuentas SIP ni guarda sus credenciales.
- La lógica de numeración adapta los móviles ecuatorianos a la forma nacional que espera la PBX.
- El README indica que la PBX local rechaza el formato `+593`, pero no identifica el proveedor ni sus capacidades WSS/WebRTC/API.
- No se ha elegido una ruta de reemplazo; todas las alternativas de arriba son candidatas de investigación.

## Fuera de alcance hasta decidir una ruta

- Cambiar el flujo actual de llamadas o el esquema de base de datos.
- Conectar prototipos a credenciales/personas/números de producción.
- Publicar, firmar o distribuir un instalador.
- Cambiar la PBX, abrir WSS o desplegar gateways sin revisión del administrador.

## Fuentes iniciales

- [Guía de Liblinphone para Windows y paquete NuGet](https://wiki.linphone.org/xwiki/wiki/public/view/Lib/Getting%20started/Windows%20UWP/)
- [API C# de Liblinphone](https://download.linphone.org/releases/docs/liblinphone/latest/cs/)
- [Guía del SDK: plataformas, lenguajes y licencia](https://wiki.linphone.org/xwiki/wiki/public/view/Lib/)
- [Estado de la versión web de Linphone](https://www.linphone.org/en/download/)
- [Microsoft: aislamiento e interacción de servicios Windows](https://learn.microsoft.com/en-us/windows/win32/services/interactive-services)
- [Microsoft: WASAPI](https://learn.microsoft.com/en-us/windows/win32/coreaudio/wasapi)
- [JsSIP: interoperabilidad, SIP WebSocket y WebRTC](https://jssip.net/documentation/misc/interoperability/)
- [SIP.js: configuración WebRTC para Asterisk](https://sipjs.com/guides/server-configuration/asterisk/)
- [Chrome: Native Messaging entre extensión y proceso nativo](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [PJSIP: uso en aplicaciones Windows](https://docs.pjsip.org/en/latest/get-started/windows/using.html)
- [PJSUA2: API SIP nativa para softphones](https://docs.pjsip.org/en/2.13/pjsua2/intro.html)
