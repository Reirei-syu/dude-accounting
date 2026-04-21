using DudeAcc.Host;
using Xunit;

namespace DudeAcc.Host.Tests;

public sealed class HostCommandParserTests
{
  [Fact]
  public void BuildInteractiveStartInfoUsesExplicitStdIoRedirection()
  {
    var startInfo = HostProcessRunner.BuildInteractiveStartInfo(
      @"D:\DudeAcc\dude-app\dude-app.exe",
      @"D:\DudeAcc\dude-app\resources\app.asar\out\cli\cli\installedInteractiveShellEntry.js"
    );

    Assert.False(startInfo.UseShellExecute);
    Assert.True(startInfo.RedirectStandardInput);
    Assert.True(startInfo.RedirectStandardOutput);
    Assert.True(startInfo.RedirectStandardError);
    Assert.Equal("1", startInfo.Environment["ELECTRON_RUN_AS_NODE"]);
    Assert.Equal(
      @"D:\DudeAcc\dude-app\resources\app.asar\out\cli\cli\installedInteractiveShellEntry.js",
      startInfo.ArgumentList[^1]
    );
  }

  [Fact]
  public void ParseWithoutArgsReturnsInteractiveRequest()
  {
    var result = HostCommandParser.Parse(Array.Empty<string>());

    Assert.Equal(HostCommandKind.Interactive, result.Kind);
    Assert.Empty(result.ForwardedArgs);
  }

  [Fact]
  public void ParseUnknownTopLevelArgsReturnsBatchRequest()
  {
    var result = HostCommandParser.Parse(["ledger", "list", "--pretty"]);

    Assert.Equal(HostCommandKind.Batch, result.Kind);
    Assert.Equal(["ledger", "list", "--pretty"], result.ForwardedArgs);
  }

  [Fact]
  public void ParsePathAddReadsInstallAndOldInstallDir()
  {
    var result = HostCommandParser.Parse(
      ["path", "add", "--install-dir", @"D:\DudeAcc\dude-app", "--old-install-dir", @"D:\OldPath"]
    );

    Assert.Equal(HostCommandKind.PathAdd, result.Kind);
    Assert.Equal(@"D:\DudeAcc\dude-app", result.InstallDir);
    Assert.Equal(@"D:\OldPath", result.OldInstallDir);
  }

  [Fact]
  public void ParsePathRemoveRequiresInstallDir()
  {
    var error = Assert.Throws<HostUsageException>(
      () => HostCommandParser.Parse(["path", "remove"])
    );

    Assert.Contains("--install-dir", error.Message, StringComparison.Ordinal);
  }
}
