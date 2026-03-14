export const EmptyState = ({
  message,
  action
}: {
  message: string;
  action?: { label: string; onClick: () => void };
}) => {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-8 text-center">
      <p className="text-white/60 mb-3">{message}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="px-4 py-2 bg-brand-primary text-black rounded-lg font-semibold text-sm"
        >
          {action.label}
        </button>
      )}
    </div>
  );
};
