import { BottomNav } from './BottomNav';
import { TopBar } from './TopBar';

export const PortalShell = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0d0d0d] to-black text-white flex flex-col">
      <TopBar />
      <main className="flex-1 px-4 pb-20 sm:pb-6 pt-4 max-w-6xl w-full mx-auto">{children}</main>
      <footer className="px-4 pb-24 sm:pb-4 text-center text-xs text-white/50">Powered by Workshop Pro, created by Edgepoint.</footer>
      <BottomNav />
    </div>
  );
};
