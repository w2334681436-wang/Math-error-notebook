import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import './chatgptMarkdownStyle.css';
import './chatgptMarkdownPatch.js';
import 'katex/dist/katex.min.css';
import './reviewRoundsPatch.js';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
