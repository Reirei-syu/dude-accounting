namespace DudeAcc.Host;

public static class Program
{
  public static int Main(string[] args)
  {
    UserPathService.ConfigureConsoleEncoding();

    try
    {
      var request = HostCommandParser.Parse(args);
      return request.Kind switch
      {
        HostCommandKind.Interactive => HostProcessRunner.RunInteractive(),
        HostCommandKind.Batch => HostProcessRunner.RunBatch(request.ForwardedArgs),
        HostCommandKind.PathAdd or HostCommandKind.PathRemove => RunPathUpdate(request),
        _ => 10
      };
    }
    catch (HostUsageException error)
    {
      Console.Error.WriteLine(error.Message);
      return 2;
    }
    catch (Exception error)
    {
      Console.Error.WriteLine(error.Message);
      return 10;
    }
  }

  private static int RunPathUpdate(HostCommandRequest request)
  {
    UserPathService.UpdateUserPath(request);
    return 0;
  }
}
