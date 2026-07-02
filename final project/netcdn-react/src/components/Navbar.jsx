export default function Navbar({ currentLocation, onLocationChange, edgeStatus, edgeName }) {
    return (
        <nav className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-b from-black/80 to-transparent px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
                <span className="text-3xl font-bold text-[#E50914] tracking-tighter">NetCDN</span>
            </div>
            
            <div className="flex items-center gap-4">
                <div className="relative">
                    <select 
                        value={currentLocation}
                        onChange={(e) => onLocationChange(e.target.value)}
                        className="bg-black/60 border border-gray-600 text-white px-4 py-2 rounded-md focus:outline-none focus:border-[#E50914] transition-colors cursor-pointer"
                    >
                        <option value="India">India</option>
                        <option value="US">US</option>
                        <option value="Asia">Asia</option>
                    </select>
                </div>
            </div>
            
            <div className="flex items-center gap-3">
                {edgeStatus === 'online' ? (
                    <div className="flex items-center gap-2 bg-green-500/20 border border-green-500/50 px-4 py-2 rounded-full">
                        <span className="w-2 h-2 bg-green-500 rounded-full status-pulse"></span>
                        <span className="text-sm font-medium text-green-400">{edgeName} &middot; Online</span>
                    </div>
                ) : (
                    <div className="flex items-center gap-2 bg-red-500/20 border border-red-500/50 px-4 py-2 rounded-full">
                        <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                        <span className="text-sm font-medium text-red-400">Offline</span>
                    </div>
                )}
            </div>
        </nav>
    );
}
