using System;
using System.Runtime.InteropServices;
using System.Threading;

namespace AgenDial.LinphoneProbe
{
    internal static class Program
    {
        private static volatile bool _stopRequested;

        private static int Main()
        {
            IntPtr core = IntPtr.Zero;
            var coreStarted = false;
            var exitCode = 0;

            Console.CancelKeyPress += OnCancelKeyPress;

            try
            {
                Console.WriteLine("Sonda Liblinphone para Windows x64");
                Console.WriteLine("Inicializando Core...");

                // Sin archivo de configuración: la sonda no carga ni guarda cuentas.
                var factory = NativeMethods.FactoryGet();
                core = NativeMethods.FactoryCreateCore3(factory, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
                if (core == IntPtr.Zero)
                {
                    throw new InvalidOperationException("Liblinphone no pudo crear el Core.");
                }

                var startStatus = NativeMethods.CoreStart(core);
                if (startStatus != 0)
                {
                    throw new InvalidOperationException(
                        "linphone_core_start devolvió el estado " + startStatus + ".");
                }

                coreStarted = true;
                Console.WriteLine("Core iniciado.");

                PrintAudioDevices(core);
                Console.WriteLine();
                Console.WriteLine("Sonda activa. Presiona Ctrl+C para detener el Core y salir.");

                while (!_stopRequested)
                {
                    // Liblinphone requiere iterar periódicamente desde el mismo hilo.
                    NativeMethods.CoreIterate(core);
                    Thread.Sleep(20);
                }
            }
            catch (Exception exception)
            {
                Console.Error.WriteLine("La sonda no pudo completar la inicialización:");
                Console.Error.WriteLine(exception);
                exitCode = 1;
            }
            finally
            {
                if (core != IntPtr.Zero)
                {
                    if (coreStarted)
                    {
                        Console.WriteLine("Deteniendo Core...");
                        try
                        {
                            NativeMethods.CoreStop(core);
                            Console.WriteLine("Core detenido correctamente.");
                        }
                        catch (Exception exception)
                        {
                            Console.Error.WriteLine("Error al detener el Core:");
                            Console.Error.WriteLine(exception);
                            exitCode = 1;
                        }
                    }

                    NativeMethods.CoreUnref(core);
                }

                Console.CancelKeyPress -= OnCancelKeyPress;
            }

            return exitCode;
        }

        private static void PrintAudioDevices(IntPtr core)
        {
            Console.WriteLine("Dispositivos de audio detectados:");

            var devices = NativeMethods.CoreGetExtendedAudioDevices(core);
            var count = 0;

            if (devices != IntPtr.Zero)
            {
                try
                {
                    for (var node = devices; node != IntPtr.Zero; node = NativeMethods.ListNext(node))
                    {
                        var device = NativeMethods.ListGetData(node);
                        if (device == IntPtr.Zero)
                        {
                            continue;
                        }

                        count++;
                        var capabilities = NativeMethods.AudioDeviceGetCapabilities(device);
                        Console.WriteLine(
                            "  {0}. {1} | tipo={2} | capacidades={3} | controlador={4}",
                            count,
                            Utf8(NativeMethods.AudioDeviceGetName(device)),
                            AudioDeviceTypeName(NativeMethods.AudioDeviceGetType(device)),
                            AudioDeviceCapabilities(capabilities),
                            Utf8(NativeMethods.AudioDeviceGetDriverName(device)));
                    }
                }
                finally
                {
                    // La lista y sus audio devices se devuelven como objetos propios del llamador.
                    NativeMethods.ListFreeWithData(devices, NativeMethods.AudioDeviceUnrefCallback);
                    GC.KeepAlive(NativeMethods.AudioDeviceUnrefCallback);
                }
            }

            if (count == 0)
            {
                Console.WriteLine("  No se detectaron dispositivos.");
            }
        }

        private static string Utf8(IntPtr value)
        {
            return value == IntPtr.Zero ? "(sin dato)" : Marshal.PtrToStringUTF8(value);
        }

        private static string AudioDeviceTypeName(int type)
        {
            switch (type)
            {
                case 1: return "micrófono";
                case 2: return "auricular";
                case 3: return "altavoz";
                case 4: return "Bluetooth";
                case 5: return "Bluetooth A2DP";
                case 6: return "telefonía";
                case 7: return "línea auxiliar";
                case 8: return "USB genérico";
                case 9: return "headset";
                case 10: return "headphones";
                case 11: return "audífono";
                case 12: return "HDMI";
                default: return "desconocido (" + type + ")";
            }
        }

        private static string AudioDeviceCapabilities(int capabilities)
        {
            var canRecord = (capabilities & 1) != 0;
            var canPlay = (capabilities & 2) != 0;

            if (canRecord && canPlay) return "grabar/reproducir";
            if (canRecord) return "grabar";
            if (canPlay) return "reproducir";
            return "ninguna";
        }

        private static void OnCancelKeyPress(object sender, ConsoleCancelEventArgs eventArgs)
        {
            eventArgs.Cancel = true;
            _stopRequested = true;
        }

        private static class NativeMethods
        {
            private const string LinphoneLibrary = "liblinphone.dll";
            private const string BctoolboxLibrary = "bctoolbox.dll";

            [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
            internal delegate void AudioDeviceUnrefCallbackDelegate(IntPtr audioDevice);

            internal static readonly AudioDeviceUnrefCallbackDelegate AudioDeviceUnrefCallback =
                AudioDeviceUnref;

            [DllImport(LinphoneLibrary, CallingConvention = CallingConvention.Cdecl,
                EntryPoint = "linphone_factory_get")]
            internal static extern IntPtr FactoryGet();

            [DllImport(LinphoneLibrary, CallingConvention = CallingConvention.Cdecl,
                EntryPoint = "linphone_factory_create_core_3")]
            internal static extern IntPtr FactoryCreateCore3(
                IntPtr factory,
                IntPtr configPath,
                IntPtr factoryConfigPath,
                IntPtr systemContext);

            [DllImport(LinphoneLibrary, CallingConvention = CallingConvention.Cdecl,
                EntryPoint = "linphone_core_start")]
            internal static extern int CoreStart(IntPtr core);

            [DllImport(LinphoneLibrary, CallingConvention = CallingConvention.Cdecl,
                EntryPoint = "linphone_core_stop")]
            internal static extern void CoreStop(IntPtr core);

            [DllImport(LinphoneLibrary, CallingConvention = CallingConvention.Cdecl,
                EntryPoint = "linphone_core_unref")]
            internal static extern void CoreUnref(IntPtr core);

            [DllImport(LinphoneLibrary, CallingConvention = CallingConvention.Cdecl,
                EntryPoint = "linphone_core_iterate")]
            internal static extern void CoreIterate(IntPtr core);

            [DllImport(LinphoneLibrary, CallingConvention = CallingConvention.Cdecl,
                EntryPoint = "linphone_core_get_extended_audio_devices")]
            internal static extern IntPtr CoreGetExtendedAudioDevices(IntPtr core);

            [DllImport(LinphoneLibrary, CallingConvention = CallingConvention.Cdecl,
                EntryPoint = "linphone_audio_device_get_device_name")]
            internal static extern IntPtr AudioDeviceGetName(IntPtr audioDevice);

            [DllImport(LinphoneLibrary, CallingConvention = CallingConvention.Cdecl,
                EntryPoint = "linphone_audio_device_get_driver_name")]
            internal static extern IntPtr AudioDeviceGetDriverName(IntPtr audioDevice);

            [DllImport(LinphoneLibrary, CallingConvention = CallingConvention.Cdecl,
                EntryPoint = "linphone_audio_device_get_type")]
            internal static extern int AudioDeviceGetType(IntPtr audioDevice);

            [DllImport(LinphoneLibrary, CallingConvention = CallingConvention.Cdecl,
                EntryPoint = "linphone_audio_device_get_capabilities")]
            internal static extern int AudioDeviceGetCapabilities(IntPtr audioDevice);

            [DllImport(LinphoneLibrary, CallingConvention = CallingConvention.Cdecl,
                EntryPoint = "linphone_audio_device_unref")]
            private static extern void AudioDeviceUnref(IntPtr audioDevice);

            [DllImport(BctoolboxLibrary, CallingConvention = CallingConvention.Cdecl,
                EntryPoint = "bctbx_list_next")]
            internal static extern IntPtr ListNext(IntPtr list);

            [DllImport(BctoolboxLibrary, CallingConvention = CallingConvention.Cdecl,
                EntryPoint = "bctbx_list_get_data")]
            internal static extern IntPtr ListGetData(IntPtr list);

            [DllImport(BctoolboxLibrary, CallingConvention = CallingConvention.Cdecl,
                EntryPoint = "bctbx_list_free_with_data")]
            internal static extern IntPtr ListFreeWithData(
                IntPtr list,
                AudioDeviceUnrefCallbackDelegate freeDataCallback);
        }
    }
}
