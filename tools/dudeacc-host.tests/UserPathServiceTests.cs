using DudeAcc.Host;
using Xunit;

namespace DudeAcc.Host.Tests;

public sealed class UserPathServiceTests
{
  [Fact]
  public void ComputeUpdatedPathRemovesOldEntryAndAppendsInstallDir()
  {
    var rawPath =
      @"C:\Tools;%LOCALAPPDATA%\Microsoft\WindowsApps;D:\OldDudeAcc;C:\Tools";

    var result = UserPathService.ComputeUpdatedPath(
      rawPath,
      @"D:\DudeAcc\dude-app",
      @"D:\OldDudeAcc",
      addInstallDir: true
    );

    Assert.Equal(
      @"C:\Tools;%LOCALAPPDATA%\Microsoft\WindowsApps;D:\DudeAcc\dude-app",
      result
    );
  }

  [Fact]
  public void ComputeUpdatedPathKeepsUnresolvedVariableEntries()
  {
    var rawPath = @"%USERPROFILE%\bin;D:\DudeAcc\dude-app";

    var result = UserPathService.ComputeUpdatedPath(
      rawPath,
      @"D:\DudeAcc\dude-app",
      null,
      addInstallDir: false
    );

    Assert.Equal(@"%USERPROFILE%\bin", result);
  }

  [Fact]
  public void ComputeUpdatedPathRejectsEmptyInstallDir()
  {
    var error = Assert.Throws<HostUsageException>(
      () => UserPathService.ComputeUpdatedPath(@"C:\Tools", "", null, addInstallDir: true)
    );

    Assert.Contains("install-dir", error.Message, StringComparison.OrdinalIgnoreCase);
  }
}
