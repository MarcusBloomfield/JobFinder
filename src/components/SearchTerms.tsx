import React, { useState } from 'react';

interface SearchTermsProps {
  terms: string[];
  onSearch: (terms?: string[]) => Promise<void>;
  isLoading: boolean;
}

const SearchTerms: React.FC<SearchTermsProps> = ({ terms, onSearch, isLoading }) => {
  const [editMode, setEditMode] = useState<boolean>(false);
  const [customTerms, setCustomTerms] = useState<string>(terms.join(', '));

  const handleSearch = () => {
    onSearch();
  };

  const handleCustomSearch = () => {
    const trimmedTerms = customTerms
      .split(',')
      .map(term => term.trim())
      .filter(term => term.length > 0);
    
    if (trimmedTerms.length > 0) {
      onSearch(trimmedTerms);
    }
  };

  const toggleEditMode = () => {
    setEditMode(!editMode);
    if (!editMode) {
      setCustomTerms(terms.join(', '));
    }
  };

  return (
    <div className="search-terms">
      <div className="search-terms-header">
        <h3>Search Terms</h3>
        <button 
          onClick={toggleEditMode} 
          className="toggle-button"
          disabled={isLoading}
        >
          {editMode ? 'Cancel' : 'Edit'}
        </button>
      </div>

      {editMode ? (
        <div className="edit-mode">
          <textarea
            value={customTerms}
            onChange={(e) => setCustomTerms(e.target.value)}
            placeholder="Enter search terms separated by commas"
            rows={4}
            disabled={isLoading}
          />
          <div className="buttons">
            <button 
              onClick={handleCustomSearch} 
              className="search-button"
              disabled={isLoading || customTerms.trim().length === 0}
            >
              {isLoading ? 'Searching...' : 'Search with Custom Terms'}
            </button>
          </div>
        </div>
      ) : (
        <div className="view-mode">
          {terms.length > 0 ? (
            <>
              <div className="terms-list">
                {terms.map((term, index) => (
                  <span key={index} className="term-tag">
                    {term}
                  </span>
                ))}
              </div>
              <button 
                onClick={handleSearch} 
                className="search-button"
                disabled={isLoading || terms.length === 0}
              >
                {isLoading ? 'Searching...' : 'Search Jobs'}
              </button>
            </>
          ) : (
            <p className="no-terms">
              No search terms generated yet. Upload a resume to generate terms.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default SearchTerms; 