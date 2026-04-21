using System.Diagnostics;

namespace DudeAcc.Host;

public static class HostProcessRunner
{
  public static int RunInteractive()
  {
    var appExecutablePath = ResolveAppExecutablePath();
    var interactiveEntryPath = ResolveInteractiveEntryPath();

    if (!File.Exists(appExecutablePath))
    {
      throw new FileNotFoundException($"未找到 DudeAcc 应用可执行文件：{appExecutablePath}");
    }

    return RunInteractiveCore(BuildInteractiveStartInfo(appExecutablePath, interactiveEntryPath));
  }

  public static int RunBatch(IReadOnlyList<string> forwardedArgs)
  {
    var appExecutablePath = ResolveAppExecutablePath();
    if (!File.Exists(appExecutablePath))
    {
      throw new FileNotFoundException($"未找到 DudeAcc 应用可执行文件：{appExecutablePath}");
    }

    using var process = new Process { StartInfo = BuildBatchStartInfo(appExecutablePath, forwardedArgs) };
    process.Start();
    process.WaitForExit();
    return process.ExitCode;
  }

  public static ProcessStartInfo BuildInteractiveStartInfo(
    string appExecutablePath,
    string interactiveEntryPath
  )
  {
    var startInfo = CreateBaseStartInfo(appExecutablePath);
    startInfo.RedirectStandardInput = true;
    startInfo.RedirectStandardOutput = true;
    startInfo.RedirectStandardError = true;
    startInfo.Environment["ELECTRON_RUN_AS_NODE"] = "1";
    startInfo.ArgumentList.Add(interactiveEntryPath);
    return startInfo;
  }

  public static ProcessStartInfo BuildBatchStartInfo(
    string appExecutablePath,
    IReadOnlyList<string> forwardedArgs
  )
  {
    var startInfo = CreateBaseStartInfo(appExecutablePath);
    startInfo.ArgumentList.Add("--cli");
    foreach (var argument in forwardedArgs)
    {
      startInfo.ArgumentList.Add(argument);
    }
    return startInfo;
  }

  private static int RunInteractiveCore(ProcessStartInfo startInfo)
  {
    using var process = new Process { StartInfo = startInfo };
    process.Start();

    var stdinTask = Task.Run(async () =>
    {
      try
      {
        await using var parentInput = Console.OpenStandardInput();
        await process.StandardInput.BaseStream.WriteAsync(Array.Empty<byte>());
        await parentInput.CopyToAsync(process.StandardInput.BaseStream);
      }
      catch
      {
        // 控制台输入桥接中断时，让子进程自行决定如何结束。
      }
      finally
      {
        try
        {
          process.StandardInput.Close();
        }
        catch
        {
          // ignore
        }
      }
    });

    var stdoutTask = Task.Run(async () =>
    {
      try
      {
        await using var parentOutput = Console.OpenStandardOutput();
        await process.StandardOutput.BaseStream.CopyToAsync(parentOutput);
        await parentOutput.FlushAsync();
      }
      catch
      {
        // ignore
      }
    });

    var stderrTask = Task.Run(async () =>
    {
      try
      {
        await using var parentError = Console.OpenStandardError();
        await process.StandardError.BaseStream.CopyToAsync(parentError);
        await parentError.FlushAsync();
      }
      catch
      {
        // ignore
      }
    });

    process.WaitForExit();
    Task.WaitAll([stdoutTask, stderrTask], TimeSpan.FromSeconds(5));
    Task.WaitAll([stdinTask], TimeSpan.FromSeconds(1));
    return process.ExitCode;
  }

  private static ProcessStartInfo CreateBaseStartInfo(string appExecutablePath)
  {
    var startInfo = new ProcessStartInfo
    {
      FileName = appExecutablePath,
      WorkingDirectory = Path.GetDirectoryName(appExecutablePath) ?? AppContext.BaseDirectory,
      UseShellExecute = false
    };

    startInfo.Environment.Remove("ELECTRON_RUN_AS_NODE");
    return startInfo;
  }

  internal static string ResolveAppExecutablePath()
  {
    var overriddenPath = Environment.GetEnvironmentVariable("DUDEACC_HOST_APP_EXE_PATH");
    if (!string.IsNullOrWhiteSpace(overriddenPath))
    {
      return Path.GetFullPath(overriddenPath);
    }

    return Path.Combine(AppContext.BaseDirectory, "dude-app.exe");
  }

  internal static string ResolveInteractiveEntryPath()
  {
    var overriddenPath = Environment.GetEnvironmentVariable(
      "DUDEACC_HOST_INTERACTIVE_ENTRY_PATH"
    );
    if (!string.IsNullOrWhiteSpace(overriddenPath))
    {
      return Path.GetFullPath(overriddenPath);
    }

    return Path.Combine(
      AppContext.BaseDirectory,
      "resources",
      "app.asar",
      "out",
      "cli",
      "cli",
      "installedInteractiveShellEntry.js"
    );
  }
}
