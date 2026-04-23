export default function MovieCard({ movie, onPlay, isDisabled, isLoading, isError, isRefreshing }) {
    return (
        <div 
            className={`movie-card relative rounded-md overflow-hidden bg-[#1a1a1a] cursor-pointer group aspect-[2/3] ${isDisabled ? 'disabled-card' : ''}`}
        >
            <img src={movie.poster} alt={movie.title} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" />
            
            {/* Loading Spinner Overlay */}
            {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
                    <div className="netflix-spinner"></div>
                </div>
            )}
            
            {/* Error Overlay */}
            {isError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 z-30 error-state">
                    <svg className="w-12 h-12 text-[#E50914] mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                    </svg>
                    <span className="text-[#E50914] font-bold text-sm">Edge Unavailable</span>
                </div>
            )}
            
            {/* Refreshing Badge */}
            {isRefreshing && (
                <div className="absolute top-2 right-2 bg-[#E50914] text-white text-xs font-bold px-2 py-1 rounded z-20 flash-badge">
                    Refreshing...
                </div>
            )}
            
            {/* Card Overlay */}
            <div className="card-overlay absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-4">
                <span className="text-[10px] font-bold text-[#E50914] uppercase tracking-wider mb-1">{movie.genre}</span>
                <h3 className="text-lg font-bold mb-3 leading-tight">{movie.title}</h3>
                <button 
                    onClick={() => onPlay(movie.id)} 
                    disabled={isDisabled}
                    className="play-btn w-full bg-white hover:bg-gray-200 text-black font-bold py-2.5 px-4 rounded shadow-lg flex items-center justify-center gap-2 transition-all duration-300 transform active:scale-95"
                >
                    <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z"/>
                    </svg>
                    Play
                </button>
            </div>
        </div>
    );
}
