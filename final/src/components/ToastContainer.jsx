export default function ToastContainer({ toasts }) {
    return (
        <div className="fixed bottom-24 left-1/2 transform -translate-x-1/2 z-50 flex flex-col justify-end items-center gap-2 pointer-events-none">
            {toasts.map(toast => {
                let bgClass, borderClass, textClass;
                switch(toast.type) {
                    case 'error':
                        bgClass = 'bg-red-500/90';
                        borderClass = 'border-red-600';
                        textClass = 'text-white';
                        break;
                    case 'green':
                        bgClass = 'bg-green-500/90';
                        borderClass = 'border-green-600';
                        textClass = 'text-white';
                        break;
                    case 'yellow':
                        bgClass = 'bg-yellow-500/90';
                        borderClass = 'border-yellow-600';
                        textClass = 'text-black';
                        break;
                    default:
                        bgClass = 'bg-gray-800/90';
                        borderClass = 'border-gray-600';
                        textClass = 'text-white';
                }
                
                return (
                    <div 
                        key={toast.id}
                        className={`${bgClass} border ${borderClass} ${textClass} px-6 py-3 rounded-lg shadow-2xl font-medium text-sm toast-enter backdrop-blur-sm pointer-events-auto transition-opacity duration-300`}
                        style={{ opacity: toast.fading ? 0 : 1, transform: toast.fading ? 'translateY(100%)' : 'none' }}
                    >
                        {toast.message}
                    </div>
                );
            })}
        </div>
    );
}
