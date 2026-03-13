const { spawn } = require('node:child_process')

function quoteCmdArg(arg) {
  if (!arg) {
    return '""'
  }

  if (!/[ \t"&()^[\]{}=;!'+,`~|<>]/.test(arg)) {
    return arg
  }

  return `"${arg.replace(/"/g, '""')}"`
}

const [, , command, ...args] = process.argv

if (!command) {
  console.error('Missing command for run-with-utf8.js')
  process.exit(1)
}

const child =
  process.platform === 'win32'
    ? spawn(
        'cmd.exe',
        ['/d', '/s', '/c', `chcp 65001>nul && ${[command, ...args].map(quoteCmdArg).join(' ')}`],
        {
          stdio: 'inherit'
        }
      )
    : spawn(command, args, {
        stdio: 'inherit'
      })

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})
