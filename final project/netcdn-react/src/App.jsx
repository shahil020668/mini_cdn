import { useState, useEffect, useRef } from 'react';
import Navbar from './components/Navbar';
import MovieCard from './components/MovieCard';
import ToastContainer from './components/ToastContainer';
import './index.css';

// --- Server Configuration (via Vite proxy to bypass CORS) ---
const TM_BASE = '/api/tm';
const ORIGIN_BASE = '/api/origin';

// Map real edge URLs returned by the TM to our local proxy paths
const EDGE_URL_MAP = {
    'http://10.134.61.94:3000': '/api/edge-india',
    'http://10.134.61.162:3000': '/api/edge-us',
    'http://10.134.61.78:3000': '/api/edge-asia',
};

function mapEdgeUrl(realUrl) {
    const mapped = EDGE_URL_MAP[realUrl];
    if (!mapped) {
        console.warn('[NetCDN] EDGE URL NOT MAPPED — will cause CORS!', {
            received: realUrl,
            expected: Object.keys(EDGE_URL_MAP)
        });
    }
    return mapped || realUrl;
}

// Generate a nice display title from a filename like "movie1.mp4"
function titleFromFilename(filename) {
    const name = filename.replace(/\.[^.]+$/, ''); // strip extension
    // Add spaces before numbers & capitalize
    return name
        .replace(/([a-z])(\d)/gi, '$1 $2')
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, s => s.toUpperCase())
        .trim();
}

// Assign a genre and poster based on index for variety
const GENRES = ['Action', 'Sci-Fi', 'Thriller', 'Drama', 'Horror', 'Documentary', 'Comedy', 'Adventure'];

function buildMovieList(filenames) {
    return filenames.map((file, i) => ({
        id: file,  // Use the actual filename as the ID (e.g., "movie1.mp4")
        title: titleFromFilename(file),
        genre: GENRES[i % GENRES.length],
        poster: `https://picsum.photos/300/450?random=${i + 1}`
    }));
}

