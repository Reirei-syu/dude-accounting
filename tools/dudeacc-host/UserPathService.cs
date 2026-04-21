using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace DudeAcc.Host;

public static class UserPathService
{
  private const string EnvironmentRegistryPath = @"Environment";
  private const uint HwndBroadcast = 0xFFFF;
  private const uint WmSettingChange = 0x001A;
  private const uint SmtoAbortIfHung = 0x0002;

  public static string ComputeUpdatedPath(
    string? rawPath,
    string installDir,
    string? oldInstallDir,
    bool addInstallDir
  )
  {
    var normalizedInstallDir = NormalizePathEntry(installDir);
    if (string.IsNullOrWhiteSpace(normalizedInstallDir))
    {
      throw new HostUsageException("install-dir 不能为空");
    }

    var normalizedOldInstallDir = NormalizePathEntry(oldInstallDir);
    var entries = new List<string>();
    var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    foreach (var entry in SplitPathEntries(rawPath))
    {
      var entryText = GetPathEntryText(entry);
      var normalizedEntry = NormalizePathEntry(entryText);
      if (string.IsNullOrWhiteSpace(normalizedEntry))
      {
        continue;
      }

      if (
        (!string.IsNullOrWhiteSpace(normalizedOldInstallDir)
          && normalizedEntry.Equals(
            normalizedOldInstallDir,
            StringComparison.OrdinalIgnoreCase
          ))
        || normalizedEntry.Equals(normalizedInstallDir, StringComparison.OrdinalIgnoreCase)
      )
      {
        continue;
      }

      if (seen.Add(normalizedEntry))
      {
        entries.Add(entryText);
      }
    }

    if (addInstallDir && seen.Add(normalizedInstallDir))
    {
      entries.Add(normalizedInstallDir);
    }

    return string.Join(';', entries);
  }

  public static void UpdateUserPath(HostCommandRequest request)
  {
    using var key = Registry.CurrentUser.CreateSubKey(EnvironmentRegistryPath, writable: true)
      ?? throw new InvalidOperationException("无法打开 HKCU\\Environment");

    var currentPath = key.GetValue("Path") as string;
    var currentValueKind = key.GetValueNames().Contains("Path")
      ? key.GetValueKind("Path")
      : RegistryValueKind.ExpandString;

    var updatedPath = request.Kind switch
    {
      HostCommandKind.PathAdd => ComputeUpdatedPath(
        currentPath,
        request.InstallDir!,
        request.OldInstallDir,
        addInstallDir: true
      ),
      HostCommandKind.PathRemove => ComputeUpdatedPath(
        currentPath,
        request.InstallDir!,
        request.OldInstallDir,
        addInstallDir: false
      ),
      _ => throw new InvalidOperationException($"不支持的 PATH 更新动作：{request.Kind}")
    };

    var targetValueKind =
      currentValueKind == RegistryValueKind.ExpandString || updatedPath.Contains('%')
        ? RegistryValueKind.ExpandString
        : RegistryValueKind.String;

    key.SetValue("Path", updatedPath, targetValueKind);
    BroadcastEnvironmentChange();
  }

  public static void ConfigureConsoleEncoding()
  {
    try
    {
      Console.InputEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
      Console.OutputEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
      SetConsoleCP(65001);
      SetConsoleOutputCP(65001);
    }
    catch
    {
      // 控制台编码优化失败不应阻塞主流程。
    }
  }

  internal static string GetPathEntryText(string? value)
  {
    if (string.IsNullOrWhiteSpace(value))
    {
      return string.Empty;
    }

    var trimmed = value.Trim().Trim('"');
    if (string.IsNullOrWhiteSpace(trimmed))
    {
      return string.Empty;
    }

    return trimmed.Length > 3 ? trimmed.TrimEnd('\\') : trimmed;
  }

  internal static string NormalizePathEntry(string? value)
  {
    var entryText = GetPathEntryText(value);
    if (string.IsNullOrWhiteSpace(entryText))
    {
      return string.Empty;
    }

    var expanded = Environment.ExpandEnvironmentVariables(entryText);
    if (Regex.IsMatch(expanded, "%[^%]+%"))
    {
      return entryText;
    }

    string fullPath;
    try
    {
      fullPath = Path.GetFullPath(expanded);
    }
    catch
    {
      fullPath = expanded;
    }

    return fullPath.Length > 3 ? fullPath.TrimEnd('\\') : fullPath;
  }

  private static IEnumerable<string> SplitPathEntries(string? rawPath)
  {
    if (string.IsNullOrWhiteSpace(rawPath))
    {
      yield break;
    }

    foreach (
      var entry in rawPath.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
    )
    {
      if (!string.IsNullOrWhiteSpace(entry))
      {
        yield return entry;
      }
    }
  }

  private static void BroadcastEnvironmentChange()
  {
    SendMessageTimeout(
      new IntPtr(HwndBroadcast),
      WmSettingChange,
      IntPtr.Zero,
      "Environment",
      SmtoAbortIfHung,
      5000,
      out _
    );
  }

  [DllImport("kernel32.dll")]
  private static extern bool SetConsoleCP(uint wCodePageID);

  [DllImport("kernel32.dll")]
  private static extern bool SetConsoleOutputCP(uint wCodePageID);

  [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern nint SendMessageTimeout(
    nint hWnd,
    uint msg,
    nint wParam,
    string lParam,
    uint fuFlags,
    uint uTimeout,
    out nuint lpdwResult
  );
}
