import React, { useState } from 'react';

interface JobSearchAmountSelectorProps {
  amount: number;
  onAmountChange: (amount: number) => void;
  isLoading: boolean;
}

const popularAmounts = [10, 25, 50, 100];

const JobSearchAmountSelector: React.FC<JobSearchAmountSelectorProps> = ({
  amount,
  onAmountChange,
  isLoading
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [customAmount, setCustomAmount] = useState(String(amount));

  const saveAmount = () => {
    const parsed = Number(customAmount);
    if (Number.isFinite(parsed) && parsed >= 1) {
      onAmountChange(Math.min(200, Math.round(parsed)));
      setIsEditing(false);
    }
  };

  return (
    <div className="job-amount-selector">
      <div className="job-amount-selector-header">
        <h3>Job Search Amount</h3>
        {!isEditing && (
          <button
            onClick={() => {
              setCustomAmount(String(amount));
              setIsEditing(true);
            }}
            className="toggle-button"
            disabled={isLoading}
          >
            Edit
          </button>
        )}
      </div>

      {isEditing ? (
        <div className="job-amount-edit-mode">
          <div className="job-amount-form">
            <input
              type="number"
              min={1}
              max={200}
              step={1}
              value={customAmount}
              onChange={(event) => setCustomAmount(event.target.value)}
              disabled={isLoading}
            />
            <div className="buttons">
              <button
                type="button"
                className="save-button"
                disabled={isLoading || !customAmount.trim()}
                onClick={saveAmount}
              >
                Save
              </button>
              <button
                type="button"
                className="cancel-button"
                disabled={isLoading}
                onClick={() => {
                  setCustomAmount(String(amount));
                  setIsEditing(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>

          <div className="popular-job-amounts">
            <h4>Quick Amounts</h4>
            <div className="job-amount-buttons">
              {popularAmounts.map(value => (
                <button
                  key={value}
                  className={`job-amount-button ${amount === value ? 'active' : ''}`}
                  disabled={isLoading}
                  onClick={() => {
                    onAmountChange(value);
                    setCustomAmount(String(value));
                    setIsEditing(false);
                  }}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="current-job-amount">
          <span className="job-amount-display">{amount} jobs</span>
        </div>
      )}
    </div>
  );
};

export default JobSearchAmountSelector;
