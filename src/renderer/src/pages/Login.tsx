import { useState, useCallback, type JSX, type KeyboardEvent, type SVGProps } from 'react'
import { useAuthStore } from '../stores/authStore'
import wallpaper from '../assets/wallpaper.png'

const UserIcon = (props: SVGProps<SVGSVGElement>): JSX.Element => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
)

const LockIcon = (props: SVGProps<SVGSVGElement>): JSX.Element => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
)

const EyeIcon = (props: SVGProps<SVGSVGElement>): JSX.Element => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

const EyeOffIcon = (props: SVGProps<SVGSVGElement>): JSX.Element => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
    <line x1="2" x2="22" y1="2" y2="22" />
  </svg>
)

export default function Login(): JSX.Element {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const login = useAuthStore((s) => s.login)

  const handleLogin = useCallback(async () => {
    setError('')
    setLoading(true)
    try {
      const result = await window.api.auth.login(username, password)
      if (result.success && result.user) {
        login(result.user)
      } else {
        setError(result.error || '登录失败')
      }
    } catch {
      setError('系统错误，请重试')
    } finally {
      setLoading(false)
    }
  }, [username, password, login])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        void handleLogin()
      }
    },
    [handleLogin]
  )

  return (
    <div
      className="login-page"
      style={{
        backgroundImage: `url(${wallpaper})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }}
    >
      <div className="login-page-dim" />

      <div className="login-dialog-card">
        <h1 className="login-dialog-title">
          Dude
          <span>Accounting</span>
        </h1>

        <div className="login-dialog-form">
          <section className="login-dialog-section">
            <label className="login-field-label">账号</label>
            <div className="login-field-shell">
              <div className="login-field-inner">
                <UserIcon className="login-field-icon" />
                <input
                  className="login-field-input"
                  placeholder="请输入账号"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={handleKeyDown}
                  autoFocus
                />
              </div>
            </div>
          </section>

          <section className="login-dialog-section">
            <label className="login-field-label">密码</label>
            <div className="login-field-shell">
              <div className="login-field-inner">
                <LockIcon className="login-field-icon" />
                <input
                  className="login-field-input"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="请输入密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
                <button
                  type="button"
                  className="login-field-eye"
                  onClick={() => setShowPassword((prev) => !prev)}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>
          </section>

          <div className="login-submit-row">
            <button
              className="login-submit-btn"
              onClick={() => void handleLogin()}
              disabled={loading || !username}
            >
              {loading ? '登录中...' : '登录'}
            </button>
          </div>

          {error && <p className="login-error">{error}</p>}
        </div>
      </div>
    </div>
  )
}
