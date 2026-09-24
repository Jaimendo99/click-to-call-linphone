using System;
using System.Threading;
using Linphone;

namespace AgenDial.LinphoneProbe
{
    internal static class Program
    {
        private static volatile bool _stopRequested;

        private static int Main()
        {
            Core core = null;
            var coreStarted = false;
            var exitCode = 0;

            Console.CancelKeyPress += OnCancelKeyPress;

            try
            {
                Console.WriteLine("Sonda Liblinphone para Windows x64");
                Console.WriteLine("Inicializando Core...");

                // Sin archivo de configuración: la sonda no carga ni guarda cuentas.
                core = Factory.Instance.CreateCore(null, null, IntPtr.Zero);
                core.Start();
                coreStarted = true;
                Console.WriteLine("Core iniciado.");

                PrintAudioDevices(core);
                Console.WriteLine();
                Console.WriteLine("Sonda activa. Presiona Ctrl+C para detener el Core y salir.");

                while (!_stopRequested)
                {
                    // Liblinphone requiere iterar periódicamente desde el hilo de uso.
                    core.Iterate();
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
                if (coreStarted)
                {
                    Console.WriteLine("Deteniendo Core...");
                    try
                    {
                        core.Stop();
                        Console.WriteLine("Core detenido correctamente.");
                    }
                    catch (Exception exception)
                    {
                        Console.Error.WriteLine("Error al detener el Core:");
                        Console.Error.WriteLine(exception);
                        exitCode = 1;
                    }
                }

                Console.CancelKeyPress -= OnCancelKeyPress;
            }

            return exitCode;
        }

        private static void PrintAudioDevices(Core core)
        {
            Console.WriteLine("Dispositivos de audio detectados:");

            var devices = core.ExtendedAudioDevices;
            var count = 0;

            if (devices != null)
            {
                foreach (var device in devices)
                {
                    count++;
                    Console.WriteLine(
                        "  {0}. {1} | tipo={2} | capacidades={3} | controlador={4}",
                        count,
                        device.DeviceName,
                        device.Type,
                        device.Capabilities,
                        device.DriverName);
                }
            }

            if (count == 0)
            {
                Console.WriteLine("  No se detectaron dispositivos.");
            }
        }

        private static void OnCancelKeyPress(object sender, ConsoleCancelEventArgs eventArgs)
        {
            eventArgs.Cancel = true;
            _stopRequested = true;
        }
    }
}
