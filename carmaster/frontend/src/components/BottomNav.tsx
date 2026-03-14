import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/jobs', label: 'Jobs' },
  { to: '/customers', label: 'Customers' },
  { to: '/service-schedule', label: 'Schedule' },
  { to: '/quotes', label: 'Quotes' },
  { to: '/invoices', label: 'Invoices' },
  { to: '/settings', label: 'Settings', adminOnly: true },
];

export const BottomNav = () => {
  const { user } = useAuth();
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-[#0b0b0b]/95 border-t border-white/10 flex sm:hidden">
      {navItems
        .filter((item) => !item.adminOnly || user?.role === 'admin')
        .map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex-1 text-center py-3 text-xs font-semibold ${
                isActive ? 'text-brand-primary' : 'text-white/60'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
    </nav>
  );
};
