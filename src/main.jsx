import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import 'katex/dist/katex.min.css';
import './answerPreviewStyle.css';
import './answerPreviewPatch.js';
import './reviewRoundsPatch.js';
import './mistakeMoveSortPatch.js';
import './dragImageUpload.js';
import OfflineStatus from './OfflineStatus.jsx';
import { registerOfflineApp } from './offlineManager.js';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <OfflineStatus />
  </React.StrictMode>,
);

registerOfflineApp();
