const path = require('node:path')

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') {
    return
  }

  const { rcedit } = await import('rcedit')
  const executableName =
    context.packager.platformSpecificBuildOptions.executableName ??
    context.packager.appInfo.productFilename
  const executablePath = path.join(context.appOutDir, `${executableName}.exe`)
  const iconPath = path.join(context.packager.info.projectDir, 'build', 'icon.ico')

  await rcedit(executablePath, {
    icon: iconPath
  })

  console.log(`[afterPack] Updated Windows executable icon: ${executablePath}`)
}
