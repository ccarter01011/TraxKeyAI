import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

function App() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <h1 className="text-2xl font-bold mb-2">TraxKey <span className="text-teal-400">AI</span> — Admin</h1>
        <p className="text-sm text-slate-400">
          Internal ops dashboard: companies, usage, and platform health. Not built yet, placeholder for the deploy pipeline.
        </p>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
