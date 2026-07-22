import { useState, useEffect } from "react";
import { saveCredentials, getCampaigns } from "./api";

export default function LoginScreen({ onSuccess }) {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    // Ambient light shadow that follows mouse (exact from neumorphism script.js)
    const card = document.querySelector('.login-card');
    function handleMouseMove(e) {
      if (!card) return;
      const rect = card.getBoundingClientRect();
      const x = (e.clientX - rect.left - rect.width / 2) / (rect.width / 2);
      const y = (e.clientY - rect.top - rect.height / 2) / (rect.height / 2);
      card.style.boxShadow = `${x * 30}px ${y * 30}px 60px var(--border-strong), ${-x * 30}px ${-y * 30}px 60px var(--surface)`;
    }
    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setChecking(true);
    saveCredentials(user, password);
    try {
      await getCampaigns();
      onSuccess();
    } catch {
      setError("Password is required / Invalid credentials");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--bg)",
      padding: "20px"
    }}>
      <div className="login-container" style={{ width: "100%", maxWidth: "420px" }}>
        <div className="login-card">
          <div className="login-header">
            <div className="neu-icon">
              <div className="icon-inner">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </div>
            </div>
            <h2>Welcome back</h2>
            <p>Please sign in to continue</p>
          </div>
          
          <form className="login-form" onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <div className={`input-group neu-input ${error ? "error" : ""}`}>
                <input 
                  type="text" 
                  id="email" 
                  name="email" 
                  required 
                  placeholder=" "
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  autoFocus
                />
                <label htmlFor="email">Username</label>
                <div className="input-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                    <polyline points="22,6 12,13 2,6"/>
                  </svg>
                </div>
              </div>
            </div>

            <div className="form-group">
              <div className={`input-group neu-input password-group ${error ? "error" : ""}`}>
                <input 
                  type={showPassword ? "text" : "password"} 
                  id="password" 
                  name="password" 
                  required 
                  placeholder=" "
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <label htmlFor="password">Password</label>
                <div className="input-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0110 0v4"/>
                  </svg>
                </div>
                <button 
                  type="button" 
                  className={`password-toggle neu-toggle ${showPassword ? "show-password" : ""}`}
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label="Toggle password visibility"
                >
                  <svg className="eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: showPassword ? "none" : "block", width: "18px", height: "18px" }}>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                  <svg className="eye-closed" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: showPassword ? "block" : "none", width: "18px", height: "18px" }}>
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                </button>
              </div>
              <span className={`error-message ${error ? "show" : ""}`} id="passwordError">{error}</span>
            </div>

            <button type="submit" className={`neu-button login-btn ${checking ? "loading" : ""}`} disabled={checking}>
              <span className="btn-text">Sign In</span>
              <div className="btn-loader">
                <div className="neu-spinner"></div>
              </div>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
