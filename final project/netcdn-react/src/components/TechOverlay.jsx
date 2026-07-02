export default function TechOverlay({ data }) {
    return (
        <div className="fixed bottom-6 right-6 tech-panel rounded-lg p-4 w-80 shadow-2xl z-40 pointer-events-none">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Edge Node Telemetry</h3>
                <div className="w-2 h-2 bg-green-500 rounded-full status-pulse"></div>
            </div>
            
            <div className="space-y-2 font-mono text-xs">
                <div className="flex justify-between">
                    <span className="text-gray-500">Served by:</span>
                    <span className="text-white font-semibold">{data.servedBy || '-'}</span>
                </div>
                <div className="flex justify-between items-center">
                    <span className="text-gray-500">Status:</span>
                    {data.cacheStatus === 'HIT' ? (
                        <span className="px-2 py-0.5 rounded text-xs font-bold bg-green-500/20 text-green-400 border border-green-500/50">
                            CACHE HIT
                        </span>
                    ) : data.cacheStatus === 'MISS' ? (
                        <span className="px-2 py-0.5 rounded text-xs font-bold bg-yellow-500/20 text-yellow-400 border border-yellow-500/50">
                            CACHE MISS
                        </span>
                    ) : (
                        <span className="px-2 py-0.5 rounded text-xs font-bold bg-gray-700 text-gray-300">
                            IDLE
                        </span>
                    )}
                </div>
                <div className="flex justify-between">
                    <span className="text-gray-500">Latency:</span>
                    <span className="text-white">{data.latency ? `${data.latency}ms` : '-'}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-gray-500">Location:</span>
                    <span className="text-[#E50914] font-semibold">{data.location || '-'}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-gray-500">Edge IP:</span>
                    <span className="text-gray-300">{data.ip || '-'}</span>
                </div>
            </div>
            
            <div className="mt-3 pt-3 border-t border-gray-700">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                    <div className="w-2 h-2 rounded-full bg-green-500"></div>
                    <span>HIT: Instant load</span>
                    <div className="w-2 h-2 rounded-full bg-yellow-500 ml-2"></div>
                    <span>MISS: 2s delay</span>
                </div>
            </div>
        </div>
    );
}
