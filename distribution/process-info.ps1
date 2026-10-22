param([Parameter(Mandatory=$true)][uint32]$ProcessId)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$observedProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId"
if (-not $observedProcess) { exit 0 }
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class FitaProcessArguments {
  [DllImport("shell32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  private static extern IntPtr CommandLineToArgvW(string value, out int count);
  [DllImport("kernel32.dll")]
  private static extern IntPtr LocalFree(IntPtr address);
  public static string[] Parse(string value) {
    int count;
    IntPtr address = CommandLineToArgvW(value, out count);
    if (address == IntPtr.Zero) throw new Win32Exception();
    try {
      string[] result = new string[count];
      for (int i=0; i<count; i++) result[i] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(address, i*IntPtr.Size));
      return result;
    } finally { LocalFree(address); }
  }
}
'@
$arguments = @()
if ($observedProcess.CommandLine) { $arguments = [FitaProcessArguments]::Parse($observedProcess.CommandLine) }
[pscustomobject]@{
  ExecutablePath = $observedProcess.ExecutablePath
  Arguments = @($arguments)
} | ConvertTo-Json -Depth 4 -Compress
