import { NavLink, Outlet } from 'react-router-dom';

const navItems = [
  { to: '/', label: 'Overview' },
  { to: '/queue', label: 'Queue' },
  { to: '/lanes', label: 'Lanes' },
  { to: '/activity', label: 'Activity' },
];

export function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-surface-600 px-4 py-3 flex items-center gap-6">
        <h1 className="text-sm font-semibold text-gray-300 tracking-wide uppercase">
          Control Plane Monitor
        </h1>
        <nav className="flex gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-surface-700 text-gray-100'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-surface-800'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto text-xs text-gray-600">
          read-only
        </div>
      </header>
      <main className="flex-1 p-4 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
