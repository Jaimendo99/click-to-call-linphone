# Sonda Liblinphone para Windows x64

Aplicación de consola aislada para comprobar que Liblinphone crea, inicia y detiene su `Core`, y enumera los dispositivos de audio disponibles en una sesión interactiva de Windows. No configura cuentas SIP, credenciales ni llamadas. Tampoco integra el navegador ni AgenDial.

## SDK y API

- Paquete NuGet oficial `LinphoneSDK.Windows` versión fijada `5.5.2`, desde el registry de Belledonne Communications de `NuGet.Config`.
- La carpeta NuGet observada al restaurar 5.5.2 contiene DLL nativas x64 en `lib/netcore/x64`, pero no contiene `CsWrapper.dll` ni el grupo `lib/win/x64`. Por eso la sonda no usa el wrapper C# que los targets del paquete intentan referenciar: llama a la API C exportada por `liblinphone.dll` mediante P/Invoke. MSBuild quita únicamente esa referencia C# ausente y conserva la copia de las DLL nativas.
- Se usa la variante `netcore` x64 del paquete, descrita por Linphone para aplicaciones .NET Core. El proyecto apunta a .NET 9 x64 para que pueda compilarse con el SDK 9. La compatibilidad exacta del binario `netcore` con esta consola en Windows 10/11 debe comprobarse ejecutándola allí; la compilación no valida la carga nativa.
- Las llamadas P/Invoke corresponden a la API C Liblinphone 5.5: `linphone_factory_get`, `linphone_factory_set_top_resources_dir`, `linphone_factory_create_core_3`, `linphone_core_start`, `linphone_core_get_extended_audio_devices`, `linphone_core_iterate`, `linphone_core_stop` y `linphone_core_unref`. Para enumerar la lista y liberar sus objetos se usan las funciones públicas de lista de Bctoolbox.
- Antes de crear el Core, la sonda valida `share/belr/grammars/vcard_grammar.belr` y establece `share` junto al ensamblado como directorio raíz de recursos. Así no depende del directorio actual desde el que se inicia PowerShell.
- El Core se crea con rutas de configuración nulas, por lo que la sonda no crea ni carga un archivo de cuentas. `linphone_core_iterate()` se ejecuta cada 20 ms en el hilo principal, según la documentación.
- El SDK está publicado bajo GPL-3.0-or-later; revisar la licencia antes de distribuir el SDK o un producto que lo incluya.

## Requisitos en Windows 10/11 x64

- .NET 9 SDK x64, que incluye el runtime de .NET 9.
- Acceso HTTPS a nuget.org y al registry NuGet oficial: `https://gitlab.linphone.org/api/v4/projects/411/packages/nuget/index.json`.
- Dispositivos de audio instalados y habilitados en la sesión del usuario para comprobar la enumeración.

## Restaurar, compilar y ejecutar

Abre PowerShell en la raíz del repositorio:

```powershell
dotnet --info
dotnet restore .\windows-agent\src\AgenDial.LinphoneProbe\AgenDial.LinphoneProbe.csproj --configfile .\windows-agent\NuGet.Config
dotnet build .\windows-agent\src\AgenDial.LinphoneProbe\AgenDial.LinphoneProbe.csproj --configuration Release --no-restore -p:Platform=x64
dotnet .\windows-agent\src\AgenDial.LinphoneProbe\bin\x64\Release\net9.0\AgenDial.LinphoneProbe.dll
```

Debe imprimir `Core iniciado.`, una lista de dispositivos (o indicar que no se detectaron) y mantenerse activa. Presiona Ctrl+C; la salida esperada termina con `Core detenido correctamente.`. El proceso retorna `0` al detenerse normalmente y `1` si falla la inicialización o el cierre del Core.

## Si falla

Conserva la salida completa de estos comandos, sin añadir contraseñas ni datos de producción:

```powershell
dotnet --info
dotnet --list-runtimes
dotnet restore .\windows-agent\src\AgenDial.LinphoneProbe\AgenDial.LinphoneProbe.csproj --configfile .\windows-agent\NuGet.Config --verbosity diagnostic *> .\windows-agent-restore.log
dotnet build .\windows-agent\src\AgenDial.LinphoneProbe\AgenDial.LinphoneProbe.csproj --configuration Release --no-restore --verbosity diagnostic -p:Platform=x64 *> .\windows-agent-build.log
Get-ChildItem .\windows-agent\src\AgenDial.LinphoneProbe\bin\x64\Release\net9.0 -Recurse -File | Where-Object { $_.Name -eq 'vcard_grammar.belr' -or $_.Name -eq 'liblinphone.dll' -or $_.Name -eq 'bctoolbox.dll' } | Select-Object -ExpandProperty FullName
```

Si el build tiene éxito pero la ejecución muestra `DllNotFoundException` o `EntryPointNotFoundException`, adjunta el mensaje completo y el listado de DLL. Ejecuta la sonda con Ctrl+C después de capturar el error; si inicia, adjunta también lo que imprimió antes de quedar activa. Indica la edición y versión de Windows (`winver`) y la arquitectura del equipo. Revisa los logs antes de compartirlos.

## Referencias oficiales

- [Guía oficial del paquete NuGet Windows, variantes y frameworks](https://wiki.linphone.org/xwiki/wiki/public/view/Lib/Getting%20started/Windows%20UWP/)
- [Referencia C Liblinphone 5.5: inicialización y ciclo de Core](https://download.linphone.org/releases/docs/liblinphone/5.5/c/group__group__initializing.html)
- [Referencia C Liblinphone 5.5: parámetros multimedia y dispositivos de audio](https://download.linphone.org/releases/docs/liblinphone/5.5/c/group__group__media__parameters.html)
- [Referencia C Liblinphone 5.5: audio](https://download.linphone.org/releases/docs/liblinphone/5.5/c/group__audio.html)
- [Código oficial de empaquetado NuGet Windows](https://github.com/BelledonneCommunications/linphone-sdk/blob/master/cmake/NuGet/Windows/CMakeLists.txt)
- [Índice oficial de SDK Windows](https://download.linphone.org/releases/windows/sdk/)
