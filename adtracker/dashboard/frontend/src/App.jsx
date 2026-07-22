import { useState, useEffect } from "react";
import LoginScreen from "./LoginScreen";
import OverviewView from "./OverviewView";
import LeadsView from "./LeadsView";
import PerformanceView from "./PerformanceView";
import ThemeToggle from "./ThemeToggle";
import { hasCredentials, clearCredentials } from "./api";

function getInitialTheme() {
  const saved = localStorage.getItem("adtracker_theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function App() {
  const [authed, setAuthed] = useState(hasCredentials());
  const [tab, setTab] = useState("overview");
  const [keywordFilter, setKeywordFilter] = useState(null); // { id, text } | null
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("adtracker_theme", theme);
  }, [theme]);

  if (!authed) {
    return <LoginScreen onSuccess={() => setAuthed(true)} />;
  }

  // Clicking a keyword in Overview or Performance jumps to Leads, filtered.
  function handleSelectKeyword(id, text) {
    setKeywordFilter({ id, text });
    setTab("leads");
  }

  return (
    <div className="app">
      <div className="header">
        <div className="header-left">
          <div className="header-mark">AT</div>
          <h1>Ad Tracker</h1>
        </div>
        <div className="header-right">
          <ThemeToggle theme={theme} onToggle={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} />
          <span className="account" onClick={() => { clearCredentials(); setAuthed(false); }} title="Sign out">
            sign out
          </span>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === "overview" ? "active" : ""}`} onClick={() => setTab("overview")}>Overview</button>
        <button className={`tab ${tab === "leads" ? "active" : ""}`} onClick={() => setTab("leads")}>Leads</button>
        <button className={`tab ${tab === "performance" ? "active" : ""}`} onClick={() => setTab("performance")}>Performance</button>
      </div>

      {tab === "overview" && (
        <OverviewView onSelectKeyword={handleSelectKeyword} />
      )}
      {tab === "leads" && (
        <LeadsView keywordFilter={keywordFilter} onClearKeywordFilter={() => setKeywordFilter(null)} />
      )}
      {tab === "performance" && (
        <PerformanceView onSelectKeyword={handleSelectKeyword} />
      )}
    </div>
  );
}
