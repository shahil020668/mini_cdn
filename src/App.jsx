import { useState, useEffect, useRef } from 'react';
import Navbar from './components/Navbar';
import MovieCard from './components/MovieCard';
import ToastContainer from './components/ToastContainer';
import './index.css';

const movies = [
    { id: 'movie_1', title: 'The Edge', genre: 'Action', poster: 'https://picsum.photos/300/450?random=1' },
    { id: 'movie_2', title: 'Cache Runner', genre: 'Sci-Fi', poster: 'https://picsum.photos/300/450?random=2' },
    { id: 'movie_3', title: 'Latency', genre: 'Thriller', poster: 'https://picsum.photos/300/450?random=3' },
    { id: 'movie_4', title: 'Origin Story', genre: 'Drama', poster: 'https://picsum.photos/300/450?random=4' },
    { id: 'movie_5', title: 'Node Runner', genre: 'Action', poster: 'https://picsum.photos/300/450?random=5' },
    { id: 'movie_6', title: 'The Purge', genre: 'Horror', poster: 'https://picsum.photos/300/450?random=6' },
    { id: 'movie_7', title: 'Distributed', genre: 'Documentary', poster: 'https://picsum.photos/300/450?random=7' },
    { id: 'movie_8', title: 'Edge of Tomorrow', genre: 'Sci-Fi', poster: 'https://picsum.photos/300/450?random=8' }
];

export default function App() {
    const [currentLocation, setCurrentLocation] = useState('India');
    // Using simple states over complex reducers since this scales nicely for the demo
    const [currentEdgeUrl, setCurrentEdgeUrl] = useState(null);
    const [edgeStatus, setEdgeStatus] = useState('offline'); // 'online' | 'offline'
    const [edgeName, setEdgeName] = useState('Edge-A');
    
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
        for(let m of movies) updated[m.id] = true;
        setDisabledCards(updated);
    };

    const enableAllCards = () => {
        setDisabledCards({});
        setErrorCards({});
    };

    const discoverEdge = async (locationParam = currentLocation) => {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            const response = await fetch(`http://192.168.1.14:5000/discover?location=${locationParam}`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            
            if (!response.ok) throw new Error('Traffic Manager error');
            
            const data = await response.json();
            setCurrentEdgeUrl(data.edgeUrl);
            setEdgeStatus('online');
            
            const edgeMatch = data.edgeUrl.match(/Edge-[A-C]/);
            setEdgeName(edgeMatch ? edgeMatch[0] : 'Edge-A');
            
            enableAllCards();
            
            return data.edgeUrl;
        } catch (error) {
            setCurrentEdgeUrl(null);
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
        setEdgeStatus('offline');
        
        await discoverEdge(newLoc);
    };

    // On play request
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
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            const response = await fetch(`${activeEdge}/data/${movieId}`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            
            if (!response.ok) throw new Error('Edge error');
            
            const data = await response.json();
            
            if (data.cacheStatus === 'MISS') {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            setLoadingCards(prev => ({ ...prev, [movieId]: false }));
            
            const ipMatch = activeEdge.match(/192\.168\.1\.\d+/);
            const edgeIp = ipMatch ? ipMatch[0] : '-';
            
            setTechData({
                servedBy: data.servedBy || '-',
                latency: data.latency || null,
                location: currentLocation,
                cacheStatus: data.cacheStatus || 'IDLE',
                ip: edgeIp
            });
            
            const statusColor = data.cacheStatus === 'HIT' ? 'green' : 'yellow';
            showToast(`${data.title} - ${data.cacheStatus} (${data.latency}ms)`, statusColor);
            
        } catch (error) {
            setLoadingCards(prev => ({ ...prev, [movieId]: false }));
            setErrorCards(prev => ({ ...prev, [movieId]: true }));
            setDisabledCards(prev => ({ ...prev, [movieId]: true }));
            
            showToast('Edge Unavailable', 'error');
        }
    };

    // Poll purge status
    useEffect(() => {
        const interval = setInterval(async () => {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3000);
                
                const response = await fetch('http://192.168.1.14:5000/purge-status', {
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                
                if (!response.ok) return;
                
                const data = await response.json();
                
                if (data.purged && data.id) {
                    showToast('Cache Updated — fetching fresh content', 'info');
                    
                    setRefreshingCards(prev => ({ ...prev, [data.id]: true }));
                    setTimeout(() => {
                        setRefreshingCards(prev => ({ ...prev, [data.id]: false }));
                    }, 3000);
                }
            } catch (error) {
                // Silently fail on purge poll errors during demo
            }
        }, 5000);
        
        return () => clearInterval(interval);
    }, []);

    // Initial load
    useEffect(() => {
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
            </main>

            <ToastContainer toasts={toasts} />
        </div>
    );
}
