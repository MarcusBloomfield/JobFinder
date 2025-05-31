import React, { useState } from 'react';

interface LocationSelectorProps {
  location: string;
  onLocationChange: (location: string) => void;
  isLoading: boolean;
}

const popularLocations = [
  'Perth, WA',
  'Sydney, NSW',
  'Melbourne, VIC',
  'Brisbane, QLD',
  'Adelaide, SA',
  'Canberra, ACT',
  'Hobart, TAS',
  'Darwin, NT',
  'Remote'
];

const LocationSelector: React.FC<LocationSelectorProps> = ({ 
  location, 
  onLocationChange, 
  isLoading 
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [customLocation, setCustomLocation] = useState(location);

  const handleLocationSelect = (newLocation: string) => {
    onLocationChange(newLocation);
    setIsEditing(false);
  };

  const handleCustomLocationSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customLocation.trim()) {
      onLocationChange(customLocation.trim());
      setIsEditing(false);
    }
  };

  return (
    <div className="location-selector">
      <div className="location-selector-header">
        <h3>Location</h3>
        {!isEditing && (
          <button 
            onClick={() => setIsEditing(true)} 
            className="toggle-button"
            disabled={isLoading}
          >
            Edit
          </button>
        )}
      </div>

      {isEditing ? (
        <div className="location-edit-mode">
          <form onSubmit={handleCustomLocationSubmit}>
            <input
              type="text"
              value={customLocation}
              onChange={(e) => setCustomLocation(e.target.value)}
              placeholder="Enter location (e.g. Perth, WA)"
              disabled={isLoading}
            />
            <div className="buttons">
              <button 
                type="submit" 
                className="save-button"
                disabled={isLoading || !customLocation.trim()}
              >
                Save
              </button>
              <button 
                type="button" 
                className="cancel-button"
                onClick={() => {
                  setIsEditing(false);
                  setCustomLocation(location);
                }}
                disabled={isLoading}
              >
                Cancel
              </button>
            </div>
          </form>
          
          <div className="popular-locations">
            <h4>Popular Locations</h4>
            <div className="location-buttons">
              {popularLocations.map((loc) => (
                <button
                  key={loc}
                  onClick={() => handleLocationSelect(loc)}
                  className={`location-button ${location === loc ? 'active' : ''}`}
                  disabled={isLoading}
                >
                  {loc}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="current-location">
          <div className="location-display">
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              width="16" 
              height="16" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
              <circle cx="12" cy="10" r="3"></circle>
            </svg>
            <span>{location}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default LocationSelector; 