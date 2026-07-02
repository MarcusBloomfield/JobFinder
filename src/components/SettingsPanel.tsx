import React from 'react';
import { AiModel, AiSettings, AI_MODEL_OPTIONS } from '../models/AiSettings';

interface SettingsPanelProps {
  settings: AiSettings;
  onChange: (updates: Partial<AiSettings>) => void;
}

const MODEL_LABELS: Record<AiModel, string> = {
  'gpt-5.4': 'GPT-5.4',
  'gpt-5.4-mini': 'GPT-5.4 Mini'
};

const SettingsPanel: React.FC<SettingsPanelProps> = ({ settings, onChange }) => (
  <section className="settings-section">
    <div className="settings-header">
      <div>
        <h2>Settings</h2>
        <p className="settings-description">Saved locally and used for AI search, matching, profile fill, and auto-apply.</p>
      </div>
      <span className="application-profile-badge">Auto-saved</span>
    </div>

    <div className="settings-grid">
      <label className="application-profile-field">
        <span>AI model</span>
        <select value={settings.model} onChange={(event) => onChange({ model: event.target.value as AiModel })}>
          {AI_MODEL_OPTIONS.map(model => (
            <option key={model} value={model}>
              {MODEL_LABELS[model]}
            </option>
          ))}
        </select>
      </label>
    </div>
  </section>
);

export default SettingsPanel;
