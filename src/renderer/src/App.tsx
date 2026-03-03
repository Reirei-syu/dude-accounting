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

  return isLoggedIn ? <MainLayout /> : <Login />
}

export default App
