namespace DudeAcc.Host;

public enum HostCommandKind
{
  Interactive,
  Batch,
  PathAdd,
  PathRemove
}

public sealed record HostCommandRequest(
  HostCommandKind Kind,
  string? InstallDir,
  string? OldInstallDir,
  IReadOnlyList<string> ForwardedArgs
);

public sealed class HostUsageException : Exception
{
  public HostUsageException(string message)
    : base(message)
  {
  }
}

public static class HostCommandParser
{
  public static HostCommandRequest Parse(string[] args)
  {
    if (args.Length == 0)
    {
      return new HostCommandRequest(
        HostCommandKind.Interactive,
        null,
        null,
        Array.Empty<string>()
      );
    }

    if (!args[0].Equals("path", StringComparison.OrdinalIgnoreCase))
    {
      return new HostCommandRequest(HostCommandKind.Batch, null, null, args);
    }

    if (args.Length < 2)
    {
      throw new HostUsageException(
        "PATH 子命令缺少动作。用法：dudeacc-host.exe path add --install-dir <dir> [--old-install-dir <dir>] 或 path remove --install-dir <dir>"
      );
    }

    var action = args[1];
    return action.ToLowerInvariant() switch
    {
      "add" => ParsePathAdd(args),
      "remove" => ParsePathRemove(args),
      _ => throw new HostUsageException(
        $"不支持的 PATH 动作：{action}。允许值：add / remove"
      )
    };
  }

  private static HostCommandRequest ParsePathAdd(string[] args)
  {
    string? installDir = null;
    string? oldInstallDir = null;

    for (var index = 2; index < args.Length; index += 1)
    {
      var current = args[index];
      switch (current)
      {
        case "--install-dir":
          installDir = ReadRequiredValue(args, ref index, current);
          break;
        case "--old-install-dir":
          oldInstallDir = ReadRequiredValue(args, ref index, current);
          break;
        default:
          throw new HostUsageException($"不支持的参数：{current}");
      }
    }

    if (string.IsNullOrWhiteSpace(installDir))
    {
      throw new HostUsageException("PATH add 缺少 --install-dir");
    }

    return new HostCommandRequest(
      HostCommandKind.PathAdd,
      installDir,
      oldInstallDir,
      Array.Empty<string>()
    );
  }

  private static HostCommandRequest ParsePathRemove(string[] args)
  {
    string? installDir = null;

    for (var index = 2; index < args.Length; index += 1)
    {
      var current = args[index];
      switch (current)
      {
        case "--install-dir":
          installDir = ReadRequiredValue(args, ref index, current);
          break;
        default:
          throw new HostUsageException($"不支持的参数：{current}");
      }
    }

    if (string.IsNullOrWhiteSpace(installDir))
    {
      throw new HostUsageException("PATH remove 缺少 --install-dir");
    }

    return new HostCommandRequest(
      HostCommandKind.PathRemove,
      installDir,
      null,
      Array.Empty<string>()
    );
  }

  private static string ReadRequiredValue(string[] args, ref int index, string optionName)
  {
    if (index + 1 >= args.Length)
    {
      throw new HostUsageException($"{optionName} 缺少参数值");
    }

    index += 1;
    return args[index];
  }
}