export default function App() {
    const [movies, setMovies] = useState([]);
    const [moviesLoading, setMoviesLoading] = useState(true);
    const [currentLocation, setCurrentLocation] = useState('India');
    // Using simple states over complex reducers since this scales nicely for the demo
    const [currentEdgeUrl, setCurrentEdgeUrl] = useState(null);
    const [realEdgeUrl, setRealEdgeUrl] = useState(null); // Store real URL for display
    const [edgeStatus, setEdgeStatus] = useState('offline'); // 'online' | 'offline'
    const [edgeName, setEdgeName] = useState('India');

    // UI states per card (using objects for fast lookup)
    const [disabledCards, setDisabledCards] = useState({});
    const [loadingCards, setLoadingCards] = useState({});
    const [errorCards, setErrorCards] = useState({});
    const [refreshingCards, setRefreshingCards] = useState({});

    const [techData, setTechData] = useState({
        servedBy: '-', latency: null, location: 'India', cacheStatus: 'IDLE', ip: '-'
    });

    const [toasts, setToasts] = useState([]);

    // We store currentEdgeUrl in a ref so setTimeouts/intervals see the latest
    const edgeUrlRef = useRef(currentEdgeUrl);
    useEffect(() => {
        edgeUrlRef.current = currentEdgeUrl;
    }, [currentEdgeUrl]);

    const realEdgeUrlRef = useRef(realEdgeUrl);
    useEffect(() => {
        realEdgeUrlRef.current = realEdgeUrl;
    }, [realEdgeUrl]);

    const moviesRef = useRef(movies);
    useEffect(() => {
        moviesRef.current = movies;
    }, [movies]);

    // Toast logic
    const showToast = (message, type = 'info') => {
        const id = Date.now().toString() + Math.random().toString();
        // Add toast
        setToasts(prev => [...prev, { id, message, type, fading: false }]);

        // Mark for fade out
        setTimeout(() => {
            setToasts(prev => prev.map(t => t.id === id ? { ...t, fading: true } : t));
            // Remove entirely
            setTimeout(() => {
                setToasts(prev => prev.filter(t => t.id !== id));
            }, 300);
        }, 3000);
    };

    const disableAllCards = () => {
        const updated = {};
        for (let m of moviesRef.current) updated[m.id] = true;
        setDisabledCards(updated);
    };

    const enableAllCards = () => {
        setDisabledCards({});
        setErrorCards({});
    };

    // Fetch movie list from the origin server
    const fetchMovies = async () => {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(`${ORIGIN_BASE}/api`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) throw new Error('Origin server error');

            const data = await response.json();
            // Origin returns: { movies: ["movie1.mp4", ...] }
            if (data.movies && Array.isArray(data.movies) && data.movies.length > 0) {
                const movieList = buildMovieList(data.movies);
                setMovies(movieList);
                showToast(`Loaded ${movieList.length} movie(s) from server`, 'green');
            } else {
                showToast('No movies found on server', 'yellow');
            }
        } catch (error) {
            console.error('Failed to fetch movies from origin:', error);
            showToast('Could not load movies from server', 'error');
        } finally {
            setMoviesLoading(false);
        }
    };

    // Discover edge via Traffic Manager's GET /route endpoint
    const discoverEdge = async (locationParam = currentLocation) => {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(`${TM_BASE}/route`, {
                signal: controller.signal,
                headers: {
                    'X-Client-Location': locationParam
                }
            });
            clearTimeout(timeoutId);

            if (!response.ok) throw new Error('Traffic Manager error');

            const data = await response.json();
            // TM returns: { requested_region, selected_edge, redirected, url }
            const proxiedUrl = mapEdgeUrl(data.url);
            setCurrentEdgeUrl(proxiedUrl);
            setRealEdgeUrl(data.url); // Keep the real URL for display
            setEdgeStatus('online');
            setEdgeName(data.selected_edge || locationParam);

            if (data.redirected) {
                showToast(`Redirected to ${data.selected_edge} edge (${locationParam} unavailable)`, 'yellow');
            }

            enableAllCards();

            return proxiedUrl;
        } catch (error) {
            setCurrentEdgeUrl(null);
            setRealEdgeUrl(null);
            setEdgeStatus('offline');
            showToast('Traffic Manager Unavailable', 'error');
            disableAllCards();
            return null;
        }
    };

    // React to location change
    const handleLocationChange = async (newLoc) => {
        setCurrentLocation(newLoc);
        setTechData(prev => ({ ...prev, location: newLoc }));
        showToast(`Location changed to ${newLoc}`, 'info');

        setCurrentEdgeUrl(null);
        setRealEdgeUrl(null);
        setEdgeStatus('offline');

        await discoverEdge(newLoc);
    };

    // On play request — movieId is the filename (e.g. "movie1.mp4")
    const handlePlay = async (movieId) => {
        if (disabledCards[movieId]) return;

        setLoadingCards(prev => ({ ...prev, [movieId]: true }));

        try {
            let activeEdge = edgeUrlRef.current;
            if (!activeEdge) {
                activeEdge = await discoverEdge(currentLocation);
                if (!activeEdge) throw new Error('No edge available');
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);

            // Edge server expects /data/:id where id is the filename
            const response = await fetch(`${activeEdge}/data/${movieId}`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) throw new Error('Edge error');

            // The edge server returns binary video data on success,
            // or JSON error on failure. Check content-type.
            const contentType = response.headers.get('content-type') || '';

            let cacheStatus, latency;

            if (contentType.includes('video') || contentType.includes('octet-stream')) {
                // Successful fetch — this is cached or freshly fetched content
                // We don't get explicit HIT/MISS from the binary response,
                // so we infer from response time
                const responseTime = Date.now();
                cacheStatus = 'DELIVERED';
                latency = null;
            } else {
                // JSON response (likely error)
                const data = await response.json();
                if (data.error) throw new Error(data.error);
                cacheStatus = data.cacheStatus || 'DELIVERED';
                latency = data.latency || null;
            }

            setLoadingCards(prev => ({ ...prev, [movieId]: false }));

            // Extract IP from real edge URL for display
            const displayUrl = realEdgeUrlRef.current || activeEdge;
            const ipMatch = displayUrl.match(/\d+\.\d+\.\d+\.\d+/);
            const edgeIp = ipMatch ? ipMatch[0] : '-';

            const movieTitle = moviesRef.current.find(m => m.id === movieId)?.title || movieId;

            setTechData({
                servedBy: edgeName,
                latency: latency,
                location: currentLocation,
                cacheStatus: cacheStatus,
                ip: edgeIp
            });

            showToast(`${movieTitle} — ${cacheStatus}`, 'green');

        } catch (error) {
            setLoadingCards(prev => ({ ...prev, [movieId]: false }));
            setErrorCards(prev => ({ ...prev, [movieId]: true }));
            setDisabledCards(prev => ({ ...prev, [movieId]: true }));

            const msg = error.name === 'AbortError'
                ? 'Request timed out — edge or origin too slow'
                : error.message || 'Edge Unavailable';
            console.error('Play failed:', movieId, error);
            showToast(msg, 'error');
        }
    };

    // Initial load
    useEffect(() => {
        fetchMovies();
        discoverEdge();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="min-h-screen flex flex-col">
            <Navbar
                currentLocation={currentLocation}
                onLocationChange={handleLocationChange}
                edgeStatus={edgeStatus}
                edgeName={edgeName}
            />

            <main className="flex-grow px-4 lg:px-12 py-8 relative z-10 box-border w-full max-w-7xl mx-auto mt-16">
                {moviesLoading ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="text-gray-400 text-lg animate-pulse">Loading movies from server...</div>
                    </div>
                ) : movies.length === 0 ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="text-gray-500 text-lg">No movies available on the server</div>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
                        {movies.map(movie => (
                            <MovieCard
                                key={movie.id}
                                movie={movie}
                                onPlay={handlePlay}
                                isDisabled={disabledCards[movie.id]}
                                isLoading={loadingCards[movie.id]}
                                isError={errorCards[movie.id]}
                                isRefreshing={refreshingCards[movie.id]}
                            />
                        ))}
                    </div>
                )}
            </main>

            <ToastContainer toasts={toasts} />
        </div>
    );
}
