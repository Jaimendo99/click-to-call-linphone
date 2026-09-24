# Sonda Liblinphone para Windows x64

Aplicación de consola aislada para comprobar que Liblinphone inicia y detiene su `Core` en la sesión interactiva de Windows y enumera todos los dispositivos de audio que expone el SDK. No configura cuentas SIP, credenciales ni llamadas. Tampoco integra el navegador ni AgenDial.

## Decisiones de SDK y API

- Paquete NuGet oficial `LinphoneSDK.Windows`, versión fijada `5.5.2`, desde el registry de Belledonne Communications declarado en `NuGet.Config`. Se usa el paquete Windows x64 de la línea estable 5.5.2, en vez del paquete NuGet antiguo publicado en nuget.org.
- Proyecto dirigido a .NET Framework 4.8 y `PlatformTarget=x64`. La guía de Linphone indica que la variante Win32 x64 es válida para aplicaciones .NET Core/WPF; el paquete ofrece el target `netcore45` para aplicaciones Win32. .NET Framework 4.8 permite consumir ese target y está disponible en Windows 10/11.
- La API sigue la referencia C# oficial 5.5: `Factory.Instance.CreateCore(null, null, IntPtr.Zero)`, `Core.Start()`, `Core.ExtendedAudioDevices`, `Core.Iterate()` y `Core.Stop()`. Se consulta `ExtendedAudioDevices` para incluir todos los dispositivos, no solo uno por tipo. El bucle llama a `Iterate()` cada 20 ms en el hilo principal, como recomienda la documentación.
- El Core se crea sin ruta de configuración explícita; la sonda no añade ni lee parámetros SIP. Liblinphone se distribuye bajo GPLv3 según su documentación; revisar licencia antes de cualquier distribución del SDK o de un producto que lo incluya.

La documentación C# publicada está etiquetada 5.5.0 y el SDK binario Windows x64 estable fijado aquí es 5.5.2. La API usada existe en la referencia 5.5.0. Falta confirmar en una PC Windows que el paquete 5.5.2 del registry resuelve para `net48`, restaura las dependencias nativas x64 y carga correctamente en Windows 10/11; esta máquina de desarrollo es macOS ARM64 y no puede verificarlo. Si la restauración reporta que esa versión no existe en el registry o que no incluye `net48`, guardar el error completo y revisar la versión Win64 estable disponible antes de cambiar el pin.

## Requisitos en Windows 10/11 x64

- .NET SDK 8.x para los comandos `dotnet`.
- .NET Framework 4.8 Developer Pack / targeting pack, si no está instalado.
- Acceso HTTPS a nuget.org y al registry NuGet de Linphone: `https://gitlab.linphone.org/api/v4/projects/411/packages/nuget/index.json`.
- Dispositivos de audio instalados y habilitados en la sesión de usuario para comprobar su enumeración.

## Restaurar, compilar y ejecutar

Abre PowerShell en la raíz del repositorio:

```powershell
dotnet --info
dotnet restore .\windows-agent\src\AgenDial.LinphoneProbe\AgenDial.LinphoneProbe.csproj --configfile .\windows-agent\NuGet.Config
dotnet build .\windows-agent\src\AgenDial.LinphoneProbe\AgenDial.LinphoneProbe.csproj --configuration Release --no-restore
```

Si los comandos terminan correctamente, inicia la sonda:

```powershell
& .\windows-agent\src\AgenDial.LinphoneProbe\bin\Release\net48\AgenDial.LinphoneProbe.exe
```

Debe imprimir `Core iniciado.`, una lista de dispositivos (o indicar que no se detectaron) y mantenerse activa. Presiona Ctrl+C; la salida esperada termina con `Core detenido correctamente.`. El proceso retorna `0` al detenerse normalmente y `1` si falla la inicialización o el cierre del Core.

## Qué adjuntar si falla

Ejecuta estos comandos desde PowerShell y conserva la salida completa, sin añadir contraseñas ni datos de producción:

```powershell
dotnet --info
dotnet restore .\windows-agent\src\AgenDial.LinphoneProbe\AgenDial.LinphoneProbe.csproj --configfile .\windows-agent\NuGet.Config --verbosity diagnostic *> .\windows-agent-restore.log
dotnet build .\windows-agent\src\AgenDial.LinphoneProbe\AgenDial.LinphoneProbe.csproj --configuration Release --no-restore --verbosity diagnostic *> .\windows-agent-build.log
& .\windows-agent\src\AgenDial.LinphoneProbe\bin\Release\net48\AgenDial.LinphoneProbe.exe *> .\windows-agent-run.log
```

Adjunta `windows-agent-restore.log`, `windows-agent-build.log` y `windows-agent-run.log`, además de la edición y versión de Windows (`winver`), arquitectura del sistema y si se detectaron dispositivos. Si falla la carga de DLL, copia también el mensaje completo de `BadImageFormatException`/`DllNotFoundException` o el código de salida. Estos logs no deberían contener secretos porque el proyecto no configura una cuenta; revísalos antes de compartirlos.

## Referencias oficiales consultadas

- [Guía Windows de Liblinphone y registry NuGet](https://wiki.linphone.org/xwiki/wiki/public/view/Lib/Getting%20started/Windows%20UWP/)
- [Referencia C# de Liblinphone 5.5: Core](https://download.linphone.org/releases/docs/liblinphone/5.5/cs/api/Linphone.Core.html)
- [Referencia C# de Liblinphone 5.5: Factory](https://download.linphone.org/releases/docs/liblinphone/5.5/cs/api/Linphone.Factory.html)
- [Referencia C# de Liblinphone 5.5: AudioDevice](https://download.linphone.org/releases/docs/liblinphone/5.5/cs/api/Linphone.AudioDevice.html)
- [Índice oficial de SDK Windows](https://download.linphone.org/releases/windows/sdk/)
