export const ErrorMessage = ({
  message = 'Something went wrong. Please try again.',
  onRetry
}: {
  message?: string;
  onRetry?: () => void;
}) => {
  return (
    <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-center">
      <p className="text-red-200 font-semibold mb-2">Error</p>
      <p className="text-white/70 text-sm mb-3">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-200 rounded-lg text-sm font-semibold transition"
        >
          Try Again
        </button>
      )}
    </div>
  );
};
