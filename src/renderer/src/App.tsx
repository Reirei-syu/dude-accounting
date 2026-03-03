import { useAuthStore } from './stores/authStore'
import Login from './pages/Login'
import MainLayout from './pages/MainLayout'
import { useEffect, type JSX } from 'react'

function App(): JSX.Element {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn)
  const login = useAuthStore((s) => s.login)

  // Auto-login for UI testing in browser (bypasses IPC which is unavailable in normal browser)
  useEffect(() => {
    if (!isLoggedIn && !window.electron) {
      login({
        id: 1,
        username: 'admin',
        realName: 'admin',
        permissions: {},
        isAdmin: true
      })
    }
  }, [isLoggedIn, login])

  return (
    <>
      <a className="skip-link" href="#app-main">
        跳转到主内容
      </a>
      <main id="app-main" className="h-full">
        {isLoggedIn ? <MainLayout /> : <Login />}
      </main>
    </>
  )
}

export default App
